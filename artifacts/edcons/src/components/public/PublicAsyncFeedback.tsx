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
