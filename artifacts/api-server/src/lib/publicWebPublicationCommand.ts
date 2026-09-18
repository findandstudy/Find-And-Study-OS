import crypto from "node:crypto";

import {
  evaluateActiveTenantCapability,
  isSelectionBoundActiveTenantContext,
  type ActiveContextDecision,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "./activeTenantContext.js";

export const PUBLIC_WEB_PUBLICATION_COMMANDS = [
  "SUBMIT_REVIEW",
  "RETURN_DRAFT",
  "APPROVE",
  "PUBLISH",
  "ENABLE_INDEX",
  "DISABLE_INDEX",
  "MARK_STALE",
  "RETIRE",
] as const;

export type PublicWebPublicationCommandType =
  (typeof PUBLIC_WEB_PUBLICATION_COMMANDS)[number];

export const PUBLIC_WEB_PUBLICATION_CAPABILITIES = {
  SUBMIT_REVIEW: "public_web.content.write",
  RETURN_DRAFT: "public_web.content.review",
  APPROVE: "public_web.content.review",
  PUBLISH: "public_web.content.publish",
  ENABLE_INDEX: "public_web.content.index",
  DISABLE_INDEX: "public_web.content.index",
  MARK_STALE: "public_web.content.write",
  RETIRE: "public_web.content.publish",
} as const satisfies Record<PublicWebPublicationCommandType, string>;

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const STALE_REASON_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

export type PublicWebPublicationCommand = {
  type: PublicWebPublicationCommandType;
  tenantId: string;
  organizationId: string;
  contentRecordId: string;
  revisionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  evidenceSha256: string;
  staleReasonCode: string | null;
};

export type PublicWebMutationAssurance = {
  stepUpSatisfied: boolean;
  approvalSatisfied: boolean;
  impersonating: boolean;
};

export type AuthorizedPublicWebPublicationCommand = {
  command: PublicWebPublicationCommand;
  capabilityKey: string;
  requestHash: string;
  decisionReceipt: ActiveContextDecision["receipt"];
};

export type PublicWebPublicationAuthorizationFailure =
  | "invalid_command"
  | "context_not_selection_bound"
  | "impersonation_forbidden"
  | "authorization_denied";

export type PublicWebPublicationAuthorizationResult =
  | { ok: true; value: AuthorizedPublicWebPublicationCommand }
  | {
      ok: false;
      reason: PublicWebPublicationAuthorizationFailure;
      detail?: string;
      decisionReceipt?: ActiveContextDecision["receipt"];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashPublicWebPublicationCommand(
  command: PublicWebPublicationCommand,
): string {
  const payload = {
    type: command.type,
    tenantId: command.tenantId,
    organizationId: command.organizationId,
    contentRecordId: command.contentRecordId,
    revisionId: command.revisionId,
    expectedVersion: command.expectedVersion,
    evidenceSha256: command.evidenceSha256,
    staleReasonCode: command.staleReasonCode,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)), "utf8")
    .digest("hex");
}

export function parsePublicWebPublicationCommand(
  value: unknown,
): PublicWebPublicationCommand | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "contentRecordId",
      "evidenceSha256",
      "expectedVersion",
      "idempotencyKey",
      "organizationId",
      "revisionId",
      "staleReasonCode",
      "tenantId",
      "type",
    ]) ||
    !PUBLIC_WEB_PUBLICATION_COMMANDS.includes(
      value.type as PublicWebPublicationCommandType,
    ) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.organizationId) ||
    !isUuidV7(value.contentRecordId) ||
    !isUuidV7(value.revisionId) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    Number(value.expectedVersion) < 1 ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey) ||
    typeof value.evidenceSha256 !== "string" ||
    !SHA256_RE.test(value.evidenceSha256) ||
    !(
      value.staleReasonCode === null ||
      (typeof value.staleReasonCode === "string" &&
        STALE_REASON_RE.test(value.staleReasonCode))
    ) ||
    ((value.type === "MARK_STALE") !== (value.staleReasonCode !== null))
  ) {
    return null;
  }

  return {
    type: value.type as PublicWebPublicationCommandType,
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId.toLowerCase(),
    contentRecordId: value.contentRecordId.toLowerCase(),
    revisionId: value.revisionId.toLowerCase(),
    expectedVersion: Number(value.expectedVersion),
    idempotencyKey: value.idempotencyKey,
    evidenceSha256: value.evidenceSha256,
    staleReasonCode: value.staleReasonCode,
  };
}

export function authorizePublicWebPublicationCommand(input: {
  context: VerifiedActiveTenantContext;
  state: ResolvedActiveContextState;
  command: unknown;
  assurance: PublicWebMutationAssurance;
  now?: number;
}): PublicWebPublicationAuthorizationResult {
  const now = input.now ?? Date.now();
  const command = parsePublicWebPublicationCommand(input.command);
  if (!command || !Number.isSafeInteger(now) || now < 0) {
    return { ok: false, reason: "invalid_command" };
  }
  if (!isSelectionBoundActiveTenantContext(input.context, now)) {
    return { ok: false, reason: "context_not_selection_bound" };
  }
  if (
    !isRecord(input.assurance) ||
    !hasExactKeys(input.assurance, [
      "approvalSatisfied",
      "impersonating",
      "stepUpSatisfied",
    ]) ||
    typeof input.assurance.approvalSatisfied !== "boolean" ||
    typeof input.assurance.impersonating !== "boolean" ||
    typeof input.assurance.stepUpSatisfied !== "boolean"
  ) {
    return { ok: false, reason: "invalid_command" };
  }
  if (input.assurance.impersonating) {
    return { ok: false, reason: "impersonation_forbidden" };
  }

  const capabilityKey = PUBLIC_WEB_PUBLICATION_CAPABILITIES[command.type];
  const decision = evaluateActiveTenantCapability({
    context: input.context,
    state: input.state,
    capabilityKey,
    resource: {
      type: "PUBLIC_WEB_CONTENT",
      id: command.contentRecordId,
      tenantId: command.tenantId,
      organizationId: command.organizationId,
      legacyBranchId: input.context.legacyBranchId,
    },
    stepUpSatisfied: input.assurance.stepUpSatisfied,
    approvalSatisfied: input.assurance.approvalSatisfied,
    now,
  });
  if (!decision.allowed) {
    return {
      ok: false,
      reason: "authorization_denied",
      detail: decision.reason,
      decisionReceipt: decision.receipt,
    };
  }

  return {
    ok: true,
    value: {
      command,
      capabilityKey,
      requestHash: hashPublicWebPublicationCommand(command),
      decisionReceipt: decision.receipt,
    },
  };
}
