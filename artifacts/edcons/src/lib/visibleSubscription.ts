/** Release long-lived HTTP connections in background tabs. On HTTP/1.1,
 * idle SSE streams otherwise exhaust the origin's connection pool and block
 * navigation/API requests in other tabs. Re-entry must refresh missed data. */
export function whilePageVisible(
  start: () => () => void,
  page: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  > = document,
  // Embedded development browsers can report every tab as visible. Yield the
  // HTTP/1 connection slots periodically; production stream behavior is unchanged.
  leaseMs = import.meta.env?.DEV ? 15_000 : 0,
): () => void {
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const release = () => {
    clearTimeout(timer);
    timer = undefined;
    const cleanup = stop;
    stop = undefined;
    cleanup?.();
  };
  const sync = () => {
    if (disposed) return;
    if (page.visibilityState === "hidden") {
      release();
    } else if (!stop) {
      clearTimeout(timer);
      stop = start();
      if (leaseMs > 0)
        timer = setTimeout(() => {
          release();
          timer = setTimeout(sync, 1000);
        }, leaseMs);
    }
  };
  page.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    disposed = true;
    page.removeEventListener("visibilitychange", sync);
    release();
  };
}
