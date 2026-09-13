import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { types as utilTypes } from "node:util";

import { canonicalJson } from "./jsonCanonical.js";
import {
  buildServerBoundPublicWebDraftIntake,
  type PublicWebDraftIntakeRequest,
  type PublicWebDraftScope,
  type PublicWebDraftSourceBinding,
} from "./publicWebDraftIntakeBuilder.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  type PublicWebEntityType,
  type PublicWebLocale,
} from "./publicWebContentContract.js";
import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract.js";

const MAX_BATCH_ITEMS = 100;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_RESOLVER_CONCURRENCY = 4;
const MAX_PLAN_DURATION_MS = 30_000;
const MAX_ENTITY_ID = 2_147_483_647;
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERIFIED_BATCH_PLAN_BRAND = Symbol("fas.public-web.verified-draft-batch-plan.v1");
const VERIFIED_BATCH_PLANS = new WeakSet<object>();
const NATIVE_PROMISE = Promise;
const NATIVE_PROMISE_PROTOTYPE = Promise.prototype;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const NATIVE_PROMISE_SPECIES_GETTER = Object.getOwnPropertyDescriptor(
  Promise,
  Symbol.species,
)?.get;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = [
  "canonicalSlug",
  "contentJson",
  "entityId",
  "entityType",
  "generatorReceiptSha256",
  "idempotencyKey",
  "locale",
  "origin",
  "seoJson",
  "structuredDataJson",
  "summary",
  "title",
] as const;

export type PublicWebDraftBatchRejectReason =
  | "request_invalid"
  | "duplicate_target"
  | "duplicate_idempotency"
  | "source_missing"
  | "source_unavailable";

export type PublicWebDraftBatchAccepted = {
  index: number;
  request: PublicWebDraftIntakeRequest;
  source: PublicWebDraftSourceBinding;
};

export type PublicWebDraftBatchRejected = {
  index: number;
  reason: PublicWebDraftBatchRejectReason;
};

export type PublicWebDraftBatchPlan = {
  schemaVersion: 1;
  total: number;
  accepted: PublicWebDraftBatchAccepted[];
  rejected: PublicWebDraftBatchRejected[];
  planSha256: string;
};

export function isVerifiedPublicWebDraftBatchPlan(
  value: unknown,
): value is PublicWebDraftBatchPlan {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !VERIFIED_BATCH_PLANS.has(value)
  ) {
    return false;
  }
  const brand = Object.getOwnPropertyDescriptor(value, VERIFIED_BATCH_PLAN_BRAND);
  return brand?.value === true &&
    brand.enumerable === false &&
    brand.configurable === false &&
    brand.writable === false &&
    Object.isFrozen(value);
}

export type PublicWebDraftBatchApprovalTarget = Readonly<{
  entityType: PublicWebEntityType;
  locale: PublicWebLocale;
}>;

export type PublicWebDraftBatchSourceResolverContext = Readonly<{
  signal: AbortSignal;
  deadlineAt: number;
}>;

/**
 * The resolver must return an intrinsic Promise and normalize its result to a
 * plain data object before resolving it. ECMAScript Promise resolution reads a
 * fulfilled Proxy/thenable's `then` property before this planner can inspect
 * the candidate; the planner can guarantee zero candidate-property reads only
 * after that language-level assimilation boundary.
 */
export type PublicWebDraftBatchSourceResolver = (
  entityType: PublicWebEntityType,
  entityId: number,
  context: PublicWebDraftBatchSourceResolverContext,
) => Promise<unknown>;

const SOURCE_BINDING_KEYS = ["entityId", "entityType", "sourceSha256"] as const;

type ResolverOutcome =
  | Readonly<{ kind: "value"; value: unknown }>
  | Readonly<{ kind: "error" }>;

