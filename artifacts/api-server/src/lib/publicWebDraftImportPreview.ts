import crypto from "node:crypto";

import { canonicalJson } from "./jsonCanonical.js";
import {
  buildPublicWebCanonicalPath,
  type PublicWebEntityType,
} from "./publicWebContentContract.js";
import {
  collectPublicWebDraftBatchApprovalTargets,
  planPublicWebDraftBatch,
  type PublicWebDraftBatchRejectReason,
  type PublicWebDraftBatchSourceResolver,
} from "./publicWebDraftBatchPlanner.js";
import {
  parsePublicWebDraftImportManifest,
} from "./publicWebDraftImportManifest.js";
import {
  isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest,
  type PublicWebImportAdapterApprovalRequest,
  type PublicWebImportAdapterApprovalSnapshot,
} from "./publicWebImportAdapterApproval.js";

export type PublicWebDraftImportApprovalContext = Readonly<{
  tenantId: string;
  organizationId: string;
  actorPrincipalId: string;
  actorMembershipId: string;
  selectionId: string;
  sessionGeneration: number;
  contractVersion: string;
  mappingSchemaVersion: number;
  currentRuntimeReleaseId: string;
  registryGeneration: number;
}>;

export type PublicWebDraftImportApprovalResolutionContext = Readonly<{
  signal: AbortSignal;
  deadlineAt: number;
}>;

export type PublicWebDraftImportAdapterApprovalResolver = (
  request: PublicWebImportAdapterApprovalRequest,
  context: PublicWebDraftImportApprovalResolutionContext,
) => Promise<unknown>;

const MAX_PREVIEW_DURATION_MS = 30_000;
const MAX_APPROVAL_CONCURRENCY = 4;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const APPROVAL_CONTEXT_KEYS = [
  "actorMembershipId",
  "actorPrincipalId",
  "contractVersion",
  "currentRuntimeReleaseId",
  "mappingSchemaVersion",
  "organizationId",
  "registryGeneration",
  "selectionId",
  "sessionGeneration",
  "tenantId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function parseApprovalContext(
  value: unknown,
): PublicWebDraftImportApprovalContext | null {
  if (!isRecord(value) || !hasExactKeys(value, APPROVAL_CONTEXT_KEYS)) {
    return null;
  }
  if (
    typeof value.tenantId !== "string" ||
    !UUID_V7_RE.test(value.tenantId) ||
    typeof value.organizationId !== "string" ||
    !UUID_V7_RE.test(value.organizationId) ||
    value.tenantId.toLowerCase() === value.organizationId.toLowerCase() ||
    typeof value.actorPrincipalId !== "string" ||
    !UUID_V7_RE.test(value.actorPrincipalId) ||
    typeof value.actorMembershipId !== "string" ||
    !UUID_V7_RE.test(value.actorMembershipId) ||
    typeof value.selectionId !== "string" ||
    !UUID_V7_RE.test(value.selectionId) ||
    !positiveInteger(value.sessionGeneration) ||
    typeof value.contractVersion !== "string" ||
    !VERSION_RE.test(value.contractVersion) ||
    !positiveInteger(value.mappingSchemaVersion) ||
    typeof value.currentRuntimeReleaseId !== "string" ||
    !RELEASE_ID_RE.test(value.currentRuntimeReleaseId) ||
    !positiveInteger(value.registryGeneration)
  ) return null;

  return Object.freeze({
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId.toLowerCase(),
    actorPrincipalId: value.actorPrincipalId.toLowerCase(),
    actorMembershipId: value.actorMembershipId.toLowerCase(),
    selectionId: value.selectionId.toLowerCase(),
    sessionGeneration: value.sessionGeneration,
    contractVersion: value.contractVersion,
    mappingSchemaVersion: value.mappingSchemaVersion,
    currentRuntimeReleaseId: value.currentRuntimeReleaseId,
    registryGeneration: value.registryGeneration,
  });
}

