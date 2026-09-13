import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPublicWebDraftSourceResolver } from "../src/lib/postgresPublicWebDraftSourceResolver.js";

type ObservedQuery = {
  text: string;
  values?: unknown[];
  queryTimeout?: number;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakePool(options: {
  identityRole?: string;
  identityOverrides?: Partial<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolinherit: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    has_role_membership: boolean;
    can_execute_safe_source: boolean;
    can_execute_v1: boolean;
    can_execute_authority_helper: boolean;
    can_execute_source_internal: boolean;
    can_execute_source_locked: boolean;
    can_create_public_schema: boolean;
    can_create_facade_schema: boolean;
    has_critical_table_dml: boolean;
  }>;
  sourceSha256?: string | null;
  sourceError?: Error;
  rollbackError?: Error;
  beforeQuery?: (query: ObservedQuery) => void | Promise<void>;
} = {}) {
  const queries: ObservedQuery[] = [];
  const releases: unknown[] = [];
  const connects: true[] = [];
  const client = {
    async query<T extends Record<string, unknown>>(
      input: string | {
        text: string;
        values?: unknown[];
        query_timeout?: number;
      },
      positionalValues?: unknown[],
    ) {
      const query = typeof input === "string"
        ? { text: input, values: positionalValues }
        : {
            text: input.text,
            values: input.values,
            queryTimeout: input.query_timeout,
          };
      queries.push(query);
      await options.beforeQuery?.(query);
      const { text } = query;
      if (text.includes("FROM pg_roles")) {
        return {
          rows: [{
            current_user: options.identityRole ?? "fas_public_web_executor",
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: false,
            rolreplication: false,
            rolbypassrls: false,
            rolcanlogin: true,
            has_role_membership: false,
            can_execute_safe_source: true,
            can_execute_v1: false,
            can_execute_authority_helper: false,
            can_execute_source_internal: false,
            can_execute_source_locked: false,
            can_create_public_schema: false,
            can_create_facade_schema: false,
            has_critical_table_dml: false,
            ...options.identityOverrides,
            tenant_setting: null,
            organization_setting: null,
          }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("resolve_source_sha256")) {
        if (options.sourceError) throw options.sourceError;
        return { rows: [{ source_sha256: options.sourceSha256 === undefined
          ? "a".repeat(64)
          : options.sourceSha256 }], rowCount: 1 } as unknown as {
          rows: T[];
          rowCount: number;
        };
      }
      if (text === "ROLLBACK" && options.rollbackError) {
        throw options.rollbackError;
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
    release(error?: unknown) { releases.push(error); },
  };
  return {
    pool: {
      connect: async () => {
        connects.push(true);
        return client;
      },
    } as never,
    client,
    connects,
    queries,
    releases,
  };
}

test("resolves one active source through a bounded read-only query", async () => {
  const fixture = fakePool();
  const resolver = new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool });
  const first = await resolver.resolve("PROGRAM", 42);
  assert.deepEqual(first, {
    entityType: "PROGRAM",
    entityId: 42,
    sourceSha256: first?.sourceSha256,
  });
  assert.match(first?.sourceSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(fixture.queries.some(({ text }) => text === "BEGIN READ ONLY"), true);
  assert.equal(fixture.queries.some(({ text }) => text === "COMMIT"), true);
  const source = fixture.queries.find(({ text }) =>
    text.includes("SELECT fas_public_web_v1.resolve_source_sha256("));
  assert.deepEqual(source?.values, ["PROGRAM", 42]);
  assert.match(source?.text ?? "", /resolve_source_sha256\(\$1::text, \$2::integer\)/);
  assert.doesNotMatch(source?.text ?? "", /false|true|_locked|_internal/);
  assert.doesNotMatch(
    source?.text ?? "",
    /service_fee_amount|commission_rate|contact_person|assigned_staff_ids/i,
  );
  const identityProbe = fixture.queries.find(({ text }) => text.includes("FROM pg_roles"));
  assert.equal(identityProbe?.values?.length, 1);
  const criticalRelations = identityProbe?.values?.[0];
  assert.ok(Array.isArray(criticalRelations));
  assert.equal(criticalRelations.length, new Set(criticalRelations).size);
  assert.deepEqual(
    [
      "public.users",
      "public.public_web_content_records",
      "public.programs",
      "public.website_pages",
    ].every((relation) => criticalRelations.includes(relation)),
    true,
  );
  assert.equal(
    fixture.queries.every(({ queryTimeout }) =>
      Number.isSafeInteger(queryTimeout) &&
      queryTimeout! >= 1 &&
      queryTimeout! <= 5_000),
    true,
  );
  const timeoutSetup = fixture.queries.find(({ text }) =>
    text.includes("set_config('statement_timeout'"));
  assert.deepEqual(timeoutSetup?.values?.length, 2);
  for (const value of timeoutSetup?.values ?? []) {
    assert.match(String(value), /^[1-9][0-9]{0,3}ms$/);
    assert.ok(Number.parseInt(String(value), 10) <= 5_000);
  }
});

test("source hashes are returned from the authoritative database resolver", async () => {
  const a = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool().pool,
  }).resolve("PROGRAM", 42);
  const b = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool().pool,
  }).resolve("PROGRAM", 42);
  const changed = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool({ sourceSha256: "b".repeat(64) }).pool,
  }).resolve("PROGRAM", 42);
  assert.equal(a?.sourceSha256, b?.sourceSha256);
  assert.notEqual(a?.sourceSha256, changed?.sourceSha256);
});