function observeNativeResolverPromise(value: unknown): Promise<ResolverOutcome> | null {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    utilTypes.isProxy(value) ||
    !utilTypes.isPromise(value)
  ) {
    return null;
  }
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  const constructorDescriptor = Object.getOwnPropertyDescriptor(
    NATIVE_PROMISE_PROTOTYPE,
    "constructor",
  );
  const thenDescriptor = Object.getOwnPropertyDescriptor(
    NATIVE_PROMISE_PROTOTYPE,
    "then",
  );
  const speciesDescriptor = Object.getOwnPropertyDescriptor(
    NATIVE_PROMISE,
    Symbol.species,
  );
  const ownDescriptors = Object.getOwnPropertyDescriptors(value);
  const hasUnsafeOwnProperty = ownKeys.some((key) => {
    if (typeof key === "string") return true;
    const descriptor = ownDescriptors[key as keyof typeof ownDescriptors];
    return !descriptor || !("value" in descriptor);
  });
  if (
    prototype !== NATIVE_PROMISE_PROTOTYPE ||
    hasUnsafeOwnProperty ||
    constructorDescriptor?.value !== NATIVE_PROMISE ||
    constructorDescriptor.get !== undefined ||
    constructorDescriptor.set !== undefined ||
    thenDescriptor?.value !== NATIVE_PROMISE_THEN ||
    thenDescriptor.get !== undefined ||
    thenDescriptor.set !== undefined ||
    speciesDescriptor?.get !== NATIVE_PROMISE_SPECIES_GETTER ||
    speciesDescriptor?.set !== undefined
  ) {
    return null;
  }
  return new NATIVE_PROMISE<ResolverOutcome>((resolve) => {
    try {
      Reflect.apply(NATIVE_PROMISE_THEN, value, [
        (candidate: unknown) => resolve({ kind: "value", value: candidate }),
        () => resolve({ kind: "error" }),
      ]);
    } catch {
      resolve({ kind: "error" });
    }
  });
}

function exactSourceBinding(
  value: unknown,
  expected: Readonly<{ entityType: PublicWebEntityType; entityId: number }>,
): PublicWebDraftSourceBinding | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    ownKeys.length !== SOURCE_BINDING_KEYS.length ||
    ownKeys.slice().sort().join("\0") !== [...SOURCE_BINDING_KEYS].sort().join("\0")
  ) {
    return undefined;
  }
  const values: Record<string, unknown> = Object.create(null);
  for (const key of SOURCE_BINDING_KEYS) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      return undefined;
    }
    values[key] = descriptor.value;
  }
  if (
    values.entityType !== expected.entityType ||
    values.entityId !== expected.entityId ||
    typeof values.sourceSha256 !== "string" ||
    !SHA256_RE.test(values.sourceSha256)
  ) {
    return undefined;
  }
  return Object.freeze({
    entityType: expected.entityType,
    entityId: expected.entityId,
    sourceSha256: values.sourceSha256,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRequestReference(value: unknown): {
  request: PublicWebDraftIntakeRequest;
  entityType: PublicWebEntityType;
  entityId: number;
  locale: PublicWebLocale;
  idempotencyKey: string;
} | null {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\0") !== [...REQUEST_KEYS].sort().join("\0") ||
    !PUBLIC_WEB_ENTITY_TYPES.includes(value.entityType as PublicWebEntityType) ||
    !Number.isSafeInteger(value.entityId) ||
    Number(value.entityId) < 1 ||
    Number(value.entityId) > MAX_ENTITY_ID ||
    !PROGRAM_SUPPORTED_LOCALES.includes(value.locale as PublicWebLocale) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
  ) {
    return null;
  }
  return {
    request: value as PublicWebDraftIntakeRequest,
    entityType: value.entityType as PublicWebEntityType,
    entityId: Number(value.entityId),
    locale: value.locale as PublicWebLocale,
    idempotencyKey: value.idempotencyKey,
  };
}

function validationIdentities(index: number) {
  const prefix = String(index + 1).padStart(8, "0");
  return [
    `${prefix}-0000-7000-8000-000000000001`,
    `${prefix}-0000-7000-8000-000000000002`,
  ];
}

function count(values: Array<string | null>) {
  const result = new Map<string, number>();
  for (const value of values) {
    if (value !== null) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

function deepFreezeDataSnapshot<T>(root: T): T {
  if (root === null || typeof root !== "object") return root;
  const pending: object[] = [root];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor || !("value" in descriptor)) continue;
      const child = descriptor.value;
      if (child !== null && typeof child === "object") pending.push(child);
    }
    Object.freeze(value);
  }
  return root;
}

