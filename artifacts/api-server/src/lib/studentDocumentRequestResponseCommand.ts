import crypto from "node:crypto";
import { canonicalJson } from "./jsonCanonical.js";

export const STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY =
  "student.document_request.respond";
export const STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE =
  "student_document_request";
export const STUDENT_DOCUMENT_INGEST_RECEIPT_TYPE =
  "student.document.ingest.received.v1";
export const STUDENT_DOCUMENT_RESPONSE_RECEIPT_TYPE =
  "student.document_request.response.v1";
export const STUDENT_DOCUMENT_RESPONSE_AUDIT_TYPE =
  "student.document_request.response.audit.v1";

const INGEST_HASH_DOMAIN = "FAS_STUDENT_DOCUMENT_INGEST\0v1\0";
const IDEMPOTENCY_HASH_DOMAIN =
  "FAS_STUDENT_DOCUMENT_RESPONSE_IDEMPOTENCY\0v1\0";
const COMMAND_HASH_DOMAIN = "FAS_STUDENT_DOCUMENT_RESPONSE_COMMAND\0v1\0";
const RECEIPT_HASH_DOMAIN = "FAS_STUDENT_DOCUMENT_RESPONSE_RECEIPT\0v1\0";
const AUDIT_HASH_DOMAIN = "FAS_STUDENT_DOCUMENT_RESPONSE_AUDIT\0v1\0";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const OPAQUE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;

export type StudentDocumentRequestState =
  | "OPEN"
  | "RESPONDED"
  | "FULFILLED"
  | "CANCELLED";

export type StudentDocumentRequestAuthority = {
  schemaVersion: 1;
  capabilityKey: typeof STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY;
  resourceType: typeof STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE;
  tenantId: string;
  contextId: string;
  selectionId: string;
  sessionGeneration: number;
  actorPrincipalId: string;
  actorMembershipId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  policyVersionId: string;
  decision: "ALLOW";
};

export type StudentDocumentRequestAccessDecisionReceipt =
  StudentDocumentRequestAuthority & {
    id: string;
    correlationId: string;
    occurredAt: string;
  };

export type StudentDocumentIngestReceiptInput = {
  id: string;
  tenantId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  objectRef: string;
  contentSha256: string;
  scanStatus: "QUARANTINED" | "SCANNING" | "PASSED";
  occurredAt: string;
};

export type StudentDocumentIngestReceipt = StudentDocumentIngestReceiptInput & {
  schemaVersion: 1;
  receiptType: typeof STUDENT_DOCUMENT_INGEST_RECEIPT_TYPE;
  receiptHash: string;
};

export type StudentDocumentRequestResponseCommand = {
  commandId: string;
  idempotencyKey: string;
  expectedVersion: number;
  response:
    | { kind: "ACKNOWLEDGE" }
    | {
        kind: "EVIDENCE_SUBMITTED";
        ingestReceipt: StudentDocumentIngestReceipt;
      };
};

export type StudentDocumentRequestSnapshot = {
  tenantId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  version: number;
  state: StudentDocumentRequestState;
  acknowledgedAt: string | null;
  respondedAt: string | null;
};

export type StudentDocumentRequestResponseReceipt = {
  schemaVersion: 1;
  receiptType: typeof STUDENT_DOCUMENT_RESPONSE_RECEIPT_TYPE;
  id: string;
  commandId: string;
  tenantId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  actorPrincipalId: string;
  actorMembershipId: string;
  contextId: string;
  selectionId: string;
  sessionGeneration: number;
  accessDecisionReceiptId: string;
  policyVersionId: string;
  responseKind: StudentDocumentRequestResponseCommand["response"]["kind"];
  fromState: StudentDocumentRequestState;
  toState: StudentDocumentRequestState;
  previousVersion: number;
  nextVersion: number;
  acknowledgedAt: string;
  respondedAt: string | null;
  ingestReceiptId: string | null;
  ingestReceiptHash: string | null;
  idempotencyKeyHash: string;
  commandHash: string;
  auditCorrelationId: string;
  occurredAt: string;
  receiptHash: string;
};

