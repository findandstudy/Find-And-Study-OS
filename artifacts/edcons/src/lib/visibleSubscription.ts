/** Release long-lived HTTP connections in background tabs. On HTTP/1.1,
 * idle SSE streams otherwise exhaust the origin's connection pool and block
 * navigation/API requests in other tabs. Re-entry must refresh missed data. */
export function whilePageVisible(
  start: () => () => void,
  page: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document,
): () => void {
  let stop: (() => void) | undefined;
  const sync = () => {
    if (page.visibilityState === "hidden") {
      const cleanup = stop;
      stop = undefined;
      cleanup?.();
    } else if (!stop) {
      stop = start();
    }
  };
  page.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    page.removeEventListener("visibilitychange", sync);
    const cleanup = stop;
    stop = undefined;
    cleanup?.();
  };
}
