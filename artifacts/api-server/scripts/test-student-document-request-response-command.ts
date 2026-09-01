import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStudentDocumentIngestReceipt,
  executeStudentDocumentRequestResponse,
  STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE,
  STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY,
  type StudentDocumentRequestAccessDecisionReceipt,
  type StudentDocumentRequestAuthority,
  type StudentDocumentRequestResponseAudit,
  type StudentDocumentRequestResponseCommand,
  type StudentDocumentRequestResponseReceipt,
  type StudentDocumentRequestResponseStore,
  type StudentDocumentRequestResponseTransaction,
  type StudentDocumentRequestSnapshot,
  type StudentDocumentResponseClaim,
  type StudentDocumentResponseClaimResult,
} from "../src/lib/studentDocumentRequestResponseCommand.js";

const NOW = "2026-09-01T12:00:00.000Z";
const TENANT_ID = uuid(1);
const CONTEXT_ID = uuid(2);
const SELECTION_ID = uuid(3);
const PRINCIPAL_ID = uuid(4);
const MEMBERSHIP_ID = uuid(5);
const POLICY_VERSION_ID = uuid(6);
const SUBJECT_REF = "student:1001";
const APPLICATION_REF = "application:2001";
const REQUEST_REF = "document-request:3001";
const IDEMPOTENCY_KEY = "student-response-key-0001";

