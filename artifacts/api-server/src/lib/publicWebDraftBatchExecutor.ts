import {
  authorizePublicWebDraftIntakeCommand,
  type AuthorizedPublicWebDraftIntakeCommand,
} from "./publicWebDraftIntakeCommand.js";
import {
  buildServerBoundPublicWebDraftIntake,
  type PublicWebDraftIntakeRequest,
  type PublicWebDraftScope,
  type PublicWebDraftSourceBinding,
} from "./publicWebDraftIntakeBuilder.js";
import {
  planPublicWebDraftBatch,
  type PublicWebDraftBatchRejected,
} from "./publicWebDraftBatchPlanner.js";
import type {
  ResolvedActiveContextState,
  VerifiedActiveTenantContext,
} from "./activeTenantContext.js";
import type {
  PublicWebDraftIntakeStoreInput,
  PublicWebDraftIntakeStoreResult,
} from "./postgresPublicWebDraftIntakeStore.js";
import type { PublicWebEntityType } from "./publicWebContentContract.js";

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EXECUTION_CONCURRENCY = 2;

type SourceResolver = (
  entityType: PublicWebEntityType,
  entityId: number,
) => Promise<PublicWebDraftSourceBinding | null>;

type CurrentAuthorization = {
  context: VerifiedActiveTenantContext;
  state: ResolvedActiveContextState;
  impersonating: boolean;
};

export type PublicWebDraftBatchExecutionFailureReason =
  | "request_invalid"
  | "authority_unavailable"
  | "authorization_denied"
  | "execution_failed";

export type PublicWebDraftBatchExecutionCompleted = {
  index: number;
  outcome: "APPLIED" | "REPLAY";
  intakeReceiptId: string;
  contentRecordId: string;
  revisionId: string;
  status: "DRAFT";
  indexState: "NOINDEX";
  version: 1;
};

export type PublicWebDraftBatchExecutionFailure = {
  index: number;
  reason: PublicWebDraftBatchExecutionFailureReason;
};

export type PublicWebDraftBatchExecutionResult = {
  schemaVersion: 1;
  planSha256: string;
  total: number;
  rejected: PublicWebDraftBatchRejected[];
  completed: PublicWebDraftBatchExecutionCompleted[];
  failed: PublicWebDraftBatchExecutionFailure[];
};

type ExecuteOptions = {
  scope: PublicWebDraftScope;
  requests: unknown[];
  expectedPlanSha256: string;
  actorLegacyUserId: number;
  resolveSource: SourceResolver;
  resolveCurrentAuthorization: (input: {
    index: number;
    request: PublicWebDraftIntakeRequest;
    source: PublicWebDraftSourceBinding;
  }) => Promise<CurrentAuthorization>;
  executeAuthorizedDraft: (
    input: PublicWebDraftIntakeStoreInput,
  ) => Promise<PublicWebDraftIntakeStoreResult>;
  now?: () => number;
  newUuidV7?: (observedAt: number) => string;
};