test("missing and invalid source references fail closed", async () => {
  const missing = new PostgresPublicWebDraftSourceResolver({
    pool: fakePool({ sourceSha256: null }).pool,
  });
  assert.equal(await missing.resolve("PROGRAM", 42), null);
  await assert.rejects(missing.resolve("PROGRAM", 0), /source_input_invalid/);
  await assert.rejects(
    missing.resolve("UNKNOWN" as "PROGRAM", 42),
    /source_input_invalid/,
  );
});

test("wrong executor and query failures cannot leak a dirty pooled transaction", async () => {
  const wrongRole = fakePool({ identityRole: "fas_migrator" });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: wrongRole.pool }).resolve(
      "PROGRAM",
      42,
    ),
    /executor_identity_invalid/,
  );
  assert.equal(wrongRole.queries.some(({ text }) => text === "BEGIN READ ONLY"), false);

  const failed = fakePool({ sourceError: new Error("database unavailable") });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: failed.pool }).resolve(
      "PROGRAM",
      42,
    ),
    /database unavailable/,
  );
  assert.equal(failed.queries.some(({ text }) => text === "ROLLBACK"), true);
  assert.equal(failed.releases.length, 1);
});

test("fails closed when safe facade is missing or an owner-private helper is granted", async () => {
  for (const identityOverrides of [
    { rolsuper: true },
    { rolcreatedb: true },
    { rolcreaterole: true },
    { rolinherit: true },
    { rolreplication: true },
    { rolbypassrls: true },
    { rolcanlogin: false },
    { has_role_membership: true },
    { can_execute_safe_source: false },
    { can_execute_v1: true },
    { can_execute_authority_helper: true },
    { can_execute_source_internal: true },
    { can_execute_source_locked: true },
    { can_create_public_schema: true },
    { can_create_facade_schema: true },
    { has_critical_table_dml: true },
  ]) {
    const fixture = fakePool({ identityOverrides });
    await assert.rejects(
      new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool }).resolve("PROGRAM", 42),
      /executor_identity_invalid/,
    );
    assert.equal(fixture.queries.some(({ text }) => text === "BEGIN READ ONLY"), false);
  }
});

test("rejects hostile resolver contexts without invoking accessors or proxy traps", async () => {
  const fixture = fakePool();
  const controller = new AbortController();
  let accessorReads = 0;
  const accessorContext = Object.defineProperties({}, {
    deadlineAt: {
      enumerable: true,
      get() {
        accessorReads += 1;
        return Date.now() + 1_000;
      },
    },
    signal: {
      enumerable: true,
      get() {
        accessorReads += 1;
        return controller.signal;
      },
    },
  });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool }).resolve(
      "PROGRAM",
      42,
      accessorContext as never,
    ),
    /source_context_invalid/,
  );
  assert.equal(accessorReads, 0);

  let proxyTraps = 0;
  const proxyContext = new Proxy(
    { deadlineAt: Date.now() + 1_000, signal: controller.signal },
    {
      get(target, key, receiver) {
        proxyTraps += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        proxyTraps += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        proxyTraps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTraps += 1;
        return Reflect.ownKeys(target);
      },
    },
  );
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool }).resolve(
      "PROGRAM",
      42,
      proxyContext,
    ),
    /source_context_invalid/,
  );
  assert.equal(proxyTraps, 0);
  assert.equal(fixture.connects.length, 0);

  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool }).resolve(
      "PROGRAM",
      42,
      {
        deadlineAt: Date.now() + 1_000,
        signal: {} as AbortSignal,
      },
    ),
    /source_context_invalid/,
  );
  assert.equal(fixture.connects.length, 0);
});