function isImportRow(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).origin === "IMPORT";
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString() === value ? parsed : null;
  } catch {
    return null;
  }
}

function approvalLineage(snapshot: PublicWebImportAdapterApprovalSnapshot): string {
  return canonicalJson({
    scope: snapshot.scope,
    actor: snapshot.actor,
    adapter: snapshot.adapter,
    compatibleTargets: snapshot.compatibleTargets,
    evidence: snapshot.evidence,
  });
}

function approvalValidUntil(
  snapshot: PublicWebImportAdapterApprovalSnapshot,
): number | null {
  const expiries = [
    snapshot.actor.authorityExpiresAt,
    snapshot.evidence.validationExpiresAt,
    snapshot.evidence.makerAuthorityExpiresAt,
    snapshot.evidence.checkerAuthorityExpiresAt,
  ].map(timestamp);
  if (expiries.some((value) => value === null)) return null;
  return Math.min(...(expiries as number[]));
}

function aggregateApprovalSha256(
  approvals: readonly PublicWebImportAdapterApprovalSnapshot[],
): string {
  const uses = approvals
    .map((snapshot) => ({
      entityType: snapshot.requestedUse.entityType,
      locale: snapshot.requestedUse.locale,
      approvalSnapshotSha256: snapshot.approvalSnapshotSha256,
    }))
    .sort((left, right) => {
      const leftKey = `${left.entityType}\0${left.locale}`;
      const rightKey = `${right.entityType}\0${right.locale}`;
      return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
    });
  return crypto
    .createHash("sha256")
    .update("fas.public-web.import-adapter-approval-set.v1\0", "utf8")
    .update(canonicalJson(uses), "utf8")
    .digest("hex");
}

async function resolveBeforeDeadline(input: {
  resolver: PublicWebDraftImportAdapterApprovalResolver;
  request: PublicWebImportAdapterApprovalRequest;
  deadlineAt: number;
  clock: () => number;
  batchSignal: AbortSignal;
}): Promise<unknown> {
  const observed = input.clock();
  if (
    !Number.isSafeInteger(observed) ||
    observed < 0 ||
    observed >= input.deadlineAt
  ) throw new Error("public_web_import_adapter_approval_deadline_exceeded");

  const controller = new AbortController();
  const abort = () => controller.abort();
  input.batchSignal.addEventListener("abort", abort, { once: true });
  if (input.batchSignal.aborted) controller.abort();
  // The injected duration clock may move backwards; the real timer therefore
  // has its own absolute 30-second ceiling as well as the shared deadline.
  const timeoutMs = Math.min(
    MAX_PREVIEW_DURATION_MS,
    Math.max(1, input.deadlineAt - observed),
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: (() => void) | undefined;
  const cutoff = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(
      new Error("public_web_import_adapter_approval_deadline_exceeded"),
    );
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  });

  try {
    const resolved = await Promise.race([
      Promise.resolve().then(() => input.resolver(
        input.request,
        Object.freeze({
          signal: controller.signal,
          deadlineAt: input.deadlineAt,
        }),
      )),
      cutoff,
    ]);
    const completed = input.clock();
    if (
      !Number.isSafeInteger(completed) ||
      completed < 0 ||
      completed >= input.deadlineAt
    ) throw new Error("public_web_import_adapter_approval_deadline_exceeded");
    return resolved;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (rejectOnAbort !== undefined) {
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
    input.batchSignal.removeEventListener("abort", abort);
  }
}

export type PublicWebDraftImportPreviewSuccess = {
  ok: true;
  schemaVersion: 1;
  manifest: {
    manifestSha256: string;
    adapterId: string;
    adapterVersion: string;
    mappingSha256: string;
    generatedAt: string;
    expiresAt: string;
  };
  approval: {
    adapterApprovalSha256: string;
    validUntil: number;
  } | null;
  plan: {
    planSha256: string;
    total: number;
    acceptedCount: number;
    rejectedCount: number;
    executionEligible: boolean;
    requiresPartialConfirmation: boolean;
  };
  accepted: Array<{
    index: number;
    entityType: PublicWebEntityType;
    entityId: number;
    locale: string;
    canonicalPath: string;
    title: string;
  }>;
  rejected: Array<{
    index: number;
    reason: PublicWebDraftBatchRejectReason;
  }>;
};