function validOptions(input: ExecuteOptions): boolean {
  return Boolean(
    input &&
    typeof input.expectedPlanSha256 === "string" &&
    SHA256_RE.test(input.expectedPlanSha256) &&
    Number.isSafeInteger(input.actorLegacyUserId) &&
    input.actorLegacyUserId > 0 &&
    typeof input.resolveSource === "function" &&
    typeof input.resolveCurrentAuthorization === "function" &&
    typeof input.executeAuthorizedDraft === "function" &&
    (input.now === undefined || typeof input.now === "function") &&
    (input.newUuidV7 === undefined || typeof input.newUuidV7 === "function"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validStoreResult(
  value: unknown,
  authorized: AuthorizedPublicWebDraftIntakeCommand,
): value is PublicWebDraftIntakeStoreResult {
  return Boolean(
    isRecord(value) &&
    Object.keys(value).sort().join("\0") === [
      "contentRecordId",
      "indexState",
      "intakeReceiptId",
      "outcome",
      "revisionId",
      "status",
      "version",
    ].sort().join("\0") &&
    (value.outcome === "APPLIED" || value.outcome === "REPLAY") &&
    typeof value.intakeReceiptId === "string" &&
    UUID_V7_RE.test(value.intakeReceiptId) &&
    value.contentRecordId === authorized.command.contentRecordId &&
    value.revisionId === authorized.command.revisionId &&
    value.status === "DRAFT" &&
    value.indexState === "NOINDEX" &&
    value.version === 1,
  );
}

function completed(
  index: number,
  result: PublicWebDraftIntakeStoreResult,
): PublicWebDraftBatchExecutionCompleted {
  return {
    index,
    outcome: result.outcome,
    intakeReceiptId: result.intakeReceiptId,
    contentRecordId: result.contentRecordId,
    revisionId: result.revisionId,
    status: result.status,
    indexState: result.indexState,
    version: result.version,
  };
}

export async function executePublicWebDraftBatch(
  input: ExecuteOptions,
): Promise<PublicWebDraftBatchExecutionResult> {
  if (!validOptions(input)) {
    throw new Error("public_web_draft_batch_execution_input_invalid");
  }
  if (
    !input.scope ||
    typeof input.scope.tenantId !== "string" ||
    typeof input.scope.organizationId !== "string"
  ) {
    throw new Error("public_web_draft_batch_execution_input_invalid");
  }
  const options = {
    scope: {
      tenantId: input.scope.tenantId.toLowerCase(),
      organizationId: input.scope.organizationId.toLowerCase(),
    },
    requests: input.requests,
    expectedPlanSha256: input.expectedPlanSha256,
    actorLegacyUserId: input.actorLegacyUserId,
    resolveSource: input.resolveSource,
    resolveCurrentAuthorization: input.resolveCurrentAuthorization,
    executeAuthorizedDraft: input.executeAuthorizedDraft,
    now: input.now,
    newUuidV7: input.newUuidV7,
  };

  const plan = await planPublicWebDraftBatch({
    scope: options.scope,
    requests: options.requests,
    resolveSource: options.resolveSource,
  });
  if (plan.planSha256 !== options.expectedPlanSha256) {
    throw new Error("public_web_draft_batch_plan_changed");
  }

  const successful: PublicWebDraftBatchExecutionCompleted[] = [];
  const failed: PublicWebDraftBatchExecutionFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const acceptedIndex = cursor;
      cursor += 1;
      if (acceptedIndex >= plan.accepted.length) return;
      const item = plan.accepted[acceptedIndex];
      if (!item) return;

      const observedAt = (options.now ?? Date.now)();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
        failed.push({ index: item.index, reason: "request_invalid" });
        continue;
      }
      let built: ReturnType<typeof buildServerBoundPublicWebDraftIntake>;
      try {
        built = buildServerBoundPublicWebDraftIntake({
          scope: options.scope,
          request: item.request,
          source: item.source,
          now: observedAt,
          newUuidV7: options.newUuidV7,
        });
      } catch {
        failed.push({ index: item.index, reason: "request_invalid" });
        continue;
      }
      if (!built.ok) {
        failed.push({ index: item.index, reason: "request_invalid" });
        continue;
      }

      let current: CurrentAuthorization;
      try {
        current = await options.resolveCurrentAuthorization({
          index: item.index,
          request: item.request,
          source: item.source,
        });
      } catch {
        failed.push({ index: item.index, reason: "authority_unavailable" });
        continue;
      }

      let authorized: AuthorizedPublicWebDraftIntakeCommand;
      try {
        const decision = authorizePublicWebDraftIntakeCommand({
          context: current.context,
          state: current.state,
          command: built.command,
          impersonating: current.impersonating,
          now: observedAt,
        });
        if (!decision.ok) {
          failed.push({
            index: item.index,
            reason: decision.reason === "invalid_command"
              ? "request_invalid"
              : "authorization_denied",
          });
          continue;
        }
        authorized = decision.value;
      } catch {
        failed.push({ index: item.index, reason: "authorization_denied" });
        continue;
      }

      try {
        const result = await options.executeAuthorizedDraft({
          authorized,
          actorLegacyUserId: options.actorLegacyUserId,
        });
        if (!validStoreResult(result, authorized)) {
          throw new Error("public_web_draft_batch_store_result_invalid");
        }
        successful.push(completed(item.index, result));
      } catch {
        failed.push({ index: item.index, reason: "execution_failed" });
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(MAX_EXECUTION_CONCURRENCY, plan.accepted.length) },
    () => worker(),
  ));
  successful.sort((left, right) => left.index - right.index);
  failed.sort((left, right) => left.index - right.index);

  return {
    schemaVersion: 1,
    planSha256: plan.planSha256,
    total: plan.total,
    rejected: plan.rejected,
    completed: successful,
    failed,
  };
}
