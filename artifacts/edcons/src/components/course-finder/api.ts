/** Course Finder owns its read retry budget; QueryClient retries must be disabled. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
export const COURSE_FINDER_READ_ATTEMPTS = 4;
export const COURSE_FINDER_READ_TIMEOUT_MS = 30_000;

export class CourseFinderApiError extends Error {
  readonly status: number | null;
  readonly transient: boolean;
  constructor(message: string, status: number | null, transient: boolean) {
    super(message);
    this.name = "CourseFinderApiError";
    this.status = status;
    this.transient = transient;
  }
}

export function isTransientCourseFinderError(error: unknown): boolean {
  return error instanceof CourseFinderApiError && error.transient;
}

export function waitForCourseFinderRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
    // Bounded jitter avoids synchronizing callers after a transient outage.
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 400 * (2 ** attempt) + Math.floor(Math.random() * 100));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createCourseFinderApiClient(dependencies: {
  fetch?: typeof fetch;
  wait?: typeof waitForCourseFinderRetry;
  readTimeoutMs?: number;
} = {}) {
  const timeoutMs = Math.min(COURSE_FINDER_READ_TIMEOUT_MS, Math.max(1,
    dependencies.readTimeoutMs ?? COURSE_FINDER_READ_TIMEOUT_MS));
  return async function request(url: string, opts?: RequestInit) {
    const method = (opts?.method || "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    const attempts = isRead ? COURSE_FINDER_READ_ATTEMPTS : 1;
    const controller = new AbortController();
    const onAbort = () => controller.abort(opts?.signal?.reason);
    if (opts?.signal?.aborted) onAbort();
    else opts?.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = isRead ? setTimeout(() => controller.abort(
      new CourseFinderApiError("Request timed out", null, true),
    ), timeoutMs) : undefined;
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        controller.signal.throwIfAborted();
        let res: Response;
        try {
          res = await (dependencies.fetch ?? fetch)(url, {
            ...opts, credentials: "include", signal: controller.signal,
          });
        } catch (error) {
          controller.signal.throwIfAborted();
          if (error instanceof Error && error.name === "AbortError") throw error;
          if (attempt === attempts - 1) {
            throw new CourseFinderApiError("Network request failed", null, true);
          }
          await (dependencies.wait ?? waitForCourseFinderRetry)(attempt, controller.signal);
          continue;
        }
        const transient = TRANSIENT_STATUSES.has(res.status);
        if (transient && attempt < attempts - 1) {
          await res.body?.cancel().catch(() => undefined);
          await (dependencies.wait ?? waitForCourseFinderRetry)(attempt, controller.signal);
          continue;
        }
        if (!res.ok) {
          const type = res.headers.get("content-type") || "";
          const text = await res.text().catch(() => "");
          controller.signal.throwIfAborted();
          const safeMessage = !/text\/html/i.test(type) && !/^\s*<!?html/i.test(text)
            ? text.slice(0, 500) : "";
          throw new CourseFinderApiError(safeMessage || `API ${res.status}`, res.status, transient);
        }
        if (res.status === 204 || method === "HEAD") return null;
        let result: Awaited<ReturnType<Response["json"]>>;
        try {
          result = await res.json();
        } catch (error) {
          // A response can stall after headers arrived. Preserve the one read
          // deadline's transient error instead of leaking the body's AbortError.
          controller.signal.throwIfAborted();
          throw error;
        }
        controller.signal.throwIfAborted();
        return result;
      }
      throw new CourseFinderApiError("Network request failed", null, true);
    } finally {
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    }
  };
}

export const courseFinderApiFetch = createCourseFinderApiClient();
