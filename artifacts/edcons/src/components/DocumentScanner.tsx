import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, RotateCcw, Plus, Check, Loader2, AlertTriangle, FileText } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

const OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";
const JSCANIFY_URL = "https://cdn.jsdelivr.net/npm/jscanify@1.3.0/src/jscanify.min.js";
const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";

type LibStatus = "idle" | "loading" | "ready" | "error";
let cachedStatus: LibStatus = "idle";
let cachedPromise: Promise<void> | null = null;
let cachedScanner: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-scanner-src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as any)._loaded) resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("script load failed")));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.setAttribute("data-scanner-src", src);
    s.onload = () => { (s as any)._loaded = true; resolve(); };
    s.onerror = () => reject(new Error("script load failed: " + src));
    document.head.appendChild(s);
  });
}

async function ensureScannerLibs(): Promise<any> {
  if (cachedScanner) return cachedScanner;
  if (cachedPromise) {
    await cachedPromise;
    return cachedScanner;
  }
  cachedStatus = "loading";
  cachedPromise = (async () => {
    await loadScript(OPENCV_URL);
    // Wait for cv runtime to actually be ready
    await new Promise<void>((resolve, reject) => {
      const w = window as any;
      const start = Date.now();
      function check() {
        if (w.cv && (typeof w.cv.Mat === "function" || (w.cv.then && typeof w.cv.then === "function"))) {
          if (typeof w.cv.Mat === "function") return resolve();
          // cv is a promise during init
          w.cv.then(() => resolve()).catch(reject);
          return;
        }
        if (Date.now() - start > 30000) return reject(new Error("opencv runtime timeout"));
        setTimeout(check, 100);
      }
      check();
    });
    await loadScript(JSCANIFY_URL);
    await loadScript(JSPDF_URL);
    const w = window as any;
    if (!w.jscanify) throw new Error("jscanify global missing");
    if (!w.jspdf?.jsPDF) throw new Error("jspdf global missing");
    cachedScanner = new w.jscanify();
    cachedStatus = "ready";
  })();
  try {
    await cachedPromise;
  } catch (e) {
    cachedStatus = "error";
    cachedPromise = null;
    throw e;
  }
  return cachedScanner;
}

interface CapturedPage {
  dataUrl: string;
  blob: Blob;
}

interface DocumentScannerProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  /** Base name for the output file (without extension). Defaults to "scan". */
  baseName?: string;
  /** Allow capturing multiple pages and bundling as PDF. Defaults to true. */
  allowMultiPage?: boolean;
}