export type StudentDocumentRequestResponseAudit = {
  schemaVersion: 1;
  auditType: typeof STUDENT_DOCUMENT_RESPONSE_AUDIT_TYPE;
  id: string;
  tenantId: string;
  commandReceiptId: string;
  accessDecisionReceiptId: string;
  actorPrincipalId: string;
  actorMembershipId: string;
  contextId: string;
  subjectRef: string;
  applicationRef: string;
  requestRef: string;
  responseKind: StudentDocumentRequestResponseCommand["response"]["kind"];
  fromState: StudentDocumentRequestState;
  toState: StudentDocumentRequestState;
  previousVersion: number;
  nextVersion: number;
  ingestReceiptId: string | null;
  correlationId: string;
  occurredAt: string;
  auditHash: string;
};

export type StudentDocumentResponseClaim = {
  tenantId: string;
  idempotencyKeyHash: string;
  commandHash: string;
};

export type StudentDocumentResponseClaimResult =
  | { status: "CLAIMED" }
  | {
      status: "COMMITTED";
      commandHash: string;
      receipt: StudentDocumentRequestResponseReceipt;
    }
  | { status: "IN_PROGRESS"; commandHash: string }
  | { status: "CONFLICT"; commandHash: string };

export interface StudentDocumentRequestResponseTransaction {
  revalidateAuthorityForUpdate(input: {
    authority: StudentDocumentRequestAuthority;
    occurredAt: string;
  }): Promise<boolean>;
  claimCommand(
    claim: StudentDocumentResponseClaim,
  ): Promise<StudentDocumentResponseClaimResult>;
  loadRequestForUpdate(input: {
    tenantId: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
  }): Promise<StudentDocumentRequestSnapshot | null>;
  consumeIngestReceipt(input: {
    tenantId: string;
    ingestReceiptId: string;
    commandReceiptId: string;
  }): Promise<boolean>;
  updateRequest(input: {
    tenantId: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
    expectedVersion: number;
    nextVersion: number;
    nextState: StudentDocumentRequestState;
    acknowledgedAt: string;
    respondedAt: string | null;
  }): Promise<boolean>;
  insertAccessDecisionReceipt(
    receipt: StudentDocumentRequestAccessDecisionReceipt,
  ): Promise<void>;
  insertResponseReceipt(
    receipt: StudentDocumentRequestResponseReceipt,
  ): Promise<void>;
  insertAudit(audit: StudentDocumentRequestResponseAudit): Promise<void>;
  completeCommandClaim(input: {
    tenantId: string;
    idempotencyKeyHash: string;
    commandHash: string;
    receipt: StudentDocumentRequestResponseReceipt;
  }): Promise<void>;
}

export interface StudentDocumentRequestResponseStore {
  transaction<T>(
    tenantId: string,
    operation: (tx: StudentDocumentRequestResponseTransaction) => Promise<T>,
  ): Promise<T>;
}

export type ExecuteStudentDocumentRequestResponseInput = {
  command: unknown;
  authority: unknown;
  store: StudentDocumentRequestResponseStore;
  now?: () => Date;
  newUuidV7: () => string;
};

export type StudentDocumentRequestResponseFailureReason =
  | "command_invalid"
  | "authority_invalid"
  | "authority_revoked"
  | "authority_scope_mismatch"
  | "request_not_found"
  | "request_state_invalid"
  | "request_not_open"
  | "request_already_acknowledged"
  | "stale_request_version"
  | "ingest_receipt_invalid"
  | "ingest_receipt_not_safe"
  | "ingest_receipt_scope_mismatch"
  | "ingest_receipt_after_response"
  | "ingest_receipt_already_consumed"
  | "idempotency_key_reused"
  | "command_in_progress"
  | "existing_receipt_invalid"
  | "request_update_conflict"
  | "clock_invalid"
  | "identifier_generation_failed"
  | "store_unavailable";

