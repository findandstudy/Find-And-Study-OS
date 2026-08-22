import type { NextFunction, Request, Response } from "express";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import {
  getDbRequestMetricsSnapshot,
  runWithDbRequestMetrics,
} from "@workspace/db";
import {
  getReadPathMetricsSnapshot,
  runWithReadPathMetrics,
} from "./readPathCoalescing";
import {
  getRequestTelemetrySnapshot,
  recordResponseBytes,
  runWithRequestTelemetry,
} from "./requestTelemetry";
import {
  requestPerformanceEventLoopIntervalMs,
  requestPerformanceEventLoopResolutionMs,
  shouldLogRequestPerformance,
} from "./requestPerformancePolicy";

export {
  requestPerformanceSampleRate,
  requestPerformanceSlowThresholdMs,
  shouldLogRequestPerformance,
} from "./requestPerformancePolicy";

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function nanosecondsToMilliseconds(value: number): number {
  return roundMetric(value / 1_000_000);
}

let eventLoopDelay: IntervalHistogram | null = null;
let eventLoopTimer: ReturnType<typeof setInterval> | null = null;

export function isRequestPerformanceEnabled(): boolean {
  return process.env.REQUEST_PERF_TELEMETRY_ENABLED === "true";
}

function requestMetricPath(req: Request): string {
  const routePath = req.route?.path;
  const route = typeof routePath === "string"
    ? `${req.baseUrl || ""}${routePath}`
    : req.path;
  return route
    .replace(/\/[0-9]+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/:id");
}

export function stopRequestPerformanceEventLoopMonitor(): void {
  if (eventLoopTimer) clearInterval(eventLoopTimer);
  eventLoopTimer = null;
  eventLoopDelay?.disable();
  eventLoopDelay = null;
}

export function startRequestPerformanceEventLoopMonitor(): void {
  if (!isRequestPerformanceEnabled() || eventLoopDelay || eventLoopTimer) return;
  const resolution = requestPerformanceEventLoopResolutionMs();
  const intervalMs = requestPerformanceEventLoopIntervalMs();
  eventLoopDelay = monitorEventLoopDelay({ resolution });
  eventLoopDelay.enable();
  eventLoopTimer = setInterval(() => {
    if (!eventLoopDelay) return;
    console.info("[event-loop-performance]", JSON.stringify({
      releaseId: process.env.RELEASE_ID || "unknown",
      intervalMs,
      p50Ms: nanosecondsToMilliseconds(eventLoopDelay.percentile(50)),
      p95Ms: nanosecondsToMilliseconds(eventLoopDelay.percentile(95)),
      p99Ms: nanosecondsToMilliseconds(eventLoopDelay.percentile(99)),
      maxMs: nanosecondsToMilliseconds(eventLoopDelay.max),
    }));
    eventLoopDelay.reset();
  }, intervalMs);
  eventLoopTimer.unref?.();
}

export function requestPerformanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const isEventStream = req.get("accept")?.toLowerCase().includes("text/event-stream") === true;
  if (!isRequestPerformanceEnabled() || !req.path.startsWith("/api/") || isEventStream) {
    next();
    return;
  }

  startRequestPerformanceEventLoopMonitor();

  runWithReadPathMetrics(() => runWithDbRequestMetrics(() => runWithRequestTelemetry(() => {
    const startedAt = process.hrtime.bigint();
    const originalEnd = res.end;
    const originalWrite = res.write;
    let finalized = false;

    res.write = function instrumentedWrite(
      this: Response,
      ...args: Parameters<Response["write"]>
    ) {
      recordResponseBytes(args[0], typeof args[1] === "string" ? args[1] as BufferEncoding : undefined);
      return originalWrite.apply(this, args);
    } as Response["write"];

    res.end = function instrumentedEnd(
      this: Response,
      ...args: Parameters<Response["end"]>
    ) {
      if (!finalized) {
        finalized = true;
        recordResponseBytes(args[0], typeof args[1] === "string" ? args[1] as BufferEncoding : undefined);
        const totalMs = elapsedMs(startedAt);
        const dbMetrics = getDbRequestMetricsSnapshot();
        if (!res.headersSent) {
          const timings = [`app;dur=${roundMetric(totalMs)}`];
          if (dbMetrics) {
            timings.push(
              `db;dur=${roundMetric(dbMetrics.queryDurationMs)}`,
              `db-acquire;dur=${roundMetric(dbMetrics.acquireWaitMs)}`,
              `sql;desc=\"${dbMetrics.queryCount}\"`,
            );
          }
          res.setHeader("Server-Timing", timings.join(", "));
        }
      }
      return originalEnd.apply(this, args);
    } as Response["end"];

    res.once("finish", () => {
      const totalMs = elapsedMs(startedAt);
      if (!shouldLogRequestPerformance(totalMs, res.statusCode)) return;
      const dbMetrics = getDbRequestMetricsSnapshot();
      const requestTelemetry = getRequestTelemetrySnapshot();
      const contentLength = Number(res.getHeader("Content-Length"));
      const responseHasNoBody = req.method === "HEAD" || res.statusCode === 204 || res.statusCode === 304;
      const responseBytes = responseHasNoBody
        ? 0
        : Number.isFinite(contentLength) && contentLength >= 0
          ? contentLength
          : requestTelemetry?.responseBytes ?? 0;
      const scopeResolveMs = requestTelemetry?.spans.scopeResolve ?? 0;
      const unattributedMs = Math.max(
        0,
        totalMs - (dbMetrics?.queryDurationMs ?? 0) - scopeResolveMs,
      );
      console.info("[request-performance]", JSON.stringify({
        requestId: res.locals.requestId,
        releaseId: process.env.RELEASE_ID || "unknown",
        method: req.method,
        path: requestMetricPath(req),
        status: res.statusCode,
        totalMs: roundMetric(totalMs),
        dbQueryCount: dbMetrics?.queryCount ?? 0,
        dbQueryDurationMs: roundMetric(dbMetrics?.queryDurationMs ?? 0),
        dbAcquireCount: dbMetrics?.acquireCount ?? 0,
        dbAcquireWaitMs: roundMetric(dbMetrics?.acquireWaitMs ?? 0),
        dbRetryCount: dbMetrics?.retryCount ?? 0,
        scopeResolveMs: roundMetric(scopeResolveMs),
        unattributedMs: roundMetric(unattributedMs),
        facetCacheHits: requestTelemetry?.caches.facet?.hit ?? 0,
        facetCacheMisses: requestTelemetry?.caches.facet?.miss ?? 0,
        coalescedReadStartedCount: getReadPathMetricsSnapshot()?.started ?? 0,
        coalescedReadMergedCount: getReadPathMetricsSnapshot()?.merged ?? 0,
        responseBytes,
      }));
    });

    next();
  })));
}