function preparePublicWebDraftBatchRequests(requests: unknown): {
  requestsSnapshot: unknown[];
  references: Array<ReturnType<typeof exactRequestReference>>;
  targetCounts: Map<string, number>;
  keyCounts: Map<string, number>;
} {
  if (
    !Array.isArray(requests) ||
    requests.length < 1 ||
    requests.length > MAX_BATCH_ITEMS
  ) {
    throw new Error("public_web_draft_batch_input_invalid");
  }
  let serialized: string;
  try {
    serialized = canonicalJson(requests);
  } catch {
    throw new Error("public_web_draft_batch_input_invalid");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_BATCH_BYTES) {
    throw new Error("public_web_draft_batch_oversized");
  }
  const requestsSnapshot = deepFreezeDataSnapshot(JSON.parse(serialized) as unknown[]);
  const references = requestsSnapshot.map(exactRequestReference);
  const targetCounts = count(references.map((reference) => reference
    ? `${reference.entityType}:${reference.entityId}:${reference.locale}`
    : null));
  const keyCounts = count(references.map((reference) => reference?.idempotencyKey ?? null));
  return { requestsSnapshot, references, targetCounts, keyCounts };
}

/**
 * Returns exactly the entity/locale pairs whose rows can reach resolveSource.
 * Preview approval and execution planning intentionally share this parser and
 * duplicate classification so an approval/parser drift cannot expose a source
 * read for an unapproved target.
 */