export type StudentDocumentRequestResponseResult =
  | {
      ok: true;
      replayed: boolean;
      receipt: StudentDocumentRequestResponseReceipt;
    }
  | { ok: false; reason: StudentDocumentRequestResponseFailureReason };

class CommandAbort extends Error {
  constructor(
    readonly result: Extract<
      StudentDocumentRequestResponseResult,
      { ok: false }
    >,
  ) {
    super(result.reason);
    this.name = "StudentDocumentRequestResponseAbort";
  }
}

function deny(reason: StudentDocumentRequestResponseFailureReason): never {
  throw new CommandAbort({ ok: false, reason });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function uuidV7(value: unknown): string | null {
  return typeof value === "string" && UUID_V7_RE.test(value)
    ? value.toLowerCase()
    : null;
}

function opaqueRef(value: unknown): string | null {
  return typeof value === "string" && OPAQUE_REF_RE.test(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function hash(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function parseAuthority(
  value: unknown,
): StudentDocumentRequestAuthority | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "actorMembershipId",
      "actorPrincipalId",
      "applicationRef",
      "capabilityKey",
      "contextId",
      "decision",
      "policyVersionId",
      "requestRef",
      "resourceType",
      "schemaVersion",
      "selectionId",
      "sessionGeneration",
      "subjectRef",
      "tenantId",
    ]) ||
    value.schemaVersion !== 1 ||
    value.capabilityKey !== STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY ||
    value.resourceType !== STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE ||
    value.decision !== "ALLOW"
  ) {
    return null;
  }
  const tenantId = uuidV7(value.tenantId);
  const contextId = uuidV7(value.contextId);
  const selectionId = uuidV7(value.selectionId);
  const sessionGeneration = positiveInteger(value.sessionGeneration);
  const actorPrincipalId = uuidV7(value.actorPrincipalId);
  const actorMembershipId = uuidV7(value.actorMembershipId);
  const subjectRef = opaqueRef(value.subjectRef);
  const applicationRef = opaqueRef(value.applicationRef);
  const requestRef = opaqueRef(value.requestRef);
  const policyVersionId = uuidV7(value.policyVersionId);
  if (
    !tenantId ||
    !contextId ||
    !selectionId ||
    !sessionGeneration ||
    !actorPrincipalId ||
    !actorMembershipId ||
    !subjectRef ||
    !applicationRef ||
    !requestRef ||
    !policyVersionId
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    capabilityKey: STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY,
    resourceType: STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE,
    tenantId,
    contextId,
    selectionId,
    sessionGeneration,
    actorPrincipalId,
    actorMembershipId,
    subjectRef,
    applicationRef,
    requestRef,
    policyVersionId,
    decision: "ALLOW",
  };
}

function parseIngestReceipt(
  value: unknown,
): StudentDocumentIngestReceipt | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "applicationRef",
      "contentSha256",
      "id",
      "objectRef",
      "occurredAt",
      "receiptHash",
      "receiptType",
      "requestRef",
      "scanStatus",
      "schemaVersion",
      "subjectRef",
      "tenantId",
    ]) ||
    value.schemaVersion !== 1 ||
    value.receiptType !== STUDENT_DOCUMENT_INGEST_RECEIPT_TYPE ||
    !["QUARANTINED", "SCANNING", "PASSED"].includes(String(value.scanStatus))
  ) {
    return null;
  }
  const withoutHash: StudentDocumentIngestReceiptInput = {
    id: uuidV7(value.id) ?? "",
    tenantId: uuidV7(value.tenantId) ?? "",
    subjectRef: opaqueRef(value.subjectRef) ?? "",
    applicationRef: opaqueRef(value.applicationRef) ?? "",
    requestRef: opaqueRef(value.requestRef) ?? "",
    objectRef: opaqueRef(value.objectRef) ?? "",
    contentSha256:
      typeof value.contentSha256 === "string" &&
      SHA256_RE.test(value.contentSha256)
        ? value.contentSha256
        : "",
    scanStatus:
      value.scanStatus as StudentDocumentIngestReceiptInput["scanStatus"],
    occurredAt: timestamp(value.occurredAt) ?? "",
  };
  if (Object.values(withoutHash).some((item) => item === "")) return null;
  const receiptHash =
    typeof value.receiptHash === "string" && SHA256_RE.test(value.receiptHash)
      ? value.receiptHash
      : null;
  if (!receiptHash || receiptHash !== hash(INGEST_HASH_DOMAIN, withoutHash)) {
    return null;
  }
  return {
    schemaVersion: 1,
    receiptType: STUDENT_DOCUMENT_INGEST_RECEIPT_TYPE,
    ...withoutHash,
    receiptHash,
  };
}

