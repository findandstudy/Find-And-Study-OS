/**
 * Serializes all headless-Chromium PDF renders across the process.
 * Chromium is memory-heavy; two or more concurrent renders multiply RSS and
 * can OOM-kill the instance mid-request, causing the edge proxy to return an
 * opaque "403 Forbidden" HTML instead of the PDF.  Chaining renders behind a
 * single promise guarantees at most ONE browser instance runs at a time.
 */
let renderChain: Promise<unknown> = Promise.resolve();
let pendingRenders = 0;

export function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  pendingRenders++;
  const run = renderChain.then(fn, fn).finally(() => { pendingRenders--; });
  renderChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Optional unsigned previews must never queue behind or overlap signing work. */
export function tryWithRenderLock<T>(fn: () => Promise<T>): Promise<T> | undefined {
  if (pendingRenders !== 0) return undefined;
  return withRenderLock(fn);
}
