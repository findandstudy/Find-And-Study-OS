function readFiniteEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function requestPerformanceSampleRate(): number {
  return readFiniteEnv("REQUEST_PERF_SAMPLE_RATE", 0.05, 0, 1);
}

export function requestPerformanceSlowThresholdMs(): number {
  return readFiniteEnv("REQUEST_PERF_SLOW_MS", 750, 1, 60_000);
}

export function shouldLogRequestPerformance(
  totalMs: number,
  status: number,
  random: () => number = Math.random,
): boolean {
  if (status >= 500 || totalMs >= requestPerformanceSlowThresholdMs()) return true;
  return random() < requestPerformanceSampleRate();
}

export function requestPerformanceEventLoopResolutionMs(): number {
  return Math.round(readFiniteEnv("REQUEST_PERF_EVENT_LOOP_RESOLUTION_MS", 20, 10, 1_000));
}

export function requestPerformanceEventLoopIntervalMs(): number {
  return Math.round(readFiniteEnv("REQUEST_PERF_EVENT_LOOP_INTERVAL_MS", 60_000, 1_000, 900_000));
}