function parseCommand(
  value: unknown,
): StudentDocumentRequestResponseCommand | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "commandId",
      "expectedVersion",
      "idempotencyKey",
      "response",
    ])
  ) {
    return null;
  }
  const commandId = uuidV7(value.commandId);
  const expectedVersion = positiveInteger(value.expectedVersion);
  const idempotencyKey =
    typeof value.idempotencyKey === "string" &&
    IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
      ? value.idempotencyKey
      : null;
  if (
    !commandId ||
    !expectedVersion ||
    !idempotencyKey ||
    !isRecord(value.response)
  ) {
    return null;
  }
  if (
    value.response.kind === "ACKNOWLEDGE" &&
    hasExactKeys(value.response, ["kind"])
  ) {
    return {
      commandId,
      idempotencyKey,
      expectedVersion,
      response: { kind: "ACKNOWLEDGE" },
    };
  }
  if (
    value.response.kind === "EVIDENCE_SUBMITTED" &&
    hasExactKeys(value.response, ["ingestReceipt", "kind"])
  ) {
    const ingestReceipt = parseIngestReceipt(value.response.ingestReceipt);
    if (!ingestReceipt) return null;
    return {
      commandId,
      idempotencyKey,
      expectedVersion,
      response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt },
    };
  }
  return null;
}

function parseSnapshot(value: unknown): StudentDocumentRequestSnapshot | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "acknowledgedAt",
      "applicationRef",
      "requestRef",
      "respondedAt",
      "state",
      "subjectRef",
      "tenantId",
      "version",
    ]) ||
    !["OPEN", "RESPONDED", "FULFILLED", "CANCELLED"].includes(
      String(value.state),
    )
  ) {
    return null;
  }
  const tenantId = uuidV7(value.tenantId);
  const subjectRef = opaqueRef(value.subjectRef);
  const applicationRef = opaqueRef(value.applicationRef);
  const requestRef = opaqueRef(value.requestRef);
  const version = positiveInteger(value.version);
  const acknowledgedAt =
    value.acknowledgedAt === null ? null : timestamp(value.acknowledgedAt);
  const respondedAt =
    value.respondedAt === null ? null : timestamp(value.respondedAt);
  if (
    !tenantId ||
    !subjectRef ||
    !applicationRef ||
    !requestRef ||
    !version ||
    (value.acknowledgedAt !== null && !acknowledgedAt) ||
    (value.respondedAt !== null && !respondedAt) ||
    (value.state === "OPEN" && respondedAt !== null) ||
    (value.state === "RESPONDED" && respondedAt === null)
  ) {
    return null;
  }
  return {
    tenantId,
    subjectRef,
    applicationRef,
    requestRef,
    version,
    state: value.state as StudentDocumentRequestState,
    acknowledgedAt,
    respondedAt,
  };
}

function sameScope(
  left: Pick<
    StudentDocumentRequestAuthority,
    "tenantId" | "subjectRef" | "applicationRef" | "requestRef"
  >,
  right: Pick<
    StudentDocumentRequestSnapshot,
    "tenantId" | "subjectRef" | "applicationRef" | "requestRef"
  >,
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.subjectRef === right.subjectRef &&
    left.applicationRef === right.applicationRef &&
    left.requestRef === right.requestRef
  );
}

function idempotencyKeyHash(tenantId: string, key: string): string {
  return hash(IDEMPOTENCY_HASH_DOMAIN, { tenantId, key });
}

