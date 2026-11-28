import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { fetchBoundedPdf, runBoundedPdfPreview } from "@/lib/pdfPreviewRuntime";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfPhotoAvatarProps {
  src: string;
  className?: string;
  alt?: string;
  fallback?: React.ReactNode;
}

export default function PdfPhotoAvatar({ src, className, alt, fallback }: PdfPhotoAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setRendered(false);
    setFailed(false);

    async function render() {
      try {
        await runBoundedPdfPreview(null, controller.signal, async (signal) => {
          const data = await fetchBoundedPdf(src, signal);
          const signature = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(data.byteLength, 1024)));
          if (!signature.includes("%PDF-")) return;
          const loadingTask = pdfjsLib.getDocument({ data });
          const destroy = () => { void loadingTask.destroy().catch(() => undefined); };
          signal.addEventListener("abort", destroy, { once: true });
          try {
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            if (cancelled) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const unscaled = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: 160 / Math.max(unscaled.width, unscaled.height) });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d")!;
            const renderTask = page.render({ canvas, canvasContext: ctx, viewport });
            const abortRender = () => renderTask.cancel();
            signal.addEventListener("abort", abortRender, { once: true });
            try {
              await renderTask.promise;
            } finally {
              signal.removeEventListener("abort", abortRender);
            }
            if (!cancelled) setRendered(true);
          } finally {
            signal.removeEventListener("abort", destroy);
            await loadingTask.destroy().catch(() => undefined);
          }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    render();
    return () => { cancelled = true; controller.abort(); };
  }, [src]);

  if (failed) return <>{fallback ?? null}</>;

  return (
    <>
      {!rendered && fallback}
      <canvas
        ref={canvasRef}
        className={className}
        role="img"
        aria-label={alt}
        style={{ display: rendered ? undefined : "none" }}
      />
    </>
  );
}