export function DocumentScanner({ open, onClose, onCapture, baseName = "scan", allowMultiPage = true }: DocumentScannerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannerRef = useRef<any>(null);

  const [libStatus, setLibStatus] = useState<LibStatus>(cachedStatus);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [previewPage, setPreviewPage] = useState<CapturedPage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [building, setBuilding] = useState(false);

  // Lazy-load OpenCV + jscanify on first open.
  useEffect(() => {
    if (!open) return;
    if (cachedStatus === "ready") {
      setLibStatus("ready");
      scannerRef.current = cachedScanner;
      return;
    }
    setLibStatus("loading");
    ensureScannerLibs()
      .then((s) => { scannerRef.current = s; setLibStatus("ready"); })
      .catch(() => setLibStatus("error"));
  }, [open]);

  // Start camera once libs are ready (or when reopened).
  useEffect(() => {
    if (!open || libStatus !== "ready" || previewPage) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      if (location.protocol !== "https:" && location.hostname !== "localhost") {
        setCameraError(t("scanner.httpsRequired"));
      } else {
        setCameraError(t("scanner.noCamera"));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute("playsinline", "true");
        await v.play().catch(() => {});
        startOverlayLoop();
      } catch (err: any) {
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setCameraError(t("scanner.permissionDenied"));
        } else if (name === "NotFoundError") {
          setCameraError(t("scanner.noCamera"));
        } else if (location.protocol !== "https:" && location.hostname !== "localhost") {
          setCameraError(t("scanner.httpsRequired"));
        } else {
          setCameraError(t("scanner.cameraError"));
        }
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, libStatus, previewPage]);

  function stopCamera() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }

  function startOverlayLoop() {
    const draw = () => {
      const v = videoRef.current;
      const c = overlayRef.current;
      const scanner = scannerRef.current;
      if (!v || !c || !scanner || v.readyState < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      try {
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        if (c.width !== vw) c.width = vw;
        if (c.height !== vh) c.height = vh;
        const ctx = c.getContext("2d");
        if (!ctx) { rafRef.current = requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, vw, vh);
        // Use jscanify highlightPaper to draw a green outline on top of a video frame copy
        try {
          const highlighted: HTMLCanvasElement = scanner.highlightPaper(v, {
            color: "#22c55e",
            thickness: Math.max(4, Math.round(vw / 240)),
          });
          // highlightPaper returns the whole frame; we only need the contour overlay,
          // so composite using "difference" trick: just draw the highlighted result,
          // but to keep video visible we draw at low alpha then re-draw bright lines.
          // Simpler: scan & manually re-stroke the contour ourselves.
          // Fallback: just blit highlighted at low opacity for the outline cue.
          ctx.globalAlpha = 0.6;
          ctx.drawImage(highlighted, 0, 0, vw, vh);
          ctx.globalAlpha = 1;
        } catch {
          // No paper detected — leave overlay empty.
        }
      } catch {/* ignore one-frame errors */}
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
  }

  const handleCapture = useCallback(async () => {
    const v = videoRef.current;
    const scanner = scannerRef.current;
    if (!v || !scanner || v.readyState < 2) return;
    setProcessing(true);
    try {
      // Draw current frame to a snapshot canvas
      const snap = document.createElement("canvas");
      snap.width = v.videoWidth;
      snap.height = v.videoHeight;
      const sctx = snap.getContext("2d");
      if (!sctx) throw new Error("ctx");
      sctx.drawImage(v, 0, 0, snap.width, snap.height);

      // Determine target output size, capping the long edge for sane PDF size
      const MAX = 1600;
      const longest = Math.max(snap.width, snap.height);
      const scale = longest > MAX ? MAX / longest : 1;
      const outW = Math.round(snap.width * scale);
      const outH = Math.round(snap.height * scale);

      let extracted: HTMLCanvasElement;
      try {
        extracted = scanner.extractPaper(snap, outW, outH);
      } catch {
        // Could not detect — fall back to the raw frame at capped size.
        extracted = document.createElement("canvas");
        extracted.width = outW;
        extracted.height = outH;
        extracted.getContext("2d")!.drawImage(snap, 0, 0, outW, outH);
      }

      // Apply mild contrast / grayscale-ish enhancement for legibility
      const enhanced = enhanceContrast(extracted);

      const blob: Blob = await new Promise((resolve, reject) => {
        enhanced.toBlob(b => b ? resolve(b) : reject(new Error("blob")), "image/jpeg", 0.92);
      });
      const dataUrl = enhanced.toDataURL("image/jpeg", 0.92);
      setPreviewPage({ dataUrl, blob });
      stopCamera();
    } catch {/* swallow */}
    setProcessing(false);
  }, []);

  function acceptPreview() {
    if (!previewPage) return;
    setPages(prev => [...prev, previewPage]);
    setPreviewPage(null);
    // camera will auto-restart via effect (previewPage cleared)
  }

  function retake() {
    setPreviewPage(null);
  }

  async function finish(includeCurrent: boolean) {
    setBuilding(true);
    try {
      let allPages = [...pages];
      if (includeCurrent && previewPage) allPages = [...allPages, previewPage];
      if (allPages.length === 0) { setBuilding(false); return; }
      const ts = Date.now();
      if (allPages.length === 1) {
        const file = new File([allPages[0].blob], `${baseName}-${ts}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      } else {
        const jsPDF = (window as any).jspdf?.jsPDF;
        if (!jsPDF) throw new Error("jspdf missing");
        const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
        for (let i = 0; i < allPages.length; i++) {
          const dataUrl = allPages[i].dataUrl;
          const img = await loadImage(dataUrl);
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const ratio = Math.min(pageW / img.width, pageH / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          const x = (pageW - w) / 2;
          const y = (pageH - h) / 2;
          if (i > 0) pdf.addPage();
          pdf.addImage(dataUrl, "JPEG", x, y, w, h, undefined, "FAST");
        }
        const blob = pdf.output("blob");
        const file = new File([blob], `${baseName}-${ts}.pdf`, { type: "application/pdf" });
        onCapture(file);
      }
      // Reset state & close
      setPages([]);
      setPreviewPage(null);
      onClose();
    } catch {/* swallow */}
    setBuilding(false);
  }

  function handleClose() {
    stopCamera();
    setPages([]);
    setPreviewPage(null);
    setCameraError(null);
    onClose();
  }

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), []);

  const totalPages = pages.length + (previewPage ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl w-[96vw] p-0 overflow-hidden bg-black border-0 sm:rounded-2xl h-[92vh] sm:h-auto sm:max-h-[92vh] flex flex-col">
        <VisuallyHidden.Root>
          <DialogTitle>{t("scanner.title")}</DialogTitle>
        </VisuallyHidden.Root>
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-black/80 text-white text-sm shrink-0">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            <span className="font-semibold">{t("scanner.title")}</span>
            {pages.length > 0 && (
              <span className="ml-2 text-xs bg-white/15 px-2 py-0.5 rounded-full">
                {t("scanner.pageCount", { n: pages.length })}
              </span>
            )}
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-white/10" aria-label={t("scanner.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
          {libStatus === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
              <Loader2 className="w-10 h-10 animate-spin" />
              <p className="text-sm font-semibold">{t("scanner.loading")}</p>
              <p className="text-xs text-white/70 max-w-xs">{t("scanner.loadingHint")}</p>
            </div>
          )}
          {libStatus === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
              <p className="text-sm font-semibold">{t("scanner.libError")}</p>
              <Button variant="secondary" size="sm" onClick={handleClose}>{t("scanner.close")}</Button>
            </div>
          )}
          {libStatus === "ready" && cameraError && !previewPage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
              <AlertTriangle className="w-10 h-10 text-amber-400" />
              <p className="text-sm font-semibold max-w-sm">{cameraError}</p>
              <Button variant="secondary" size="sm" onClick={handleClose}>{t("scanner.close")}</Button>
            </div>
          )}

          {/* Live capture view */}
          {libStatus === "ready" && !cameraError && !previewPage && (
            <div className="relative w-full h-full">
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" muted playsInline />
              <canvas ref={overlayRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                {t("scanner.positionDoc")}
              </div>
            </div>
          )}

          {/* Preview view */}
          {previewPage && (
            <div className="relative w-full h-full flex items-center justify-center p-2">
              <img src={previewPage.dataUrl} alt="" className="max-w-full max-h-full object-contain rounded" />
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                {t("scanner.previewLabel", { n: pages.length + 1 })}
              </div>
            </div>
          )}

          {processing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-sm">{t("scanner.processing")}</span>
            </div>
          )}
        </div>

        {/* Thumbnails strip */}
        {pages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-2 bg-black/70 shrink-0">
            {pages.map((p, i) => (
              <div key={i} className="relative shrink-0">
                <img src={p.dataUrl} alt="" className="h-16 w-12 object-cover rounded border border-white/20" />
                <button
                  onClick={() => setPages(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center"
                  aria-label={t("scanner.removePage")}
                >
                  <X className="w-3 h-3" />
                </button>
                <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center text-white bg-black/60 rounded-b">{i + 1}</span>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="bg-black/90 p-3 shrink-0 flex flex-wrap items-center justify-center gap-2">
          {libStatus === "ready" && !cameraError && !previewPage && (
            <Button
              onClick={handleCapture}
              disabled={processing}
              className="bg-white text-black hover:bg-white/90 gap-2 h-12 px-6 rounded-full font-semibold"
            >
              <Camera className="w-5 h-5" />
              {t("scanner.capture")}
            </Button>
          )}
          {previewPage && !building && (
            <>
              <Button variant="secondary" onClick={retake} className="gap-2">
                <RotateCcw className="w-4 h-4" /> {t("scanner.retake")}
              </Button>
              {allowMultiPage && (
                <Button variant="secondary" onClick={acceptPreview} className="gap-2">
                  <Plus className="w-4 h-4" /> {t("scanner.addPage")}
                </Button>
              )}
              <Button onClick={() => finish(true)} className="gap-2">
                {totalPages > 1 ? <FileText className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                {totalPages > 1 ? t("scanner.finishPdf", { n: totalPages }) : t("scanner.use")}
              </Button>
            </>
          )}
          {building && (
            <div className="text-white flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("scanner.building")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function enhanceContrast(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d");
  if (!ctx) return src;
  try {
    const img = ctx.getImageData(0, 0, src.width, src.height);
    const d = img.data;
    // Simple contrast/brightness curve to whiten paper
    const contrast = 1.15;
    const brightness = 8;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = clamp((d[i]     - 128) * contrast + 128 + brightness);
      d[i + 1] = clamp((d[i + 1] - 128) * contrast + 128 + brightness);
      d[i + 2] = clamp((d[i + 2] - 128) * contrast + 128 + brightness);
    }
    ctx.putImageData(img, 0, 0);
  } catch {/* CORS/perf — ignore */}
  return src;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Small helper button others can drop into upload UIs. */
export function ScanButton({ onClick, className, label }: { onClick: () => void; className?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={className ?? "inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 px-2.5 py-1 rounded-md hover:bg-primary/5 transition-colors"}
    >
      <Camera className="w-3.5 h-3.5" />
      {label ?? t("scanner.scanWithCamera")}
    </button>
  );
}