export type PublicWebDraftImportPreviewResult =
  | PublicWebDraftImportPreviewSuccess
  | {
      ok: false;
      reason: "manifest_invalid" | "adapter_unapproved" | "plan_invalid";
    };

export async function previewPublicWebDraftImport(input: {
  approvalContext: PublicWebDraftImportApprovalContext;
  manifest: unknown;
  resolveAdapterApproval: PublicWebDraftImportAdapterApprovalResolver;
  resolveSource: PublicWebDraftBatchSourceResolver;
  now?: number;
  approvalNow?: () => number;
  clock?: () => number;
}): Promise<PublicWebDraftImportPreviewResult> {
  const clock = input?.clock ?? Date.now;
  const approvalNow = input?.approvalNow ?? Date.now;
  if (typeof clock !== "function") return { ok: false, reason: "plan_invalid" };
  const startedAt = clock();
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    !Number.isSafeInteger(startedAt + MAX_PREVIEW_DURATION_MS)
  ) return { ok: false, reason: "plan_invalid" };
  const deadlineAt = startedAt + MAX_PREVIEW_DURATION_MS;
  const observedAt = input?.now ?? Date.now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    return { ok: false, reason: "manifest_invalid" };
  }
  if (typeof approvalNow !== "function") {
    return { ok: false, reason: "adapter_unapproved" };
  }
  const parsedApprovalContext = parseApprovalContext(input?.approvalContext);
  if (
    !parsedApprovalContext ||
    typeof input?.resolveAdapterApproval !== "function"
  ) return { ok: false, reason: "adapter_unapproved" };
  if (typeof input?.resolveSource !== "function") {
    return { ok: false, reason: "plan_invalid" };
  }

  const parsedManifest = parsePublicWebDraftImportManifest(input?.manifest, {
    now: observedAt,
  });
  if (!parsedManifest) return { ok: false, reason: "manifest_invalid" };
  const approvalContext = parsedApprovalContext;
  const parsed = parsedManifest;
  const requests = parsed.manifest.rows.map((row) => isImportRow(row) ? row : null);
  let targets: ReturnType<typeof collectPublicWebDraftBatchApprovalTargets>;
  try {
    targets = collectPublicWebDraftBatchApprovalTargets(requests);
  } catch {
    return { ok: false, reason: "plan_invalid" };
  }

  const approvals: Array<PublicWebImportAdapterApprovalSnapshot | null> =
    Array.from({ length: targets.length }, () => null);
  const batchController = new AbortController();
  let approvalFailure = false;
  let cursor = 0;
  let lineage: string | null = null;
  let lastApprovalObservedAt = observedAt;

  async function approvalWorker() {
    while (!approvalFailure) {
      const index = cursor;
      cursor += 1;
      if (index >= targets.length) return;
      const target = targets[index];
      if (!target) {
        approvalFailure = true;
        batchController.abort();
        return;
      }
      const request = Object.freeze({
        tenantId: approvalContext.tenantId,
        organizationId: approvalContext.organizationId,
        actorPrincipalId: approvalContext.actorPrincipalId,
        actorMembershipId: approvalContext.actorMembershipId,
        selectionId: approvalContext.selectionId,
        sessionGeneration: approvalContext.sessionGeneration,
        adapterId: parsed.manifest.adapter.id,
        adapterVersion: parsed.manifest.adapter.version,
        mappingSha256: parsed.manifest.adapter.mappingSha256,
        contractVersion: approvalContext.contractVersion,
        mappingSchemaVersion: approvalContext.mappingSchemaVersion,
        runtimeReleaseId: approvalContext.currentRuntimeReleaseId,
        registryGeneration: approvalContext.registryGeneration,
        entityType: target.entityType,
        locale: target.locale,
      }) satisfies PublicWebImportAdapterApprovalRequest;
      try {
        const candidate = await resolveBeforeDeadline({
          resolver: input.resolveAdapterApproval,
          request,
          deadlineAt,
          clock,
          batchSignal: batchController.signal,
        });
        const approvalObservedAt = approvalNow();
        if (
          !Number.isSafeInteger(approvalObservedAt) ||
          approvalObservedAt < observedAt ||
          approvalObservedAt < lastApprovalObservedAt
        ) throw new Error("adapter_unapproved");
        lastApprovalObservedAt = approvalObservedAt;
        const verified =
          isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest(
          candidate,
          {
            now: approvalObservedAt,
            request,
          },
        );
        if (!verified) throw new Error("adapter_unapproved");
        const candidateLineage = approvalLineage(candidate);
        const candidateValidUntil = approvalValidUntil(candidate);
        if (
          candidateValidUntil === null ||
          candidateValidUntil <= approvalObservedAt ||
          (lineage !== null && lineage !== candidateLineage)
        ) throw new Error("adapter_unapproved");
        lineage = candidateLineage;
        approvals[index] = candidate;
      } catch {
        approvalFailure = true;
        batchController.abort();
        return;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_APPROVAL_CONCURRENCY, targets.length) },
      () => approvalWorker(),
    ),
  );
  const verifiedApprovals = approvals.filter(
    (approval): approval is PublicWebImportAdapterApprovalSnapshot =>
      approval !== null,
  );
  if (
    approvalFailure ||
    verifiedApprovals.length !== targets.length
  ) return { ok: false, reason: "adapter_unapproved" };
  const finalizedValidUntil = approvals.length === 0
    ? null
    : approvalValidUntil(verifiedApprovals[0]!);
  if (
    approvals.length > 0 &&
    (
      finalizedValidUntil === null ||
      finalizedValidUntil <= lastApprovalObservedAt
    )
  ) return { ok: false, reason: "adapter_unapproved" };

  const approval = approvals.length === 0
    ? null
    : {
        adapterApprovalSha256: aggregateApprovalSha256(verifiedApprovals),
        validUntil: finalizedValidUntil!,
      };

  let plan: Awaited<ReturnType<typeof planPublicWebDraftBatch>>;
  try {
    plan = await planPublicWebDraftBatch({
      scope: {
        tenantId: approvalContext.tenantId,
        organizationId: approvalContext.organizationId,
      },
      requests,
      resolveSource: input.resolveSource,
      deadlineAt,
      clock,
    });
  } catch {
    return { ok: false, reason: "plan_invalid" };
  }

  const accepted = plan.accepted.map((item) => ({
    index: item.index,
    entityType: item.request.entityType,
    entityId: item.request.entityId,
    locale: item.request.locale,
    canonicalPath: buildPublicWebCanonicalPath({
      entityType: item.request.entityType,
      entityId: item.request.entityId,
      locale: item.request.locale,
      slug: item.request.canonicalSlug,
    }),
    title: item.request.title,
  }));
  if (accepted.length > 0 && approval === null) {
    return { ok: false, reason: "plan_invalid" };
  }

  return {
    ok: true,
    schemaVersion: 1,
    manifest: {
      manifestSha256: parsed.manifestSha256,
      adapterId: parsed.manifest.adapter.id,
      adapterVersion: parsed.manifest.adapter.version,
      mappingSha256: parsed.manifest.adapter.mappingSha256,
      generatedAt: parsed.manifest.generatedAt,
      expiresAt: parsed.manifest.expiresAt,
    },
    approval,
    plan: {
      planSha256: plan.planSha256,
      total: plan.total,
      acceptedCount: accepted.length,
      rejectedCount: plan.rejected.length,
      executionEligible: accepted.length > 0,
      requiresPartialConfirmation: accepted.length > 0 && plan.rejected.length > 0,
    },
    accepted,
    rejected: plan.rejected,
  };
}