export function collectPublicWebDraftBatchApprovalTargets(
  requests: unknown,
): readonly PublicWebDraftBatchApprovalTarget[] {
  const prepared = preparePublicWebDraftBatchRequests(requests);
  const unique = new Map<string, PublicWebDraftBatchApprovalTarget>();
  prepared.references.forEach((reference) => {
    if (!reference) return;
    const target = `${reference.entityType}:${reference.entityId}:${reference.locale}`;
    if (
      (prepared.targetCounts.get(target) ?? 0) > 1 ||
      (prepared.keyCounts.get(reference.idempotencyKey) ?? 0) > 1
    ) return;
    const pair = `${reference.entityType}\0${reference.locale}`;
    if (!unique.has(pair)) {
      unique.set(pair, Object.freeze({
        entityType: reference.entityType,
        locale: reference.locale,
      }));
    }
  });
  return Object.freeze(
    [...unique.values()].sort((left, right) => {
      const leftKey = `${left.entityType}\0${left.locale}`;
      const rightKey = `${right.entityType}\0${right.locale}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    }),
  );
}

export async function planPublicWebDraftBatch(input: {
  scope: PublicWebDraftScope;
  requests: unknown[];
  resolveSource: PublicWebDraftBatchSourceResolver;
  deadlineAt?: number;
  clock?: () => number;
}): Promise<PublicWebDraftBatchPlan> {
  if (
    !input ||
    !isRecord(input.scope) ||
    typeof input.scope.tenantId !== "string" ||
    typeof input.scope.organizationId !== "string" ||
    !UUID_V7_RE.test(input.scope.tenantId) ||
    !UUID_V7_RE.test(input.scope.organizationId) ||
    input.scope.tenantId.toLowerCase() === input.scope.organizationId.toLowerCase() ||
    typeof input.resolveSource !== "function" ||
    (input.deadlineAt !== undefined && (
      !Number.isSafeInteger(input.deadlineAt) || input.deadlineAt < 0
    )) ||
    (input.clock !== undefined && typeof input.clock !== "function")
  ) {
    throw new Error("public_web_draft_batch_input_invalid");
  }
  const clock = input.clock ?? Date.now;
  let lastClock: number | null = null;
  function readClock(): number | null {
    let observed: number;
    try {
      observed = clock();
    } catch {
      return null;
    }
    if (
      !Number.isSafeInteger(observed) ||
      observed < 0 ||
      (lastClock !== null && observed < lastClock)
    ) {
      return null;
    }
    lastClock = observed;
    return observed;
  }
  const startedAt = readClock();
  if (startedAt === null || startedAt > Number.MAX_SAFE_INTEGER - MAX_PLAN_DURATION_MS) {
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  const deadlineAt = Math.min(
    input.deadlineAt ?? startedAt + MAX_PLAN_DURATION_MS,
    startedAt + MAX_PLAN_DURATION_MS,
  );
  const durationMs = deadlineAt - startedAt;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  const wallStartedAt = performance.now();
  let lastWallClock = wallStartedAt;
  function readWallElapsed(): number | null {
    const observed = performance.now();
    if (
      !Number.isFinite(observed) ||
      observed < lastWallClock ||
      observed < wallStartedAt
    ) return null;
    lastWallClock = observed;
    return observed - wallStartedAt;
  }

  let prepared: ReturnType<typeof preparePublicWebDraftBatchRequests>;
  try {
    prepared = preparePublicWebDraftBatchRequests(input.requests);
  } catch (error) {
    const failedAt = readClock();
    const failedWallElapsed = readWallElapsed();
    if (
      failedAt === null ||
      failedWallElapsed === null ||
      failedAt >= deadlineAt ||
      failedWallElapsed >= durationMs
    ) {
      throw new Error("public_web_draft_batch_deadline_exceeded");
    }
    throw error;
  }
  const preparedAt = readClock();
  const preparedWallElapsed = readWallElapsed();
  if (
    preparedAt === null ||
    preparedWallElapsed === null ||
    preparedAt >= deadlineAt ||
    preparedWallElapsed >= durationMs
  ) {
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  const {
    requestsSnapshot,
    references,
    targetCounts,
    keyCounts,
  } = prepared;
  const scopeSnapshot: PublicWebDraftScope = Object.freeze({
    tenantId: input.scope.tenantId.toLowerCase(),
    organizationId: input.scope.organizationId.toLowerCase(),
  });
  const accepted: PublicWebDraftBatchAccepted[] = [];
  const rejected: PublicWebDraftBatchRejected[] = [];
  const abortController = new AbortController();
  const resolverContext = Object.freeze({
    signal: abortController.signal,
    deadlineAt,
  });
  const DEADLINE = Symbol("public_web_draft_batch_deadline");
  let deadlineExceeded = false;
  let releaseDeadline!: () => void;
  const deadlineReached = new Promise<typeof DEADLINE>((resolve) => {
    releaseDeadline = () => resolve(DEADLINE);
  });
  function failDeadline() {
    if (deadlineExceeded) return;
    deadlineExceeded = true;
    abortController.abort();
    releaseDeadline();
  }
  const remainingMs = Math.min(
    deadlineAt - preparedAt,
    durationMs - preparedWallElapsed,
  );
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  const deadlineTimer = setTimeout(failDeadline, remainingMs);
  let cursor = 0;

  async function worker() {
    while (true) {
      if (deadlineExceeded) return;
      const beforeWork = readClock();
      const beforeWorkWallElapsed = readWallElapsed();
      if (
        beforeWork === null ||
        beforeWorkWallElapsed === null ||
        beforeWork >= deadlineAt ||
        beforeWorkWallElapsed >= durationMs
      ) {
        failDeadline();
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= requestsSnapshot.length) return;
      const reference = references[index];
      if (!reference) {
        rejected.push({ index, reason: "request_invalid" });
        continue;
      }
      const target = `${reference.entityType}:${reference.entityId}:${reference.locale}`;
      if ((targetCounts.get(target) ?? 0) > 1) {
        rejected.push({ index, reason: "duplicate_target" });
        continue;
      }
      if ((keyCounts.get(reference.idempotencyKey) ?? 0) > 1) {
        rejected.push({ index, reason: "duplicate_idempotency" });
        continue;
      }
      let resolverPromise: Promise<ResolverOutcome> | null;
      try {
        resolverPromise = observeNativeResolverPromise(input.resolveSource(
          reference.entityType,
          reference.entityId,
          resolverContext,
        ));
      } catch {
        rejected.push({ index, reason: "source_unavailable" });
        continue;
      }
      if (!resolverPromise) {
        rejected.push({ index, reason: "source_unavailable" });
        continue;
      }
      const outcome = await Promise.race([
        resolverPromise,
        deadlineReached.then(() => ({ kind: "deadline" as const })),
      ]);
      if (outcome.kind === "deadline") return;
      const afterResolution = readClock();
      const afterResolutionWallElapsed = readWallElapsed();
      if (
        afterResolution === null ||
        afterResolutionWallElapsed === null ||
        afterResolution >= deadlineAt ||
        afterResolutionWallElapsed >= durationMs
      ) {
        failDeadline();
        return;
      }
      if (outcome.kind === "error") {
        rejected.push({ index, reason: "source_unavailable" });
        continue;
      }
      const source = exactSourceBinding(outcome.value, reference);
      if (!source) {
        rejected.push({
          index,
          reason: source === null ? "source_missing" : "source_unavailable",
        });
        continue;
      }
      const sourceSnapshot = source;
      const identities = validationIdentities(index);
      const built = buildServerBoundPublicWebDraftIntake({
        scope: scopeSnapshot,
        source: sourceSnapshot,
        request: reference.request,
        now: 2_000_000_000_000,
        newUuidV7: () => identities.shift() ?? "",
      });
      if (!built.ok) {
        rejected.push({ index, reason: "request_invalid" });
        continue;
      }
      accepted.push({ index, request: reference.request, source: sourceSnapshot });
    }
  }
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_RESOLVER_CONCURRENCY, requestsSnapshot.length) },
        () => worker(),
      ),
    );
  } finally {
    clearTimeout(deadlineTimer);
  }
  if (deadlineExceeded) {
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  accepted.sort((left, right) => left.index - right.index);
  rejected.sort((left, right) => left.index - right.index);
  const planSha256 = crypto
    .createHash("sha256")
    .update("fas.public-web.draft-batch-plan.v1\0", "utf8")
    .update(canonicalJson({
      accepted,
      rejected,
      scope: scopeSnapshot,
      total: requestsSnapshot.length,
    }), "utf8")
    .digest("hex");
  const completedAt = readClock();
  const completedWallElapsed = readWallElapsed();
  if (
    completedAt === null ||
    completedWallElapsed === null ||
    completedAt >= deadlineAt ||
    completedWallElapsed >= durationMs
  ) {
    failDeadline();
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  accepted.forEach(Object.freeze);
  rejected.forEach(Object.freeze);
  Object.freeze(accepted);
  Object.freeze(rejected);
  const plan: PublicWebDraftBatchPlan = {
    schemaVersion: 1,
    total: requestsSnapshot.length,
    accepted,
    rejected,
    planSha256,
  };
  Object.defineProperty(plan, VERIFIED_BATCH_PLAN_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(plan);
  VERIFIED_BATCH_PLANS.add(plan);
  const finalizedAt = readClock();
  const finalizedWallElapsed = readWallElapsed();
  if (
    finalizedAt === null ||
    finalizedWallElapsed === null ||
    finalizedAt >= deadlineAt ||
    finalizedWallElapsed >= durationMs
  ) {
    failDeadline();
    throw new Error("public_web_draft_batch_deadline_exceeded");
  }
  return plan;
}
