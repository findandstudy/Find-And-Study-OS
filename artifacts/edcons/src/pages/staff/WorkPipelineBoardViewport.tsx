import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkPipelineBoardViewport({
  label,
  previousLabel,
  nextLabel,
  isRTL,
  children,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  isRTL: boolean;
  children: ReactNode;
}) {
  const viewportId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const direction = isRTL ? -1 : 1;

  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const distance = direction * viewport.scrollLeft;
    const previous = distance > 1;
    const next = distance < viewport.scrollWidth - viewport.clientWidth - 1;
    setEdges((current) => current.previous === previous && current.next === next ? current : { previous, next });
  }, [direction]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    observer.observe(track);
    updateEdges();

    function scrollWithWheel(event: WheelEvent) {
      if (!viewport || event.defaultPrevented || event.ctrlKey || event.metaKey || event.deltaX || !event.deltaY) return;
      const target = event.target instanceof Element ? event.target : null;
      const column = target?.closest("[data-work-pipeline-stage-scroll]");
      if (!event.shiftKey && column && column.scrollHeight > column.clientHeight + 1) return;

      const limit = viewport.scrollWidth - viewport.clientWidth;
      if (limit <= 1) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientWidth : 1;
      const current = direction * viewport.scrollLeft;
      const next = Math.max(0, Math.min(limit, current + event.deltaY * unit));
      if (Math.abs(next - current) < 1) return;
      event.preventDefault();
      viewport.scrollLeft = direction * next;
    }

    viewport.addEventListener("wheel", scrollWithWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", scrollWithWheel);
    };
  }, [direction, updateEdges]);

  function scrollColumn(step: -1 | 1) {
    const track = trackRef.current;
    const column = track?.firstElementChild;
    if (!track || !column) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    viewportRef.current?.scrollBy({
      left: direction * step * (column.getBoundingClientRect().width + gap),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <div className="flex min-h-52 min-w-0 flex-1 flex-col">
      {(edges.previous || edges.next) && (
        <div className="mb-2 flex shrink-0 justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            aria-controls={viewportId}
            aria-label={previousLabel}
            disabled={!edges.previous}
            onClick={() => scrollColumn(-1)}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 rounded-full"
            aria-controls={viewportId}
            aria-label={nextLabel}
            disabled={!edges.next}
            onClick={() => scrollColumn(1)}
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      )}
      <div
        id={viewportId}
        ref={viewportRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={updateEdges}
        className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-3"
      >
        <div ref={trackRef} className="flex h-full min-w-max gap-5 px-1">
          {children}
        </div>
      </div>
    </div>
  );
}
