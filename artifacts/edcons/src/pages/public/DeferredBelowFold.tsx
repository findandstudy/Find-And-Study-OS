import { type ReactNode, useEffect, useRef, useState, useContext } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";

/**
 * Keeps expensive discovery widgets out of the initial render until they are
 * close to the viewport. The factual SSR/hero content remains immediate; a
 * bounded placeholder preserves layout and the widget mounts on scroll.
 */
export function DeferredBelowFold({ children, minHeight = 280 }: { children: ReactNode; minHeight?: number }) {
  const preview = useContext(DetailPreviewContext);
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!!preview);

  useEffect(() => {
    const node = anchor.current;
    if (!node || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return <div ref={anchor} style={!visible ? { minHeight } : undefined} aria-busy={!visible}>
    {visible ? children : null}
  </div>;
}
