import { useEffect, useState } from "react";

function useDelayedVisibility(active: boolean, delayMs: number) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

/** Avoid flashing an indicator for fast cache hits while still explaining real waits. */
export function DelayedPageProgress({ active, label, delayMs = 350 }: { active: boolean; label: string; delayMs?: number }) {
  const visible = useDelayedVisibility(active, delayMs);
  if (!visible) return null;
  return <div className="public-page-progress" role="progressbar" aria-label={label} aria-valuetext={label}><span /></div>;
}

/** Stable, responsive first-load geometry shared by every catalogue detail route. */
export function DetailPageSkeleton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className="detail-loading-shell" role="status" aria-label={label} aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className={`detail-loading-hero ${compact ? "is-compact" : ""}`} />
      <div className="detail-loading-grid" aria-hidden="true">
        <div className="detail-loading-block is-wide" />
        <div className="detail-loading-block" />
        <div className="detail-loading-block" />
      </div>
    </div>
  );
}