function commandHash(
  authority: StudentDocumentRequestAuthority,
  command: StudentDocumentRequestResponseCommand,
  keyHash: string,
): string {
  return hash(COMMAND_HASH_DOMAIN, {
    tenantId: authority.tenantId,
    subjectRef: authority.subjectRef,
    applicationRef: authority.applicationRef,
    requestRef: authority.requestRef,
    actorPrincipalId: authority.actorPrincipalId,
    expectedVersion: command.expectedVersion,
    responseKind: command.response.kind,
    ingestReceiptHash:
      command.response.kind === "EVIDENCE_SUBMITTED"
        ? command.response.ingestReceipt.receiptHash
        : null,
    idempotencyKeyHash: keyHash,
  });
}

function receiptIntegrity(
  receipt: StudentDocumentRequestResponseReceipt,
): boolean {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.receiptType !== STUDENT_DOCUMENT_RESPONSE_RECEIPT_TYPE ||
    !SHA256_RE.test(receipt.receiptHash)
  ) {
    return false;
  }
  const { receiptHash, ...withoutHash } = receipt;
  return receiptHash === hash(RECEIPT_HASH_DOMAIN, withoutHash);
}

export function createStudentDocumentIngestReceipt(
  input: StudentDocumentIngestReceiptInput,
): StudentDocumentIngestReceipt {
  const normalized = parseIngestReceipt({
    schemaVersion: 1,
    receiptType: STUDENT_DOCUMENT_INGEST_RECEIPT_TYPE,
    ...input,
    receiptHash: hash(INGEST_HASH_DOMAIN, {
      id: uuidV7(input.id) ?? input.id,
      tenantId: uuidV7(input.tenantId) ?? input.tenantId,
      subjectRef: opaqueRef(input.subjectRef) ?? input.subjectRef,
      applicationRef: opaqueRef(input.applicationRef) ?? input.applicationRef,
      requestRef: opaqueRef(input.requestRef) ?? input.requestRef,
      objectRef: opaqueRef(input.objectRef) ?? input.objectRef,
      contentSha256: input.contentSha256,
      scanStatus: input.scanStatus,
      occurredAt: timestamp(input.occurredAt) ?? input.occurredAt,
    }),
  });
  if (!normalized) {
    throw new Error("student_document_ingest_receipt_invalid");
  }
  return normalized;
}

function newUuid(input: ExecuteStudentDocumentRequestResponseInput): string {
  const generated = uuidV7(input.newUuidV7());
  if (!generated) deny("identifier_generation_failed");
  return generated;
}

