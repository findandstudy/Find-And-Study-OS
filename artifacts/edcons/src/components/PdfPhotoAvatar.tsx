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
          const loadingTask = pdfjsLib.getDocument({ data });
          signal.addEventListener("abort", () => loadingTask.destroy(), { once: true });
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
          signal.addEventListener("abort", () => renderTask.cancel(), { once: true });
          await renderTask.promise;
          if (!cancelled) setRendered(true);
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
        aria-label={alt}
        style={{ display: rendered ? undefined : "none" }}
      />
    </>
  );
}