test("an already-aborted signal and an expired deadline fail before pool acquisition", async () => {
  const fixture = fakePool();
  const controller = new AbortController();
  controller.abort(new Error("untrusted caller reason"));
  const resolver = new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool });
  await assert.rejects(
    resolver.resolve("PROGRAM", 42, {
      deadlineAt: Date.now() + 5_000,
      signal: controller.signal,
    }),
    /public_web_draft_source_deadline_exceeded/,
  );
  await assert.rejects(
    resolver.resolve("PROGRAM", 42, {
      deadlineAt: Date.now() - 1,
      signal: new AbortController().signal,
    }),
    /public_web_draft_source_deadline_exceeded/,
  );
  assert.equal(fixture.connects.length, 0);
});

test("aborting pool acquisition quarantines and destroys a late client", async () => {
  const tracked = fakePool();
  const acquisition = deferred<typeof tracked.client>();
  const resolver = new PostgresPublicWebDraftSourceResolver({
    pool: { connect: () => acquisition.promise } as never,
  });
  const controller = new AbortController();
  const pending = resolver.resolve("PROGRAM", 42, {
    deadlineAt: Date.now() + 5_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /source_deadline_exceeded/);
  acquisition.resolve(tracked.client);
  await immediate();
  assert.equal(tracked.queries.length, 0);
  assert.equal(tracked.releases.length, 1);
  assert.match(String(tracked.releases[0]), /source_deadline_exceeded/);
});

test("an absolute deadline bounds a stalled query without caller abort", async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const fixture = fakePool({
    beforeQuery: async ({ text }) => {
      if (!text.includes("FROM pg_roles")) return;
      entered.resolve(undefined);
      await gate.promise;
    },
  });
  const startedAt = Date.now();
  const pending = new PostgresPublicWebDraftSourceResolver({
    pool: fixture.pool,
  }).resolve("PROGRAM", 42, {
    deadlineAt: startedAt + 50,
    signal: new AbortController().signal,
  });
  await entered.promise;
  await assert.rejects(pending, /source_deadline_exceeded/);
  assert.ok(Date.now() - startedAt < 1_000);
  gate.resolve(undefined);
  await immediate();
  assert.equal(fixture.releases.length, 1);
  assert.match(String(fixture.releases[0]), /source_deadline_exceeded/);
});

test("abort during identity probe destroys the client and observes a late rejection", async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const fixture = fakePool({
    beforeQuery: async ({ text }) => {
      if (!text.includes("FROM pg_roles")) return;
      entered.resolve(undefined);
      await gate.promise;
    },
  });
  const controller = new AbortController();
  const pending = new PostgresPublicWebDraftSourceResolver({
    pool: fixture.pool,
  }).resolve("PROGRAM", 42, {
    deadlineAt: Date.now() + 5_000,
    signal: controller.signal,
  });
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, /source_deadline_exceeded/);
  gate.reject(new Error("late identity rejection"));
  await immediate();
  assert.equal(fixture.releases.length, 1);
  assert.match(String(fixture.releases[0]), /source_deadline_exceeded/);
  assert.equal(fixture.queries.some(({ text }) => text === "BEGIN READ ONLY"), false);
});

test("abort during source query destroys the transaction instead of reusing it", async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const fixture = fakePool({
    beforeQuery: async ({ text }) => {
      if (!text.includes("SELECT fas_public_web_v1.resolve_source_sha256(")) return;
      entered.resolve(undefined);
      await gate.promise;
    },
  });
  const controller = new AbortController();
  const pending = new PostgresPublicWebDraftSourceResolver({
    pool: fixture.pool,
  }).resolve("PROGRAM", 42, {
    deadlineAt: Date.now() + 5_000,
    signal: controller.signal,
  });
  await entered.promise;
  controller.abort();
  await assert.rejects(pending, /source_deadline_exceeded/);
  gate.reject(new Error("late source rejection"));
  await immediate();
  assert.equal(fixture.releases.length, 1);
  assert.match(String(fixture.releases[0]), /source_deadline_exceeded/);
  assert.equal(fixture.queries.some(({ text }) => text === "COMMIT"), false);
  assert.equal(fixture.queries.some(({ text }) => text === "ROLLBACK"), false);
});

test("query read timeout destroys the connection and rollback failure is never pooled", async () => {
  const timedOut = fakePool({
    beforeQuery: ({ text }) => {
      if (text.includes("FROM pg_roles")) throw new Error("Query read timeout");
    },
  });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: timedOut.pool }).resolve(
      "PROGRAM",
      42,
    ),
    /source_deadline_exceeded/,
  );
  assert.equal(timedOut.releases.length, 1);
  assert.match(String(timedOut.releases[0]), /source_deadline_exceeded/);

  const rollbackFailed = fakePool({
    rollbackError: new Error("rollback unavailable"),
    sourceError: new Error("source failed"),
  });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({
      pool: rollbackFailed.pool,
    }).resolve("PROGRAM", 42),
    /source failed/,
  );
  assert.equal(rollbackFailed.releases.length, 1);
  assert.match(String(rollbackFailed.releases[0]), /rollback unavailable/);
});