export async function executeStudentDocumentRequestResponse(
  input: ExecuteStudentDocumentRequestResponseInput,
): Promise<StudentDocumentRequestResponseResult> {
  if (
    isRecord(input.command) &&
    hasExactKeys(input.command, [
      "commandId",
      "expectedVersion",
      "idempotencyKey",
      "response",
    ]) &&
    isRecord(input.command.response) &&
    input.command.response.kind === "EVIDENCE_SUBMITTED" &&
    hasExactKeys(input.command.response, ["ingestReceipt", "kind"]) &&
    !parseIngestReceipt(input.command.response.ingestReceipt)
  ) {
    return { ok: false, reason: "ingest_receipt_invalid" };
  }
  const command = parseCommand(input.command);
  if (!command) return { ok: false, reason: "command_invalid" };
  const authority = parseAuthority(input.authority);
  if (!authority) return { ok: false, reason: "authority_invalid" };
  if (!input.store || typeof input.store.transaction !== "function") {
    return { ok: false, reason: "store_unavailable" };
  }
  if (typeof input.newUuidV7 !== "function") {
    return { ok: false, reason: "identifier_generation_failed" };
  }
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function") return { ok: false, reason: "clock_invalid" };
  const occurredAtRaw = now();
  if (
    !(occurredAtRaw instanceof Date) ||
    !Number.isFinite(occurredAtRaw.getTime())
  ) {
    return { ok: false, reason: "clock_invalid" };
  }
  const occurredAt = occurredAtRaw.toISOString();
  const keyHash = idempotencyKeyHash(
    authority.tenantId,
    command.idempotencyKey,
  );
  const requestHash = commandHash(authority, command, keyHash);

  try {
    return await input.store.transaction(authority.tenantId, async (tx) => {
      const authorityCurrent = await tx.revalidateAuthorityForUpdate({
        authority,
        occurredAt,
      });
      if (!authorityCurrent) deny("authority_revoked");

      const claim = await tx.claimCommand({
        tenantId: authority.tenantId,
        idempotencyKeyHash: keyHash,
        commandHash: requestHash,
      });
      if (claim.status === "COMMITTED") {
        if (
          claim.commandHash !== requestHash ||
          claim.receipt.commandHash !== requestHash ||
          claim.receipt.idempotencyKeyHash !== keyHash
        ) {
          deny("idempotency_key_reused");
        }
        if (
          !receiptIntegrity(claim.receipt) ||
          claim.receipt.tenantId !== authority.tenantId ||
          claim.receipt.subjectRef !== authority.subjectRef ||
          claim.receipt.applicationRef !== authority.applicationRef ||
          claim.receipt.requestRef !== authority.requestRef ||
          claim.receipt.actorPrincipalId !== authority.actorPrincipalId
        ) {
          deny("existing_receipt_invalid");
        }
        await tx.insertAccessDecisionReceipt({
          ...authority,
          id: newUuid(input),
          correlationId: claim.receipt.auditCorrelationId,
          occurredAt,
        });
        return { ok: true, replayed: true, receipt: claim.receipt };
      }
      if (claim.status === "CONFLICT") {
        deny("idempotency_key_reused");
      }
      if (claim.status === "IN_PROGRESS") {
        if (claim.commandHash !== requestHash) {
          deny("idempotency_key_reused");
        }
        deny("command_in_progress");
      }

      const snapshotRaw = await tx.loadRequestForUpdate({
        tenantId: authority.tenantId,
        subjectRef: authority.subjectRef,
        applicationRef: authority.applicationRef,
        requestRef: authority.requestRef,
      });
      if (!snapshotRaw) deny("request_not_found");
      const snapshot = parseSnapshot(snapshotRaw);
      if (!snapshot) deny("request_state_invalid");
      if (!sameScope(authority, snapshot)) deny("authority_scope_mismatch");
      if (snapshot.version !== command.expectedVersion) {
        deny("stale_request_version");
      }
      if (snapshot.state !== "OPEN") deny("request_not_open");
      if (
        command.response.kind === "ACKNOWLEDGE" &&
        snapshot.acknowledgedAt !== null
      ) {
        deny("request_already_acknowledged");
      }
      if (!Number.isSafeInteger(snapshot.version + 1)) {
        deny("request_state_invalid");
      }

      let ingestReceipt: StudentDocumentIngestReceipt | null = null;
      if (command.response.kind === "EVIDENCE_SUBMITTED") {
        ingestReceipt = parseIngestReceipt(command.response.ingestReceipt);
        if (!ingestReceipt) deny("ingest_receipt_invalid");
        if (ingestReceipt.scanStatus !== "PASSED") {
          deny("ingest_receipt_not_safe");
        }
        if (!sameScope(authority, ingestReceipt)) {
          deny("ingest_receipt_scope_mismatch");
        }
        if (
          new Date(ingestReceipt.occurredAt).getTime() > occurredAtRaw.getTime()
        ) {
          deny("ingest_receipt_after_response");
        }
      }

      const responseReceiptId = newUuid(input);
      const auditId = newUuid(input);
      const auditCorrelationId = newUuid(input);
      const accessDecisionReceiptId = newUuid(input);
      if (ingestReceipt) {
        const consumed = await tx.consumeIngestReceipt({
          tenantId: authority.tenantId,
          ingestReceiptId: ingestReceipt.id,
          commandReceiptId: responseReceiptId,
        });
        if (!consumed) deny("ingest_receipt_already_consumed");
      }

      const nextVersion = snapshot.version + 1;
      const nextState: StudentDocumentRequestState = ingestReceipt
        ? "RESPONDED"
        : "OPEN";
      const acknowledgedAt = snapshot.acknowledgedAt ?? occurredAt;
      const respondedAt = ingestReceipt ? occurredAt : null;
      const receiptWithoutHash: Omit<
        StudentDocumentRequestResponseReceipt,
        "receiptHash"
      > = {
        schemaVersion: 1,
        receiptType: STUDENT_DOCUMENT_RESPONSE_RECEIPT_TYPE,
        id: responseReceiptId,
        commandId: command.commandId,
        tenantId: authority.tenantId,
        subjectRef: authority.subjectRef,
        applicationRef: authority.applicationRef,
        requestRef: authority.requestRef,
        actorPrincipalId: authority.actorPrincipalId,
        actorMembershipId: authority.actorMembershipId,
        contextId: authority.contextId,
        selectionId: authority.selectionId,
        sessionGeneration: authority.sessionGeneration,
        accessDecisionReceiptId,
        policyVersionId: authority.policyVersionId,
        responseKind: command.response.kind,
        fromState: snapshot.state,
        toState: nextState,
        previousVersion: snapshot.version,
        nextVersion,
        acknowledgedAt,
        respondedAt,
        ingestReceiptId: ingestReceipt?.id ?? null,
        ingestReceiptHash: ingestReceipt?.receiptHash ?? null,
        idempotencyKeyHash: keyHash,
        commandHash: requestHash,
        auditCorrelationId,
        occurredAt,
      };
      const receipt: StudentDocumentRequestResponseReceipt = {
        ...receiptWithoutHash,
        receiptHash: hash(RECEIPT_HASH_DOMAIN, receiptWithoutHash),
      };
      const auditWithoutHash: Omit<
        StudentDocumentRequestResponseAudit,
        "auditHash"
      > = {
        schemaVersion: 1,
        auditType: STUDENT_DOCUMENT_RESPONSE_AUDIT_TYPE,
        id: auditId,
        tenantId: authority.tenantId,
        commandReceiptId: receipt.id,
        accessDecisionReceiptId,
        actorPrincipalId: authority.actorPrincipalId,
        actorMembershipId: authority.actorMembershipId,
        contextId: authority.contextId,
        subjectRef: authority.subjectRef,
        applicationRef: authority.applicationRef,
        requestRef: authority.requestRef,
        responseKind: command.response.kind,
        fromState: snapshot.state,
        toState: nextState,
        previousVersion: snapshot.version,
        nextVersion,
        ingestReceiptId: ingestReceipt?.id ?? null,
        correlationId: auditCorrelationId,
        occurredAt,
      };
      const audit: StudentDocumentRequestResponseAudit = {
        ...auditWithoutHash,
        auditHash: hash(AUDIT_HASH_DOMAIN, auditWithoutHash),
      };

      const updated = await tx.updateRequest({
        tenantId: authority.tenantId,
        subjectRef: authority.subjectRef,
        applicationRef: authority.applicationRef,
        requestRef: authority.requestRef,
        expectedVersion: snapshot.version,
        nextVersion,
        nextState,
        acknowledgedAt,
        respondedAt,
      });
      if (!updated) deny("request_update_conflict");
      await tx.insertAccessDecisionReceipt({
        ...authority,
        id: accessDecisionReceiptId,
        correlationId: auditCorrelationId,
        occurredAt,
      });
      await tx.insertResponseReceipt(receipt);
      await tx.insertAudit(audit);
      await tx.completeCommandClaim({
        tenantId: authority.tenantId,
        idempotencyKeyHash: keyHash,
        commandHash: requestHash,
        receipt,
      });
      return { ok: true, replayed: false, receipt };
    });
  } catch (error) {
    if (error instanceof CommandAbort) return error.result;
    return { ok: false, reason: "store_unavailable" };
  }
}
