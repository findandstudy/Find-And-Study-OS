import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import ts from "typescript";
import {
  CourseFinderApiError,
  createCourseFinderApiClient,
  waitForCourseFinderRetry,
} from "../src/components/course-finder/api.js";

const noWait = async () => {};
const client = (fetcher: typeof fetch) => createCourseFinderApiClient({ fetch: fetcher, wait: noWait });

test("successful reads retain credentials, headers and payload", async () => {
  let calls = 0;
  const request = client(async (_url, options) => {
    calls++;
    assert.equal(options?.credentials, "include");
    assert.equal(new Headers(options?.headers).get("x-csrf-token"), "test-only");
    return Response.json({ programs: [] });
  });
  assert.deepEqual(await request("/api/course-finder", { headers: { "x-csrf-token": "test-only" } }), { programs: [] });
  assert.equal(calls, 1);
});

for (const status of [502, 503, 504]) {
  test(`persistent HTTP ${status} stops after four attempts including QueryClient`, async () => {
    let calls = 0;
    const request = client(async () => { calls++; return new Response("upstream unavailable", { status }); });
    const queries = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } } });
    try {
      await assert.rejects(queries.fetchQuery({ queryKey: ["programs", status], retry: false, queryFn: () => request("/api/course-finder") }),
        (error: unknown) => error instanceof CourseFinderApiError && error.status === status && error.transient);
      assert.equal(calls, 4);
    } finally { queries.clear(); }
  });
}

test("network failures have the same four-attempt budget", async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls++; throw new TypeError("offline"); })("/api/course-finder"), /Network request failed/);
  assert.equal(calls, 4);
});

test("a recovered transient read returns its real result", async () => {
  let calls = 0;
  const request = client(async () => ++calls < 3 ? new Response(null, { status: 503 }) : Response.json({ count: 12 }));
  assert.deepEqual(await request("/api/course-finder"), { count: 12 });
  assert.equal(calls, 3);
});

for (const status of [400, 401, 403, 404, 409, 429, 500]) {
  test(`HTTP ${status} is not retried`, async () => {
    let calls = 0;
    await assert.rejects(client(async () => { calls++; return new Response("failed", { status }); })("/api/course-finder"));
    assert.equal(calls, 1);
  });
}

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test(`${method} is never automatically replayed`, async () => {
    for (const networkFailure of [true, false]) {
      let calls = 0;
      const request = client(async () => {
        calls++;
        if (networkFailure) throw new TypeError("offline");
        return new Response(null, { status: 503 });
      });
      await assert.rejects(request("/api/applications", { method, body: "{}" }));
      assert.equal(calls, 1);
    }
  });
}

test("204 and HEAD do not attempt JSON parsing", async () => {
  assert.equal(await client(async () => new Response(null, { status: 204 }))("/api/course-finder"), null);
  assert.equal(await client(async () => new Response(null))("/api/course-finder", { method: "HEAD" }), null);
});

test("HTML errors are not exposed as user-facing markup", async () => {
  await assert.rejects(client(async () => new Response("<html>private gateway details</html>", { status: 500, headers: { "content-type": "text/html" } }))("/api/course-finder"),
    (error: unknown) => error instanceof CourseFinderApiError && error.message === "API 500");
});

test("pre-aborted requests perform no fetch", async () => {
  let calls = 0;
  const signal = AbortSignal.abort(new Error("cancelled"));
  await assert.rejects(client(async () => { calls++; return Response.json({}); })("/api/course-finder", { signal }), /cancelled/);
  assert.equal(calls, 0);
});

test("cancelling backoff prevents the next request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const request = createCourseFinderApiClient({
    fetch: async () => { calls++; return new Response(null, { status: 503 }); },
    wait: async (attempt, signal) => {
      const waiting = waitForCourseFinderRetry(attempt, signal);
      controller.abort(new Error("user cancelled"));
      await waiting;
    },
  });
  await assert.rejects(request("/api/course-finder", { signal: controller.signal }), /user cancelled/);
  assert.equal(calls, 1);
});

test("one deadline aborts a stalled fetch without restarting the budget", async () => {
  let calls = 0;
  const request = createCourseFinderApiClient({ readTimeoutMs: 20, wait: noWait,
    fetch: async (_url, options) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
      });
    },
  });
  await assert.rejects(request("/api/course-finder"), /Request timed out/);
  assert.equal(calls, 1);
});

test("every Course Finder query and prefetch disables the outer retry owner", async () => {
  const source = await readFile(new URL("../src/pages/staff/CourseFinder.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("CourseFinder.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      if (["useQuery", "fetchQuery", "prefetchQuery"].includes(name)) {
        const options = node.arguments[0];
        assert.ok(options && ts.isObjectLiteralExpression(options));
        const retry = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === "retry");
        assert.ok(retry && ts.isPropertyAssignment(retry) && retry.initializer.kind === ts.SyntaxKind.FalseKeyword,
          `${name} at ${file.getLineAndCharacterOfPosition(node.pos).line + 1} must disable outer retries`);
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(count >= 10, "all query consumers are covered");
  assert.ok(source.includes('headers.set("x-csrf-token", getCsrfToken())'), "mutation CSRF header remains present");
});

for (const timedOut of [true, false]) {
  test(`a stalled JSON body preserves ${timedOut ? "the transient deadline" : "caller cancellation"}`, async () => {
    let calls = 0;
    const controller = new AbortController();
    const cancelReason = new Error("caller cancelled body");
    const request = createCourseFinderApiClient({ readTimeoutMs: 30, wait: noWait,
      fetch: async (_url, options) => {
        calls++;
        return new Response(new ReadableStream({ start(stream) {
          stream.enqueue(new TextEncoder().encode('{"partial":'));
          options!.signal!.addEventListener("abort", () => stream.error(new DOMException("body aborted", "AbortError")), { once: true });
          if (!timedOut) queueMicrotask(() => controller.abort(cancelReason));
        } }));
      },
    });
    await assert.rejects(request("/api/course-finder", { signal: controller.signal }),
      (error: unknown) => timedOut
        ? error instanceof CourseFinderApiError && error.transient && error.message === "Request timed out"
        : error === cancelReason);
    assert.equal(calls, 1);
  });
}

test("invalid JSON is not hidden as a transient or automatically retried", async () => {
  let calls = 0;
  await assert.rejects(client(async () => { calls++; return new Response("not JSON"); })("/api/course-finder"), SyntaxError);
  assert.equal(calls, 1);
});