function uuid(sequence: number): string {
  return `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function uuidFactory(start = 1_000): () => string {
  let sequence = start;
  return () => uuid(sequence++);
}

function authority(
  overrides: Partial<StudentDocumentRequestAuthority> = {},
): StudentDocumentRequestAuthority {
  return {
    schemaVersion: 1,
    capabilityKey: STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY,
    resourceType: STUDENT_DOCUMENT_REQUEST_RESOURCE_TYPE,
    tenantId: TENANT_ID,
    contextId: CONTEXT_ID,
    selectionId: SELECTION_ID,
    sessionGeneration: 1,
    actorPrincipalId: PRINCIPAL_ID,
    actorMembershipId: MEMBERSHIP_ID,
    subjectRef: SUBJECT_REF,
    applicationRef: APPLICATION_REF,
    requestRef: REQUEST_REF,
    policyVersionId: POLICY_VERSION_ID,
    decision: "ALLOW",
    ...overrides,
  };
}

function request(
  overrides: Partial<StudentDocumentRequestSnapshot> = {},
): StudentDocumentRequestSnapshot {
  return {
    tenantId: TENANT_ID,
    subjectRef: SUBJECT_REF,
    applicationRef: APPLICATION_REF,
    requestRef: REQUEST_REF,
    version: 1,
    state: "OPEN",
    acknowledgedAt: null,
    respondedAt: null,
    ...overrides,
  };
}

function acknowledgeCommand(
  overrides: Partial<StudentDocumentRequestResponseCommand> = {},
): StudentDocumentRequestResponseCommand {
  return {
    commandId: uuid(20),
    idempotencyKey: IDEMPOTENCY_KEY,
    expectedVersion: 1,
    response: { kind: "ACKNOWLEDGE" },
    ...overrides,
  };
}

function ingestReceipt(overrides: Record<string, unknown> = {}) {
  return createStudentDocumentIngestReceipt({
    id: uuid(30),
    tenantId: TENANT_ID,
    subjectRef: SUBJECT_REF,
    applicationRef: APPLICATION_REF,
    requestRef: REQUEST_REF,
    objectRef: "private-object:4001",
    contentSha256: "a".repeat(64),
    scanStatus: "PASSED",
    occurredAt: "2026-09-01T11:59:00.000Z",
    ...overrides,
  } as Parameters<typeof createStudentDocumentIngestReceipt>[0]);
}

type StoredClaim = {
  commandHash: string;
  receipt: StudentDocumentRequestResponseReceipt | null;
};

class InMemoryStore
  implements
    StudentDocumentRequestResponseStore,
    StudentDocumentRequestResponseTransaction
{
  currentRequest: StudentDocumentRequestSnapshot | null;
  authorityCurrent = true;
  failNextResponseInsert = false;
  claims = new Map<string, StoredClaim>();
  consumedIngestReceiptIds = new Set<string>();
  accessDecisions: StudentDocumentRequestAccessDecisionReceipt[] = [];
  responseReceipts: StudentDocumentRequestResponseReceipt[] = [];
  audits: StudentDocumentRequestResponseAudit[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    initialRequest: StudentDocumentRequestSnapshot | null = request(),
  ) {
    this.currentRequest = initialRequest;
  }

  async transaction<T>(
    _tenantId: string,
    operation: (tx: StudentDocumentRequestResponseTransaction) => Promise<T>,
  ): Promise<T> {
    const predecessor = this.queue;
    let release = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    const snapshot = {
      currentRequest: this.currentRequest ? { ...this.currentRequest } : null,
      claims: new Map(
        [...this.claims].map(([key, claim]) => [
          key,
          {
            commandHash: claim.commandHash,
            receipt: claim.receipt ? { ...claim.receipt } : null,
          },
        ]),
      ),
      consumed: new Set(this.consumedIngestReceiptIds),
      accessDecisions: [...this.accessDecisions],
      responseReceipts: [...this.responseReceipts],
      audits: [...this.audits],
    };
    try {
      return await operation(this);
    } catch (error) {
      this.currentRequest = snapshot.currentRequest;
      this.claims = snapshot.claims;
      this.consumedIngestReceiptIds = snapshot.consumed;
      this.accessDecisions = snapshot.accessDecisions;
      this.responseReceipts = snapshot.responseReceipts;
      this.audits = snapshot.audits;
      throw error;
    } finally {
      release();
    }
  }

  async revalidateAuthorityForUpdate(input: {
    authority: StudentDocumentRequestAuthority;
    occurredAt: string;
  }): Promise<boolean> {
    return (
      this.authorityCurrent &&
      input.occurredAt === NOW &&
      input.authority.capabilityKey ===
        STUDENT_DOCUMENT_REQUEST_RESPOND_CAPABILITY
    );
  }

  async claimCommand(
    claim: StudentDocumentResponseClaim,
  ): Promise<StudentDocumentResponseClaimResult> {
    const key = `${claim.tenantId}:${claim.idempotencyKeyHash}`;
    const existing = this.claims.get(key);
    if (!existing) {
      this.claims.set(key, { commandHash: claim.commandHash, receipt: null });
      return { status: "CLAIMED" };
    }
    if (existing.commandHash !== claim.commandHash) {
      return { status: "CONFLICT", commandHash: existing.commandHash };
    }
    if (existing.receipt) {
      return {
        status: "COMMITTED",
        commandHash: existing.commandHash,
        receipt: existing.receipt,
      };
    }
    return { status: "IN_PROGRESS", commandHash: existing.commandHash };
  }

  async loadRequestForUpdate(): Promise<StudentDocumentRequestSnapshot | null> {
    return this.currentRequest ? { ...this.currentRequest } : null;
  }

  async consumeIngestReceipt(input: {
    tenantId: string;
    ingestReceiptId: string;
    ingestReceiptHash: string;
    subjectRef: string;
    applicationRef: string;
    requestRef: string;
    occurredAt: string;
    commandReceiptId: string;
  }): Promise<boolean> {
    void input.tenantId;
    void input.ingestReceiptHash;
    void input.subjectRef;
    void input.applicationRef;
    void input.requestRef;
    void input.occurredAt;
    void input.commandReceiptId;
    if (this.consumedIngestReceiptIds.has(input.ingestReceiptId)) return false;
    this.consumedIngestReceiptIds.add(input.ingestReceiptId);
    return true;
  }

  async updateRequest(input: {
    expectedVersion: number;
    nextVersion: number;
    nextState: StudentDocumentRequestSnapshot["state"];
    acknowledgedAt: string;
    respondedAt: string | null;
  }): Promise<boolean> {
    if (
      !this.currentRequest ||
      this.currentRequest.version !== input.expectedVersion
    ) {
      return false;
    }
    this.currentRequest = {
      ...this.currentRequest,
      version: input.nextVersion,
      state: input.nextState,
      acknowledgedAt: input.acknowledgedAt,
      respondedAt: input.respondedAt,
    };
    return true;
  }

  async insertAccessDecisionReceipt(
    receipt: StudentDocumentRequestAccessDecisionReceipt,
  ): Promise<void> {
    this.accessDecisions.push(receipt);
  }

  async insertResponseReceipt(
    receipt: StudentDocumentRequestResponseReceipt,
  ): Promise<void> {
    if (this.failNextResponseInsert) {
      this.failNextResponseInsert = false;
      throw new Error("injected_response_receipt_failure");
    }
    this.responseReceipts.push(receipt);
  }

  async insertAudit(audit: StudentDocumentRequestResponseAudit): Promise<void> {
    this.audits.push(audit);
  }

  async completeCommandClaim(input: {
    tenantId: string;
    idempotencyKeyHash: string;
    commandHash: string;
    receipt: StudentDocumentRequestResponseReceipt;
  }): Promise<void> {
    const key = `${input.tenantId}:${input.idempotencyKeyHash}`;
    const claim = this.claims.get(key);
    if (!claim || claim.commandHash !== input.commandHash || claim.receipt) {
      throw new Error("invalid_command_claim_completion");
    }
    this.claims.set(key, {
      commandHash: input.commandHash,
      receipt: input.receipt,
    });
  }
}

async function execute(input: {
  store: InMemoryStore;
  command?: unknown;
  authority?: unknown;
  uuidStart?: number;
}) {
  return executeStudentDocumentRequestResponse({
    command: input.command ?? acknowledgeCommand(),
    authority: input.authority ?? authority(),
    store: input.store,
    now: () => new Date(NOW),
    newUuidV7: uuidFactory(input.uuidStart),
  });
}

function assertFailure(
  result: Awaited<ReturnType<typeof execute>>,
  reason: Extract<typeof result, { ok: false }>["reason"],
) {
  assert.deepEqual(result, { ok: false, reason });
}

test("acknowledgement is an audited OPEN-to-OPEN transition and never fulfils the request", async () => {
  const store = new InMemoryStore();
  const command = acknowledgeCommand();
  const result = await execute({ store, command });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.replayed, false);
  assert.equal(result.receipt.fromState, "OPEN");
  assert.equal(result.receipt.toState, "OPEN");
  assert.equal(result.receipt.previousVersion, 1);
  assert.equal(result.receipt.nextVersion, 2);
  assert.equal(result.receipt.respondedAt, null);
  assert.deepEqual(
    store.currentRequest,
    request({
      version: 2,
      acknowledgedAt: NOW,
    }),
  );
  assert.equal(store.accessDecisions.length, 1);
  assert.equal(store.responseReceipts.length, 1);
  assert.equal(store.audits.length, 1);
  assert.equal(
    store.accessDecisions[0]?.id,
    result.receipt.accessDecisionReceiptId,
  );
  assert.doesNotMatch(
    JSON.stringify(result.receipt),
    new RegExp(command.idempotencyKey),
  );
  assert.match(result.receipt.idempotencyKeyHash, /^[0-9a-f]{64}$/);
});

test("evidence submission consumes an ingest receipt and stops at RESPONDED", async () => {
  const store = new InMemoryStore();
  const ingest = ingestReceipt();
  const command = acknowledgeCommand({
    response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: ingest },
  });
  const result = await execute({ store, command });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receipt.toState, "RESPONDED");
  assert.equal(result.receipt.respondedAt, NOW);
  assert.equal(result.receipt.ingestReceiptId, ingest.id);
  assert.equal(result.receipt.ingestReceiptHash, ingest.receiptHash);
  assert.equal(store.currentRequest?.state, "RESPONDED");
  assert.equal(store.currentRequest?.version, 2);
  assert.equal(store.consumedIngestReceiptIds.has(ingest.id), true);
  assert.equal("verificationStatus" in result.receipt, false);
  assert.notEqual(result.receipt.toState, "FULFILLED");
});

test("an exact idempotent replay returns the immutable receipt after version advancement", async () => {
  const store = new InMemoryStore();
  const command = acknowledgeCommand();
  const first = await execute({ store, command, uuidStart: 1_000 });
  const replay = await execute({ store, command, uuidStart: 2_000 });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  if (!first.ok || !replay.ok) return;
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(store.currentRequest?.version, 2);
  assert.equal(store.responseReceipts.length, 1);
  assert.equal(store.audits.length, 1);
  assert.equal(store.accessDecisions.length, 2);
});

test("reusing an idempotency key for a changed request fails closed", async () => {
  const store = new InMemoryStore();
  const first = await execute({ store });
  assert.equal(first.ok, true);

  const changed = acknowledgeCommand({ expectedVersion: 2 });
  const result = await execute({ store, command: changed });
  assertFailure(result, "idempotency_key_reused");
  assert.equal(store.responseReceipts.length, 1);
  assert.equal(store.currentRequest?.version, 2);
});

test("stale versions and non-open requests roll back the command claim", async () => {
  const staleStore = new InMemoryStore(request({ version: 2 }));
  assertFailure(await execute({ store: staleStore }), "stale_request_version");
  assert.equal(staleStore.claims.size, 0);
  assert.equal(staleStore.accessDecisions.length, 0);

  const respondedStore = new InMemoryStore(
    request({
      state: "RESPONDED",
      respondedAt: "2026-09-01T11:00:00.000Z",
    }),
  );
  assertFailure(await execute({ store: respondedStore }), "request_not_open");
  assert.equal(respondedStore.claims.size, 0);
});

test("a second acknowledgement cannot masquerade as a response", async () => {
  const store = new InMemoryStore(
    request({
      acknowledgedAt: "2026-09-01T11:00:00.000Z",
    }),
  );
  assertFailure(await execute({ store }), "request_already_acknowledged");
  assert.equal(store.currentRequest?.version, 1);
});

test("authority-to-resource scope mismatches are denied inside the transaction", async () => {
  for (const scopedRequest of [
    request({ tenantId: uuid(90) }),
    request({ subjectRef: "student:other" }),
    request({ applicationRef: "application:other" }),
    request({ requestRef: "document-request:other" }),
  ]) {
    const store = new InMemoryStore(scopedRequest);
    assertFailure(await execute({ store }), "authority_scope_mismatch");
    assert.equal(store.responseReceipts.length, 0);
  }
});

test("tampered, cross-scope and future ingest receipts fail before any mutation", async () => {
  const valid = ingestReceipt();
  const tampered = { ...valid, contentSha256: "b".repeat(64) };
  const tamperedStore = new InMemoryStore();
  assertFailure(
    await execute({
      store: tamperedStore,
      command: acknowledgeCommand({
        response: {
          kind: "EVIDENCE_SUBMITTED",
          ingestReceipt: tampered as typeof valid,
        },
      }),
    }),
    "ingest_receipt_invalid",
  );

  const crossScope = ingestReceipt({ requestRef: "document-request:other" });
  const crossScopeStore = new InMemoryStore();
  assertFailure(
    await execute({
      store: crossScopeStore,
      command: acknowledgeCommand({
        response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: crossScope },
      }),
    }),
    "ingest_receipt_scope_mismatch",
  );

  const future = ingestReceipt({ occurredAt: "2026-09-01T12:00:01.000Z" });
  const futureStore = new InMemoryStore();
  assertFailure(
    await execute({
      store: futureStore,
      command: acknowledgeCommand({
        response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: future },
      }),
    }),
    "ingest_receipt_after_response",
  );

  assert.equal(tamperedStore.claims.size, 0);
  assert.equal(crossScopeStore.claims.size, 0);
  assert.equal(futureStore.claims.size, 0);
});

test("quarantined or still-scanning evidence cannot mark a request responded", async () => {
  for (const scanStatus of ["QUARANTINED", "SCANNING"] as const) {
    const store = new InMemoryStore();
    const ingest = ingestReceipt({ scanStatus });
    const result = await execute({
      store,
      command: acknowledgeCommand({
        response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: ingest },
      }),
    });

    assertFailure(result, "ingest_receipt_not_safe");
    assert.deepEqual(store.currentRequest, request());
    assert.equal(store.consumedIngestReceiptIds.size, 0);
    assert.equal(store.claims.size, 0);
  }
});

test("an already-consumed ingest receipt cannot be linked twice", async () => {
  const store = new InMemoryStore();
  const ingest = ingestReceipt();
  store.consumedIngestReceiptIds.add(ingest.id);
  const result = await execute({
    store,
    command: acknowledgeCommand({
      response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: ingest },
    }),
  });

  assertFailure(result, "ingest_receipt_already_consumed");
  assert.equal(store.currentRequest?.version, 1);
  assert.equal(store.responseReceipts.length, 0);
  assert.equal(store.claims.size, 0);
});

test("same-key concurrency commits once and returns one exact replay", async () => {
  const store = new InMemoryStore();
  const command = acknowledgeCommand();
  const [left, right] = await Promise.all([
    execute({ store, command, uuidStart: 3_000 }),
    execute({ store, command, uuidStart: 4_000 }),
  ]);

  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) return;
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  assert.deepEqual(left.receipt, right.receipt);
  assert.equal(store.responseReceipts.length, 1);
  assert.equal(store.audits.length, 1);
  assert.equal(store.currentRequest?.version, 2);
});

test("different-key concurrency allows only one optimistic version transition", async () => {
  const store = new InMemoryStore();
  const [left, right] = await Promise.all([
    execute({
      store,
      command: acknowledgeCommand({
        idempotencyKey: "student-response-key-left",
      }),
      uuidStart: 5_000,
    }),
    execute({
      store,
      command: acknowledgeCommand({
        idempotencyKey: "student-response-key-right",
      }),
      uuidStart: 6_000,
    }),
  ]);

  assert.equal([left, right].filter((result) => result.ok).length, 1);
  assert.equal(
    [left, right].some(
      (result) => !result.ok && result.reason === "stale_request_version",
    ),
    true,
  );
  assert.equal(store.responseReceipts.length, 1);
  assert.equal(store.audits.length, 1);
  assert.equal(store.claims.size, 1);
  assert.equal(store.currentRequest?.version, 2);
});

test("client-carried scope and invalid or revoked authority fail closed", async () => {
  const extraScopeStore = new InMemoryStore();
  assertFailure(
    await execute({
      store: extraScopeStore,
      command: { ...acknowledgeCommand(), tenantId: TENANT_ID },
    }),
    "command_invalid",
  );

  const deniedStore = new InMemoryStore();
  assertFailure(
    await execute({
      store: deniedStore,
      authority: { ...authority(), decision: "DENY" },
    }),
    "authority_invalid",
  );

  const revokedStore = new InMemoryStore();
  revokedStore.authorityCurrent = false;
  assertFailure(await execute({ store: revokedStore }), "authority_revoked");
  assert.equal(revokedStore.claims.size, 0);
  assert.equal(revokedStore.accessDecisions.length, 0);
});

test("receipt insertion failure rolls back request, access decision, ingest use and claim", async () => {
  const store = new InMemoryStore();
  store.failNextResponseInsert = true;
  const ingest = ingestReceipt();
  const command = acknowledgeCommand({
    response: { kind: "EVIDENCE_SUBMITTED", ingestReceipt: ingest },
  });

  assertFailure(await execute({ store, command }), "store_unavailable");
  assert.deepEqual(store.currentRequest, request());
  assert.equal(store.consumedIngestReceiptIds.size, 0);
  assert.equal(store.accessDecisions.length, 0);
  assert.equal(store.responseReceipts.length, 0);
  assert.equal(store.audits.length, 0);
  assert.equal(store.claims.size, 0);

  const retry = await execute({ store, command, uuidStart: 7_000 });
  assert.equal(retry.ok, true);
  assert.equal(store.currentRequest?.state, "RESPONDED");
});

test("the command contract remains absent from current API route registration", () => {
  const runtimeSources = [
    "../src/index.ts",
    "../src/routes/students.ts",
    "../src/routes/effectiveDocRequirements.ts",
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");

  assert.doesNotMatch(runtimeSources, /studentDocumentRequestResponseCommand/);
  assert.doesNotMatch(runtimeSources, /student\.document_request\.respond/);
});
