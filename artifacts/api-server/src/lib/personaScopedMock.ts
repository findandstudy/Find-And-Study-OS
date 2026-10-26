import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  evaluateActiveTenantCapability,
  isSelectionBoundActiveTenantContext,
  verifyVersionedActiveTenantContext,
  type ActiveContextVerificationKey,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "./activeTenantContext";
import { nextSocialId } from "./socialOperationsContract";
import { parsePersonaWorkflow } from "./personaWorkflow";
import { personaMessageSchema } from "./personaConversation";
import { parsePersonaTeamDraft, personaTeamDigest, socialMockTeamTemplate } from "./personaTeamDraft";
import { parsePersonaTeamWorkspace } from "./personaTeamWorkspace";
import { createPersonaSocialContentLink } from "./personaSocialContentLink";
import { isPersonaAdminSessionAuthority, type PersonaAdminSessionAuthority } from "./personaAdminSession";
import {
  createPersonaRuntimeBoundary,
  assertPersonaRuntime,
  assertPersonaDatabase,
  type PersonaRuntimeBoundary,
} from "./personaRuntimeBoundary";
import {
  personaIntentDigest,
  type PersonaApprovalIntent,
} from "./personaSafety";

export type PersonaMockIdentity = {
  token: string;
  tenantId: string;
  principalId: string;
  sessionFingerprint: string;
  sessionBoundary?: <T>(operation: () => Promise<T>) => Promise<T>;
};
type Config = {
  /** Explicit disposable-fixture corridor only; never inferred from env. */
  socialContentLinks?: true;
} & ({
  /** Module-local direct administrator session; never a signed-context token. */
  adminSession: PersonaAdminSessionAuthority;
} | {
  adminSession?: never;
  audience: string;
  environmentId: string;
  cellId: string;
  issuerId: string;
  keyRing: readonly ActiveContextVerificationKey[];
});
type CrashPoint = "after_reservation" | "after_dispatch" | "after_provider";
type Tx = {
  client: PoolClient;
  context: Pick<VerifiedActiveTenantContext, "tenantId" | "organizationId" | "principalId">;
  project: any;
  authorize(cap: string): Promise<{ principal: { principalType: string } }>;
};
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const deny = (code: string): never => {
  throw new Error(`PERSONA_${code}`);
};
function positive(value: unknown): number {
  const n =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) return deny("COST_UNKNOWN");
  return n;
}
function knownUsage(value: unknown): number {
  const n =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(n) || n < 0)
    return deny("COST_RECONCILIATION_REQUIRED");
  return n;
}

type AdmissionWaiter = { admit: () => void };
type Admission = { active: number; queue: AdmissionWaiter[] };
const poolAdmissions = new WeakMap<object, Admission>();
/** Reserve room BEFORE taking the outer session connection. The business
 * transaction requires a second connection from the same local pool. */
async function withPersonaPoolAdmission<T>(
  pool: Pick<Pool, "connect">,
  sessionBound: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const configured = (pool as { options?: { max?: unknown } }).options?.max;
  const known = Number.isSafeInteger(configured) && Number(configured) > 0;
  if (sessionBound && (!known || Number(configured) < 2)) deny("POOL_CAPACITY_REQUIRED");
  const limit = known ? Math.min(2, Math.max(1, Math.floor(Number(configured) / 2))) : 2;
  let state = poolAdmissions.get(pool);
  if (!state) { state = { active: 0, queue: [] }; poolAdmissions.set(pool, state); }
  const admission = state;
  if (admission.active < limit) admission.active++;
  else {
    if (admission.queue.length >= 32) deny("BUSY");
    await new Promise<void>((resolve, reject) => {
      const waiter: AdmissionWaiter = { admit: () => {
        clearTimeout(timer); admission.active++; resolve();
      } };
      const timer = setTimeout(() => {
        const index = admission.queue.indexOf(waiter);
        if (index >= 0) admission.queue.splice(index, 1);
        reject(new Error("PERSONA_BUSY"));
      }, 5000);
      admission.queue.push(waiter);
    });
  }
  try { return await operation(); }
  finally {
    admission.active--;
    admission.queue.shift()?.admit();
  }
}

/** Mock-only application service. No provider callback,
 * network client, privileged fallback, grant endpoint or live activation switch.
 * Every operation uses existing signed context + canonical DB authority resolver.
 */
export function createPersonaScopedMock(
  pool: Pick<Pool, "connect">,
  config: Config,
  checkpoint: (point: CrashPoint) => Promise<void> = async () => {},
  runtime: PersonaRuntimeBoundary = createPersonaRuntimeBoundary(),
) {
  function assertServiceRuntime() {
    assertPersonaRuntime(runtime);
    if (config.adminSession && !isPersonaAdminSessionAuthority(config.adminSession))
      deny("ADMIN_SESSION_AUTHORITY_REQUIRED");
    if (!config.adminSession && runtime.mode === "staging-mock" && config.environmentId !== "staging")
      deny("STAGING_SESSION_CONFIG_REQUIRED");
  }
  assertServiceRuntime();

  function social(t: Tx) {
    if (config.socialContentLinks !== true || runtime.mode !== "disposable-test")
      deny("SOCIAL_NOT_CONFIGURED");
    const scope = { tenantId: t.context.tenantId, organizationId: t.context.organizationId!, projectId: t.project.id as string, principalId: t.context.principalId };
    return createPersonaSocialContentLink(t.client, scope, {
      async authorizeProject(capability) {
        await t.authorize(capability);
        return { authorized: true };
      },
      async assertSocialPermission(permission) {
        if ((await t.authorize("ai.persona.read")).principal.principalType !== "HUMAN")
          deny("SOCIAL_HUMAN_REQUIRED");
        // Resolve the actual account from the signed principal, never HTTP role
        // or project labels. Lock CURRENT stored permissions through this tx.
        // Missing role rows are denied in this narrow corridor (no fallback grant).
        const row = (await t.client.query(
          `SELECT u.id,r.permissions,u.permission_overrides FROM principals p
           JOIN users u ON u.id=p.legacy_user_id JOIN roles r ON r.name=u.role
           WHERE p.id=$1 AND p.principal_type='HUMAN' AND u.is_active=true AND u.deleted_at IS NULL
           FOR SHARE OF p,u,r`, [t.context.principalId],
        )).rows[0];
        const overrides = row?.permission_overrides;
        if (!row || !Array.isArray(row.permissions) ||
            (overrides !== null && (typeof overrides !== "object" || Array.isArray(overrides))))
          deny("SOCIAL_PERMISSION_REQUIRED");
        const override = overrides?.[permission];
        if (!(override === true || (override === undefined && row.permissions.includes(permission))))
          deny("SOCIAL_PERMISSION_REQUIRED");
        await t.client.query("SELECT set_config('app.legacy_user_id',$1,true)", [String(row.id)]);
        return { ...scope, legacyUserId: row.id as number, permission };
      },
    }, runtime);
  }

  async function hasSocialSchema(t: Tx) {
    // Even an otherwise-unconfigured composition must not expose a linked
    // result by switching this optional UI feature off. Legacy schemas without
    // the prepared migration remain compatible and have no such links.
    await t.authorize("ai.persona.read");
    return (await t.client.query("SELECT to_regclass('public.ai_persona_social_links') IS NOT NULL AS present")).rows[0].present === true;
  }
  async function assertWorkflowSocialSource(t: Tx, workflowId: number) {
    if (!await hasSocialSchema(t)) return;
    await t.authorize("ai.persona.read");
    const linked = await t.client.query("SELECT 1 FROM ai_persona_social_links WHERE project_id=$1 AND workflow_id=$2", [t.project.id, workflowId]);
    if (linked.rowCount) await social(t).workflowSource(workflowId);
  }

  async function tx<T>(
    identity: PersonaMockIdentity,
    projectId: string,
    cap: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    assertServiceRuntime();
    if (runtime.requireSessionBoundary && !identity.sessionBoundary)
      deny("SESSION_BOUNDARY_REQUIRED");
    return withPersonaPoolAdmission(pool, !!identity.sessionBoundary, async () => {
      assertServiceRuntime();
      const operation = () => transact(identity, projectId, cap, work);
      return identity.sessionBoundary
        ? identity.sessionBoundary(operation)
        : operation();
    });
  }

  async function transact<T>(
    identity: PersonaMockIdentity,
    projectId: string,
    cap: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!uuid.test(projectId)) deny("SCOPE_REQUIRED");
    const context = config.adminSession
      ? config.adminSession.contextFor(identity, projectId)
      : resolveSignedContext(identity);
    const client = await pool.connect();
    try {
      const host = (
        await client.query(`SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,
        current_user AS role,session_user AS session_role,
        r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`)
      ).rows[0];
      assertPersonaDatabase(runtime, host);
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='8000ms'");
      await client.query("SET LOCAL lock_timeout='4000ms'");
      await client.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.organization_id',$2,true),set_config('app.persona_project_id',$3,true),set_config('app.persona_actor_id',$4,true)",
        [context.tenantId, context.organizationId, projectId, context.principalId],
      );
      const authorize = async (capability: string) => {
        assertServiceRuntime();
        if (config.adminSession)
          return config.adminSession.authorize(client, identity, projectId, capability);
        if (!isSelectionBoundActiveTenantContext(context))
          return deny("AUTH_EXPIRED");
        const selection = await client.query(
          `SELECT 1 FROM active_session_context_selections WHERE id=$1 AND tenant_id=$2
          AND principal_id=$3 AND membership_id=$4 AND session_generation=$5 AND session_fingerprint=$6
          AND status='ACTIVE' AND impersonator_principal_id IS NULL FOR SHARE`,
          [
            context.selectionId,
            context.tenantId,
            context.principalId,
            context.membershipId,
            context.sessionGeneration,
            identity.sessionFingerprint,
          ],
        );
        if (selection.rowCount !== 1) deny("SELECTION_REVOKED");
        const mapped = await client.query(
          "SELECT assignment_id FROM ai_persona_project_assignments WHERE project_id=$1 AND assignment_id=ANY($2::uuid[]) FOR SHARE",
          [projectId, context.assignmentIds],
        );
        if (
          mapped.rowCount !== context.assignmentIds.length ||
          !mapped.rowCount
        )
          deny("PROJECT_DENIED");
        const state = (
          await client.query(
            "SELECT fas_cp_v1.resolve_active_context($1,$2,$3,$4,$5::uuid[]) AS state",
            [
              context.tenantId,
              context.principalId,
              context.membershipId,
              context.policyVersionId,
              context.assignmentIds,
            ],
          )
        ).rows[0].state as ResolvedActiveContextState;
        const decision = evaluateActiveTenantCapability({
          context,
          state,
          capabilityKey: capability,
          resource: {
            type: "ai_persona_project",
            id: projectId,
            tenantId: context.tenantId,
            organizationId: context.organizationId,
          },
        });
        if (!decision.allowed)
          deny(`CAPABILITY_DENIED_${decision.reason.toUpperCase()}`);
        return state;
      };
      await authorize(cap);
      // One project mutex, then persona/action locks: same lock order for all mutations.
      const project = (
        await client.query(
          "SELECT * FROM ai_persona_projects WHERE id=$1 AND active=true FOR UPDATE",
          [projectId],
        )
      ).rows[0];
      if (!project) deny("PROJECT_DENIED");
      const result = await work({ client, context, project, authorize });
      assertServiceRuntime();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof Error && /^PERSONA_[A-Z_]+$/.test(error.message))
        throw error;
      // An uncertain commit must be reconciled, not automatically retried.
      throw new Error("PERSONA_TRANSACTION_UNKNOWN_RECONCILE");
    } finally {
      client.release();
    }
  }

  function resolveSignedContext(identity: PersonaMockIdentity) {
    if (config.adminSession) return deny("AUTH_REQUIRED");
    const verified = verifyVersionedActiveTenantContext({
      token: identity.token,
      keyRing: config.keyRing,
      expected: {
        audience: config.audience,
        environmentId: config.environmentId,
        cellId: config.cellId,
        issuerId: config.issuerId,
        tenantId: identity.tenantId,
      },
      now: Date.now(),
    });
    if (
      !verified.ok ||
      !isSelectionBoundActiveTenantContext(verified.context) ||
      verified.context.principalId !== identity.principalId ||
      !verified.context.organizationId
    )
      deny("AUTH_REQUIRED");
    return verified.ok ? verified.context : deny("AUTH_REQUIRED");
  }

  async function persona(t: Tx, id: number) {
    await t.authorize("ai.persona.read");
    const row = (
      await t.client.query(
        `SELECT p.*,o.cap_micros FROM ai_persona_ownership o JOIN ai_personas p ON p.id=o.persona_id
      WHERE o.project_id=$1 AND o.persona_id=$2 AND o.active=true AND p.is_active=true FOR SHARE OF p,o`,
        [t.project.id, id],
      )
    ).rows[0];
    if (!row) deny("OWNERSHIP_REQUIRED");
    return row;
  }
  const configDigest = (p: any) =>
    digest([
      p.id,
      p.provider,
      p.model,
      p.system_prompt,
      p.guidelines,
      p.negative_prompt,
      p.tools_enabled,
      p.allowed_data_scopes,
      p.max_tokens,
      p.temperature,
    ]);
  function mockPermissions(p: any) {
    if (
      !Array.isArray(p.tools_enabled) ||
      !p.tools_enabled.includes("mock_draft") ||
      !Array.isArray(p.allowed_data_scopes) ||
      !p.allowed_data_scopes.includes("persona_mock_context")
    )
      deny("PERSONA_TOOL_SCOPE_DENIED");
  }
  async function action(t: Tx, id: number) {
    await t.authorize("ai.persona.read");
    if (await hasSocialSchema(t)) {
      const parent = await t.client.query("SELECT workflow_id FROM ai_persona_workflow_nodes WHERE project_id=$1 AND approval_id=$2", [t.project.id, id]);
      for (const row of parent.rows) await assertWorkflowSocialSource(t, row.workflow_id);
    }
    const row = (
      await t.client.query(
        `SELECT b.*,q.payload,q.status FROM ai_persona_approval_bindings b
      JOIN ai_action_queue q ON q.id=b.action_id WHERE b.project_id=$1 AND b.action_id=$2 FOR UPDATE OF b,q`,
        [t.project.id, id],
      )
    ).rows[0];
    if (!row) deny("ACTION_NOT_FOUND");
    const p = await persona(t, row.persona_id);
    if (
      row.digest !== personaIntentDigest(row.intent) ||
      row.digest !== personaIntentDigest(row.payload.intent) ||
      row.config_digest !== configDigest(p) ||
      row.payload.configDigest !== row.config_digest
    )
      deny("APPROVAL_STALE");
    return { row, p };
  }
  async function execution(t: Tx, id: string) {
    await t.authorize("ai.persona.read");
    const row = (
      await t.client.query(
        "SELECT * FROM ai_persona_executions WHERE project_id=$1 AND id=$2 FOR UPDATE",
        [t.project.id, id],
      )
    ).rows[0];
    if (!row) deny("EXECUTION_NOT_FOUND");
    return row;
  }
  async function settle(t: Tx, id: string) {
    const e = await execution(t, id);
    if (e.state === "SUCCEEDED")
      return { executionId: id, state: e.state, replay: true };
    // Accounting reconciles the immutable, consumed approval, not today's
    // editable persona/queue configuration. This grants NO new execution.
    await t.authorize("ai.persona.read");
    const a = (
      await t.client.query(
        "SELECT digest,intent FROM ai_persona_approval_bindings WHERE project_id=$1 AND action_id=$2 AND consumed_by=$3 AND persona_id=$4",
        [t.project.id, e.approval_id, id, e.persona_id],
      )
    ).rows[0];
    if (!a || a.digest !== personaIntentDigest(a.intent))
      deny("RECEIPT_INVALID");
    await t.authorize("ai.persona_context.read");
    const receipt = (
      await t.client.query(
        "SELECT * FROM ai_persona_mock_receipts WHERE project_id=$1 AND execution_id=$2",
        [t.project.id, id],
      )
    ).rows[0];
    if (!receipt) {
      await t.client.query(
        "UPDATE ai_persona_executions SET state='UNCERTAIN' WHERE id=$1",
        [id],
      );
      return { executionId: id, state: "UNCERTAIN", reservationHeld: true };
    }
    const cost = Number(receipt.actual_micros);
    if (
      receipt.digest !== a.digest ||
      !Number.isSafeInteger(cost) ||
      cost < 0 ||
      cost > Number(e.reserved_micros)
    )
      deny("RECEIPT_INVALID");
    await t.client.query(
      "UPDATE ai_persona_executions SET state='SUCCEEDED',actual_micros=$2 WHERE id=$1",
      [id, cost],
    );
    await t.client.query(
      "UPDATE ai_persona_runs SET status='success',cost_usd=$2::numeric/1000000,error_message=NULL,output_payload=$3::jsonb WHERE id=$1",
      [
        e.run_id,
        cost,
        JSON.stringify({
          executionId: id,
          provider: "mock",
          output: receipt.output,
        }),
      ],
    );
    await t.client.query(
      "UPDATE ai_action_queue SET status='executed',executed_at=now() WHERE id=$1 AND payload->'intent'=$2::jsonb",
      [e.approval_id, JSON.stringify(a.intent)],
    );
    return {
      executionId: id,
      state: "SUCCEEDED",
      output: receipt.output,
      actualMicros: cost,
    };
  }
  async function proposeInTransaction(
    t: Tx,
    personaId: number,
    content: string,
    target: string,
  ) {
    await t.authorize("ai.persona.propose");
    if (
      !content.trim() ||
      content.length > 16000 ||
      !target.trim() ||
      target.length > 256
    )
      deny("CONTENT_INVALID");
    const p = await persona(t, personaId);
    mockPermissions(p);
    const intent: PersonaApprovalIntent = {
      tenantId: t.context.tenantId,
      organizationId: t.context.organizationId!,
      projectId: t.project.id,
      accountId: "mock",
      action: "mock_draft",
      target,
      content,
      version: 1,
      amountMicros: positive(t.project.mock_bound_micros),
      currency: "USD",
      makerPrincipalId: t.context.principalId,
    };
    const hash = personaIntentDigest(intent),
      cfg = configDigest(p);
    const q = (
      await t.client.query(
        "INSERT INTO ai_action_queue(persona_id,action_type,payload,preview,status) VALUES($1,'mock_draft',$2,'Mock draft awaiting human review','pending_approval') RETURNING id",
        [personaId, JSON.stringify({ intent, configDigest: cfg })],
      )
    ).rows[0];
    await t.client.query(
      "INSERT INTO ai_persona_approval_bindings(action_id,tenant_id,organization_id,project_id,persona_id,intent,digest,config_digest,maker,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '10 minutes')",
      [
        q.id,
        t.context.tenantId,
        t.context.organizationId,
        t.project.id,
        personaId,
        JSON.stringify(intent),
        hash,
        cfg,
        t.context.principalId,
      ],
    );
    return { actionId: q.id, digest: hash, status: "pending_approval" };
  }
  async function workflowState(t: Tx, id: number) {
    await assertWorkflowSocialSource(t, id);
    await t.authorize("ai.persona.read");
    const row = (
      await t.client.query(
        "SELECT * FROM ai_persona_workflows WHERE project_id=$1 AND action_id=$2",
        [t.project.id, id],
      )
    ).rows[0];
    if (!row) deny("WORKFLOW_NOT_FOUND");
    const document = parsePersonaWorkflow(row.document);
    if (digest(document) !== row.digest) deny("WORKFLOW_INVALID");
    const rows = (
      await t.client.query(
        "SELECT n.node_key,n.approval_id,b.digest,b.expires_at,q.status,e.state,e.id AS execution_id,r.digest AS receipt_digest,CASE WHEN r.execution_id IS NOT NULL THEN jsonb_build_object('executionId',r.execution_id,'provider','mock','output',r.output) ELSE NULL END AS output_payload FROM ai_persona_workflow_nodes n JOIN ai_persona_approval_bindings b ON b.action_id=n.approval_id JOIN ai_action_queue q ON q.id=n.approval_id LEFT JOIN ai_persona_executions e ON e.approval_id=n.approval_id LEFT JOIN ai_persona_mock_receipts r ON r.execution_id=e.id AND r.project_id=n.project_id WHERE n.project_id=$1 AND n.workflow_id=$2",
        [t.project.id, id],
      )
    ).rows;
    for (const row of rows)
      if (
        row.state === "SUCCEEDED" &&
        (!row.output_payload || row.receipt_digest !== row.digest)
      )
        deny("RECEIPT_INVALID");
    const nodes = document.nodes.map((node) => {
      const found = rows.find((r) => r.node_key === node.key);
      let status = "QUEUED";
      if (found?.state === "SUCCEEDED") status = "COMPLETED";
      else if (row.state === "CANCELLED") status = "CANCELLED";
      else if (found?.state === "UNCERTAIN") status = "BLOCKED";
      else if (found?.state) status = "RUNNING";
      else if (found?.expires_at?.getTime() <= Date.now()) status = "BLOCKED";
      else if (found)
        status = found.status === "approved" ? "QUEUED" : "AWAITING_APPROVAL";
      return { ...node, ...found, status };
    });
    const state =
      row.state === "CANCELLED"
        ? "CANCELLED"
        : nodes.every((n) => n.status === "COMPLETED")
          ? "COMPLETED"
          : nodes.some((n) => n.status === "BLOCKED")
            ? "BLOCKED"
            : nodes.some((n) => n.status === "RUNNING")
              ? "RUNNING"
              : nodes.some((n) => n.status === "AWAITING_APPROVAL")
                ? "AWAITING_APPROVAL"
                : "QUEUED";
    const resultDigest =
      state === "COMPLETED"
        ? digest({
            workflow: id,
            documentDigest: row.digest,
            results: nodes.map((n) => ({
              key: n.key,
              executionId: n.execution_id,
              output: n.output_payload,
            })),
          })
        : null;
    const review =
      (
        await t.client.query(
          "SELECT result_digest,reviewer,reviewed_at FROM ai_persona_workflow_reviews WHERE project_id=$1 AND workflow_id=$2",
          [t.project.id, id],
        )
      ).rows[0] ?? null;
    if (review && review.result_digest !== resultDigest)
      deny("WORKFLOW_RESULT_CHANGED");
    return {
      actionId: id,
      state,
      document,
      nodes,
      resultDigest,
      review,
      maker: row.maker,
    };
  }
  return {
    socialSource(identity: PersonaMockIdentity, projectId: string, briefId: string) {
      return tx(identity, projectId, "ai.persona.read", t => social(t).source(briefId));
    },
    socialLinks(identity: PersonaMockIdentity, projectId: string, briefId: string) {
      return tx(identity, projectId, "ai.persona.read", t => social(t).links(briefId));
    },
    workflowSocialSource(identity: PersonaMockIdentity, projectId: string, workflowId: number) {
      return tx(identity, projectId, "ai.persona.read", t => social(t).workflowSource(workflowId));
    },
    linkSocialWorkflow(identity: PersonaMockIdentity, projectId: string, input: unknown) {
      return tx(identity, projectId, "ai.persona_task.manage", t => social(t).linkWorkflow(input));
    },
    workspaceContext(identity: PersonaMockIdentity, projectId: string) {
      return tx(identity, projectId, "ai.persona.read", async (t) => ({
        project: { id: t.project.id, label: t.project.label },
        template: parsePersonaTeamDraft({ ...socialMockTeamTemplate, name: "Yeni takım taslağı", members: socialMockTeamTemplate.members.slice(0, 1) }),
        mode: "mock" as const,
        providerConnected: false,
        workspaceIsApproval: false,
      }));
    },
    appendMessage(
      identity: PersonaMockIdentity,
      projectId: string,
      input: unknown,
    ) {
      const message = personaMessageSchema.parse(input);
      return tx(identity, projectId, "ai.persona_context.write", async (t) => {
        if (
          (await t.authorize("ai.persona_context.write")).principal
            .principalType !== "HUMAN"
        )
          deny("HUMAN_REQUIRED");
        await persona(t, message.personaId);
        const version = Number(
          (
            await t.client.query(
              "SELECT coalesce(max(version),0)+1 AS version FROM ai_persona_message_scope WHERE project_id=$1 AND conversation_id=$2",
              [projectId, message.conversationId],
            )
          ).rows[0].version,
        );
        const saved = (
          await t.client.query(
            "INSERT INTO ai_persona_messages(persona_id,conversation_id,role,content) VALUES($1,$2,'user',$3) RETURNING id",
            [message.personaId, message.conversationId, message.text],
          )
        ).rows[0];
        await t.client.query(
          "INSERT INTO ai_persona_message_scope(message_id,tenant_id,organization_id,project_id,persona_id,conversation_id,version,actor,source,source_label,content_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+($12::int*interval '1 day'))",
          [
            saved.id,
            identity.tenantId,
            t.context.organizationId,
            projectId,
            message.personaId,
            message.conversationId,
            version,
            t.context.principalId,
            message.source,
            message.sourceLabel,
            digest(message.text),
            message.retentionDays,
          ],
        );
        return {
          messageId: saved.id,
          version,
          authority: "NONE",
          taskCreated: false,
        };
      });
    },
    conversation(
      identity: PersonaMockIdentity,
      projectId: string,
      conversationId: string,
    ) {
      if (!uuid.test(conversationId)) deny("CONVERSATION_INVALID");
      return tx(identity, projectId, "ai.persona_context.read", async (t) => {
        const rows = (
          await t.client.query(
            "SELECT s.*,m.content FROM ai_persona_message_scope s JOIN ai_persona_messages m ON m.id=s.message_id AND m.persona_id=s.persona_id AND m.conversation_id=s.conversation_id::text WHERE s.project_id=$1 AND s.conversation_id=$2 AND s.expires_at>now() AND s.purged_at IS NULL ORDER BY s.version DESC LIMIT 100",
            [projectId, conversationId],
          )
        ).rows;
        for (const row of rows)
          if (row.content_digest !== digest(row.content))
            deny("MESSAGE_CHANGED");
        return rows.reverse().map((row) => ({ ...row, authority: "NONE" }));
      });
    },
    purgeExpiredMessages(identity: PersonaMockIdentity, projectId: string) {
      return tx(
        identity,
        projectId,
        "ai.persona_context.retention",
        async (t) => {
          const rows = (
            await t.client.query(
              "SELECT message_id FROM ai_persona_message_scope WHERE project_id=$1 AND expires_at<=now() AND purged_at IS NULL ORDER BY message_id LIMIT 100 FOR UPDATE",
              [projectId],
            )
          ).rows;
          const ids = rows.map((r) => r.message_id);
          if (ids.length) {
            await t.client.query(
              "UPDATE ai_persona_messages SET content='',tool_calls=NULL WHERE id=ANY($1::int[])",
              [ids],
            );
            await t.client.query(
              "UPDATE ai_persona_message_scope SET purged_at=now(),source_label='[expired]' WHERE message_id=ANY($1::int[])",
              [ids],
            );
          }
          return { purged: ids.length, moreMayRemain: ids.length === 100 };
        },
      );
    },
    createWorkflow(
      identity: PersonaMockIdentity,
      projectId: string,
      requestKey: string,
      input: unknown,
    ) {
      const document = parsePersonaWorkflow(input),
        hash = digest(document);
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey))
        deny("REQUEST_KEY_INVALID");
      return tx(identity, projectId, "ai.persona_task.manage", async (t) => {
        const old = (
          await t.client.query(
            "SELECT action_id,digest FROM ai_persona_workflows WHERE project_id=$1 AND request_key=$2",
            [projectId, requestKey],
          )
        ).rows[0];
        if (old) {
          if (old.digest !== hash) deny("IDEMPOTENCY_CONFLICT");
          return workflowState(t, old.action_id);
        }
        for (const node of document.nodes) await persona(t, node.personaId);
        const q = (
          await t.client.query(
            "INSERT INTO ai_action_queue(persona_id,action_type,payload,preview,status) VALUES($1,'persona_workflow',$2,$3,'pending_approval') RETURNING id",
            [
              document.nodes[0].personaId,
              JSON.stringify({ document, digest: hash }),
              document.name,
            ],
          )
        ).rows[0];
        await t.client.query(
          "INSERT INTO ai_persona_workflows(action_id,tenant_id,organization_id,project_id,request_key,document,digest,maker) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            q.id,
            identity.tenantId,
            t.context.organizationId,
            projectId,
            requestKey,
            JSON.stringify(document),
            hash,
            t.context.principalId,
          ],
        );
        return workflowState(t, q.id);
      });
    },
    workflows(identity: PersonaMockIdentity, projectId: string) {
      return tx(identity, projectId, "ai.persona.read", async (t) => {
        const rows = (
          await t.client.query(
            "SELECT action_id FROM ai_persona_workflows WHERE project_id=$1 ORDER BY action_id DESC LIMIT 25",
            [projectId],
          )
        ).rows;
        const result = [];
        for (const row of rows) {
          const work = await workflowState(t, row.action_id);
          result.push({
            actionId: work.actionId,
            name: work.document.name,
            state: work.state,
            reviewed: !!work.review,
          });
        }
        return result;
      });
    },
    workflow(identity: PersonaMockIdentity, projectId: string, id: number) {
      return tx(identity, projectId, "ai.persona.read", (t) =>
        workflowState(t, id),
      );
    },
    reviewWorkflowResult(
      identity: PersonaMockIdentity,
      projectId: string,
      id: number,
      expectedDigest: string,
    ) {
      return tx(identity, projectId, "ai.persona.approve", async (t) => {
        if (
          (await t.authorize("ai.persona.approve")).principal.principalType !==
          "HUMAN"
        )
          deny("HUMAN_REQUIRED");
        const work = await workflowState(t, id);
        if (work.maker === t.context.principalId) deny("SELF_APPROVAL");
        if (work.state !== "COMPLETED" || work.resultDigest !== expectedDigest)
          deny("APPROVAL_STALE");
        if (!work.review)
          await t.client.query(
            "INSERT INTO ai_persona_workflow_reviews(tenant_id,organization_id,project_id,workflow_id,result_digest,reviewer) VALUES($1,$2,$3,$4,$5,$6)",
            [
              identity.tenantId,
              t.context.organizationId,
              projectId,
              id,
              expectedDigest,
              t.context.principalId,
            ],
          );
        return { ...(await workflowState(t, id)), published: false };
      });
    },
    advanceWorkflow(
      identity: PersonaMockIdentity,
      projectId: string,
      id: number,
    ) {
      return tx(identity, projectId, "ai.persona_task.manage", async (t) => {
        const work = await workflowState(t, id);
        if (
          ["CANCELLED", "BLOCKED", "COMPLETED", "RUNNING"].includes(work.state)
        )
          return work;
        for (const node of work.nodes) {
          if (
            node.approval_id ||
            !node.dependsOn.every(
              (key: string) =>
                work.nodes.find((n) => n.key === key)?.status === "COMPLETED",
            )
          )
            continue;
          const inputs = node.dependsOn.map((key: string) => {
            const upstream = work.nodes.find((n) => n.key === key)!;
            const output = String(upstream.output_payload?.output ?? "");
            return {
              key,
              executionId: upstream.execution_id,
              outputDigest: digest(output),
              outputPreview: output.slice(0, 800),
              truncated: output.length > 800,
            };
          });
          const content = JSON.stringify({
            mode: "MOCK_ONLY",
            stage: node.key,
            brief: work.document.brief,
            inputs,
            notice: "Synthetic draft, not factual research or generated media.",
          });
          const proposal = await proposeInTransaction(
            t,
            node.personaId,
            content,
            `workflow:${id}:${node.key}`,
          );
          await t.client.query(
            "INSERT INTO ai_persona_workflow_nodes(tenant_id,organization_id,project_id,workflow_id,node_key,approval_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              identity.tenantId,
              t.context.organizationId,
              projectId,
              id,
              node.key,
              proposal.actionId,
            ],
          );
          break;
        }
        return workflowState(t, id);
      });
    },
    cancelWorkflow(
      identity: PersonaMockIdentity,
      projectId: string,
      id: number,
    ) {
      return tx(identity, projectId, "ai.persona_task.manage", async (t) => {
        const work = await workflowState(t, id);
        if (work.state === "CANCELLED") return work;
        if (
          work.nodes.some(
            (n) => n.execution_id && ["RUNNING", "BLOCKED"].includes(n.status),
          )
        )
          deny("RECONCILIATION_REQUIRED");
        if (work.state === "COMPLETED") deny("WORKFLOW_COMPLETED");
        await t.client.query(
          "UPDATE ai_action_queue q SET status='rejected' FROM ai_persona_workflow_nodes n WHERE q.id=n.approval_id AND n.workflow_id=$1 AND n.project_id=$2 AND q.status IN ('pending_approval','approved')",
          [id, projectId],
        );
        await t.client.query(
          "UPDATE ai_persona_workflows SET state='CANCELLED' WHERE action_id=$1 AND project_id=$2",
          [id, projectId],
        );
        return workflowState(t, id);
      });
    },
    teams(identity: PersonaMockIdentity, projectId: string) {
      return tx(
        identity,
        projectId,
        "ai.persona.read",
        async (t) =>
          (
            await t.client.query(
              "SELECT i.id,i.draft_id,i.status,d.document,m.member_key,m.parent_key,m.persona_id FROM ai_persona_team_instances i JOIN ai_persona_team_drafts d ON d.action_id=i.draft_id JOIN ai_persona_team_members m ON m.team_id=i.id WHERE i.project_id=$1 ORDER BY i.created_at,m.persona_id LIMIT 1000",
              [projectId],
            )
          ).rows,
      );
    },
    installTeam(
      identity: PersonaMockIdentity,
      projectId: string,
      actionId: number,
      expectedDigest: string,
    ) {
      return tx(identity, projectId, "ai.persona_team.manage", async (t) => {
        if (
          (await t.authorize("ai.persona_team.manage")).principal
            .principalType !== "HUMAN"
        )
          deny("HUMAN_REQUIRED");
        const row = (
          await t.client.query(
            "SELECT * FROM ai_persona_team_drafts WHERE project_id=$1 AND action_id=$2 FOR UPDATE",
            [projectId, actionId],
          )
        ).rows[0];
        if (!row || !row.reviewer) deny("APPROVAL_REQUIRED");
        if (
          row.digest !== expectedDigest ||
          personaTeamDigest(row.document) !== expectedDigest
        )
          deny("APPROVAL_STALE");
        const existing = (
          await t.client.query(
            "SELECT id,status FROM ai_persona_team_instances WHERE project_id=$1 AND draft_id=$2",
            [projectId, actionId],
          )
        ).rows[0];
        if (existing) return { ...existing, replay: true, grantsCreated: 0 };
        const teamId = nextSocialId(),
          document = parsePersonaTeamDraft(row.document);
        await t.client.query(
          "INSERT INTO ai_persona_team_instances(id,tenant_id,organization_id,project_id,draft_id,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            teamId,
            identity.tenantId,
            t.context.organizationId,
            projectId,
            actionId,
            identity.principalId,
          ],
        );
        for (const member of document.members) {
          const p = (
            await t.client.query(
              "INSERT INTO ai_personas(name,slug,description,provider,model,system_prompt,is_active,tools_enabled,allowed_data_scopes,temperature,max_tokens) VALUES($1,$2,$3,'anthropic','mock-fixture',$4,false,$5,$6,0,100) RETURNING id",
              [
                member.name,
                `mock-team-${teamId}-${member.key}`,
                member.output,
                member.purpose,
                JSON.stringify(member.tools),
                JSON.stringify(member.dataScopes),
              ],
            )
          ).rows[0];
          await t.client.query(
            "INSERT INTO ai_persona_ownership(persona_id,tenant_id,organization_id,project_id,cap_micros,active,evidence_ref,maker,checker) VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)",
            [
              p.id,
              identity.tenantId,
              t.context.organizationId,
              projectId,
              member.capMicros,
              `approved-team:${actionId}:${expectedDigest}`,
              row.maker,
              row.reviewer,
            ],
          );
          await t.client.query(
            "INSERT INTO ai_persona_team_members(tenant_id,organization_id,project_id,team_id,member_key,parent_key,persona_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              identity.tenantId,
              t.context.organizationId,
              projectId,
              teamId,
              member.key,
              member.parent,
              p.id,
            ],
          );
        }
        return {
          id: teamId,
          status: "PAUSED",
          replay: false,
          grantsCreated: 0,
        };
      });
    },
    setTeamPaused(
      identity: PersonaMockIdentity,
      projectId: string,
      teamId: string,
      paused: boolean,
    ) {
      return tx(identity, projectId, "ai.persona_team.manage", async (t) => {
        if (
          (await t.authorize("ai.persona_team.manage")).principal
            .principalType !== "HUMAN"
        )
          deny("HUMAN_REQUIRED");
        const team = (
          await t.client.query(
            "SELECT id FROM ai_persona_team_instances WHERE project_id=$1 AND id=$2 FOR UPDATE",
            [projectId, teamId],
          )
        ).rows[0];
        if (!team) deny("TEAM_NOT_FOUND");
        await t.client.query(
          "UPDATE ai_personas SET is_active=$3 FROM ai_persona_team_members m WHERE ai_personas.id=m.persona_id AND m.project_id=$1 AND m.team_id=$2",
          [projectId, teamId, !paused],
        );
        const status = paused ? "PAUSED" : "MOCK_READY";
        await t.client.query(
          "UPDATE ai_persona_team_instances SET status=$2 WHERE id=$1",
          [teamId, status],
        );
        return { id: teamId, status, providerActivation: false };
      });
    },
    teamWorkspace(identity: PersonaMockIdentity, projectId: string) {
      return tx(identity, projectId, "ai.persona.read", async (t) => {
        const row = (await t.client.query(
          "SELECT revision,document,layout,updated_at FROM ai_persona_team_workspaces WHERE project_id=$1 AND actor=$2",
          [projectId, t.context.principalId],
        )).rows[0];
        if (!row) return { workspace: null };
        // Do not trust persisted JSON more than request JSON.
        const parsed = parsePersonaTeamWorkspace({
          expectedRevision: row.revision - 1, document: row.document, layout: row.layout,
        });
        return { workspace: {
          revision: row.revision, document: parsed.document, layout: parsed.layout,
          updatedAt: row.updated_at,
        } };
      });
    },
    saveTeamWorkspace(identity: PersonaMockIdentity, projectId: string, input: unknown) {
      const value = parsePersonaTeamWorkspace(input);
      return tx(identity, projectId, "ai.persona_team.propose", async (t) => {
        if ((await t.authorize("ai.persona_team.propose")).principal.principalType !== "HUMAN")
          deny("HUMAN_REQUIRED");
        const current = (await t.client.query(
          "SELECT revision FROM ai_persona_team_workspaces WHERE project_id=$1 AND actor=$2 FOR UPDATE",
          [projectId, t.context.principalId],
        )).rows[0];
        if ((current?.revision ?? 0) !== value.expectedRevision) deny("WORKSPACE_CONFLICT");
        const result = current
          ? await t.client.query(
            "UPDATE ai_persona_team_workspaces SET revision=revision+1,document=$3,layout=$4 WHERE project_id=$1 AND actor=$2 AND revision=$5 RETURNING revision,document,layout,updated_at",
            [projectId, t.context.principalId, JSON.stringify(value.document), JSON.stringify(value.layout), value.expectedRevision],
          )
          : await t.client.query(
            "INSERT INTO ai_persona_team_workspaces(tenant_id,organization_id,project_id,actor,revision,document,layout) VALUES($1,$2,$3,$4,1,$5,$6) RETURNING revision,document,layout,updated_at",
            [t.context.tenantId, t.context.organizationId, projectId, t.context.principalId, JSON.stringify(value.document), JSON.stringify(value.layout)],
          );
        if (result.rowCount !== 1) deny("WORKSPACE_CONFLICT");
        const row = result.rows[0];
        return { workspace: {
          revision: row.revision, document: row.document, layout: row.layout, updatedAt: row.updated_at,
        }, approved: false, activated: false };
      });
    },
    teamDrafts(identity: PersonaMockIdentity, projectId: string) {
      return tx(
        identity,
        projectId,
        "ai.persona.read",
        async (t) =>
          (
            await t.client.query(
              "SELECT action_id,document,digest,maker,reviewer,reviewed_at FROM ai_persona_team_drafts WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50",
              [projectId],
            )
          ).rows,
      );
    },
    proposeTeam(
      identity: PersonaMockIdentity,
      projectId: string,
      personaId: number | undefined,
      input: unknown,
    ) {
      const document = parsePersonaTeamDraft(input),
        hash = personaTeamDigest(document);
      return tx(identity, projectId, "ai.persona_team.propose", async (t) => {
        const state = await t.authorize("ai.persona_team.propose");
        if (state.principal.principalType !== "HUMAN") deny("HUMAN_REQUIRED");
        // Older clients may still supply an owned persona. Validate that hint,
        // but the first team can be proposed before any persona exists.
        if (personaId !== undefined) await persona(t, personaId);
        const draft = (
          await t.client.query(
            "INSERT INTO ai_persona_team_drafts(tenant_id,organization_id,project_id,document,digest,maker) VALUES($1,$2,$3,$4,$5,$6) RETURNING action_id",
            [
              identity.tenantId,
              t.context.organizationId,
              projectId,
              JSON.stringify(document),
              hash,
              identity.principalId,
            ],
          )
        ).rows[0];
        return {
          actionId: draft.action_id,
          digest: hash,
          document,
          activated: false,
        };
      });
    },
    approveTeam(
      identity: PersonaMockIdentity,
      projectId: string,
      actionId: number,
      expectedDigest: string,
    ) {
      return tx(identity, projectId, "ai.persona_team.approve", async (t) => {
        const state = await t.authorize("ai.persona_team.approve");
        if (state.principal.principalType !== "HUMAN") deny("HUMAN_REQUIRED");
        const row = (
          await t.client.query(
            "SELECT * FROM ai_persona_team_drafts WHERE project_id=$1 AND action_id=$2 FOR UPDATE",
            [projectId, actionId],
          )
        ).rows[0];
        if (!row) deny("ACTION_NOT_FOUND");
        if (row.maker === identity.principalId) deny("SELF_APPROVAL_DENIED");
        if (
          row.digest !== expectedDigest ||
          personaTeamDigest(row.document) !== expectedDigest
        )
          deny("APPROVAL_STALE");
        if (!row.reviewer) {
          await t.client.query(
            "UPDATE ai_persona_team_drafts SET reviewer=$2,reviewed_at=now() WHERE action_id=$1",
            [actionId, identity.principalId],
          );
        }
        return { actionId, approved: true, activated: false, grantsCreated: 0 };
      });
    },
    list(identity: PersonaMockIdentity, projectId: string) {
      return tx(
        identity,
        projectId,
        "ai.persona.read",
        async (t) =>
          (
            await t.client.query(
              `SELECT p.id,p.name FROM ai_persona_ownership o
        JOIN ai_personas p ON p.id=o.persona_id WHERE o.project_id=$1 AND o.active=true ORDER BY p.id LIMIT 100`,
              [projectId],
            )
          ).rows,
      );
    },
    history(identity: PersonaMockIdentity, projectId: string) {
      return tx(
        identity,
        projectId,
        "ai.persona.read",
        async (t) => {
          const rows = (await t.client.query(
              `SELECT e.id,e.approval_id,e.persona_id,e.state,e.reserved_micros,e.actual_micros
        FROM ai_persona_executions e JOIN ai_persona_runs r ON r.id=e.run_id WHERE e.project_id=$1 ORDER BY e.created_at DESC LIMIT 100`,
              [projectId],
            )).rows;
          if (await hasSocialSchema(t)) {
            await t.authorize("ai.persona.read");
            const parents = await t.client.query("SELECT DISTINCT workflow_id FROM ai_persona_workflow_nodes WHERE project_id=$1 AND approval_id=ANY($2::int[])", [projectId, rows.map(row => row.approval_id)]);
            for (const row of parents.rows) await assertWorkflowSocialSource(t, row.workflow_id);
          }
          await t.authorize("ai.persona.read");
          // Fetch sensitive result text only AFTER both current authorizations,
          // not merely suppress it from the HTTP response after reading it.
          const outputs = rows.length ? (await t.client.query(
            "SELECT e.id,r.output_payload FROM ai_persona_executions e JOIN ai_persona_runs r ON r.id=e.run_id WHERE e.project_id=$1 AND e.id=ANY($2::uuid[])",
            [projectId, rows.map(row => row.id)],
          )).rows : [];
          return rows.map(({ approval_id: _approval, ...row }) => ({ ...row, output_payload: outputs.find(output => output.id === row.id)?.output_payload ?? null }));
        },
      );
    },
    proposals(identity: PersonaMockIdentity, projectId: string) {
      return tx(identity, projectId, "ai.persona.read", async (t) => {
        const rows = (await t.client.query(
          `SELECT b.action_id,b.persona_id,b.intent,b.digest,b.maker,b.reviewer,b.expires_at,b.consumed_by,q.status,q.payload
          FROM ai_persona_approval_bindings b
          JOIN ai_action_queue q ON q.id=b.action_id AND q.persona_id=b.persona_id AND q.action_type='mock_draft'
          JOIN ai_persona_ownership o ON o.project_id=b.project_id AND o.persona_id=b.persona_id AND o.active=true
          WHERE b.project_id=$1 AND NOT EXISTS (
            SELECT 1 FROM ai_persona_workflow_nodes n WHERE n.project_id=$1 AND n.approval_id=b.action_id
          ) ORDER BY b.action_id DESC LIMIT 50`,
          [projectId],
        )).rows;
        return rows.map((row) => {
          if (row.intent.projectId !== projectId || row.intent.tenantId !== t.context.tenantId ||
            row.intent.organizationId !== t.context.organizationId || row.intent.action !== "mock_draft" ||
            row.intent.accountId !== "mock" || row.digest !== personaIntentDigest(row.intent) ||
            row.digest !== personaIntentDigest(row.payload.intent)) deny("APPROVAL_STALE");
          return {
            actionId: row.action_id, personaId: row.persona_id, status: row.status,
            intent: row.intent, digest: row.digest, maker: row.maker, reviewer: row.reviewer,
            expiresAt: row.expires_at, consumedBy: row.consumed_by,
          };
        });
      });
    },
    review(identity: PersonaMockIdentity, projectId: string, actionId: number) {
      return tx(identity, projectId, "ai.persona.read", async (t) => {
        const { row } = await action(t, actionId);
        return {
          actionId,
          intent: row.intent,
          digest: row.digest,
          configDigest: row.config_digest,
          status: row.status,
          reviewer: row.reviewer,
          reviewedAt: row.reviewed_at,
          expiresAt: row.expires_at,
        };
      });
    },
    propose(
      identity: PersonaMockIdentity,
      projectId: string,
      personaId: number,
      content: string,
      target: string,
    ) {
      return tx(identity, projectId, "ai.persona.propose", (t) =>
        proposeInTransaction(t, personaId, content, target),
      );
    },
    approve(
      identity: PersonaMockIdentity,
      projectId: string,
      actionId: number,
      expectedDigest: string,
    ) {
      return tx(identity, projectId, "ai.persona.approve", async (t) => {
        const state = await t.authorize("ai.persona.approve");
        const { row } = await action(t, actionId);
        if (
          state.principal.principalType !== "HUMAN" ||
          row.maker === t.context.principalId
        )
          deny("SELF_APPROVAL_DENIED");
        if (
          row.digest !== expectedDigest ||
          row.status !== "pending_approval" ||
          row.expires_at.getTime() <= Date.now()
        )
          deny("APPROVAL_STALE");
        await t.client.query(
          "UPDATE ai_persona_approval_bindings SET reviewer=$2,reviewed_at=now() WHERE action_id=$1",
          [actionId, t.context.principalId],
        );
        await t.client.query(
          "UPDATE ai_action_queue SET status='approved',reviewed_at=now() WHERE id=$1",
          [actionId],
        );
        return { actionId, status: "approved", executed: false };
      });
    },
    async execute(
      identity: PersonaMockIdentity,
      projectId: string,
      actionId: number,
    ) {
      const admission = await tx(
        identity,
        projectId,
        "ai.persona.execute",
        async (t) => {
          const { row: a, p } = await action(t, actionId);
          mockPermissions(p);
          if (a.consumed_by)
            return { executionId: a.consumed_by as string, replay: true };
          if (
            a.status !== "approved" ||
            !a.reviewer ||
            a.reviewer === a.maker ||
            a.expires_at.getTime() <= Date.now()
          )
            deny("APPROVAL_REQUIRED");
          const bound = positive(a.intent.amountMicros);
          if (
            bound !== positive(t.project.mock_bound_micros) ||
            a.intent.accountId !== "mock" ||
            a.intent.action !== "mock_draft"
          )
            deny("APPROVAL_STALE");
          const projectCap = positive(t.project.cap_micros),
            personaCap = positive(p.cap_micros);
          if (
            !t.project.costs_verified ||
            t.project.period_start.getTime() > Date.now() ||
            t.project.period_end.getTime() <= Date.now()
          )
            deny("BUDGET_UNVERIFIED");
          const legacy = (
            await t.client.query(
              `SELECT count(*) FILTER(WHERE r.cost_usd IS NULL OR r.cost_usd < 0)::int AS unknown,
          COALESCE(sum(r.cost_usd*1000000) FILTER(WHERE r.created_at >= $2),0)::text AS project,
          COALESCE(sum(r.cost_usd*1000000) FILTER(WHERE r.created_at >= $2 AND r.persona_id=$3),0)::text AS persona
          FROM ai_persona_runs r JOIN ai_persona_ownership o ON o.persona_id=r.persona_id
          LEFT JOIN ai_persona_executions e ON e.run_id=r.id WHERE o.project_id=$1 AND e.id IS NULL`,
              [projectId, t.project.period_start, p.id],
            )
          ).rows[0];
          if (legacy.unknown !== 0) deny("COST_RECONCILIATION_REQUIRED");
          const usage = (
            await t.client.query(
              `SELECT COALESCE(sum(COALESCE(actual_micros,reserved_micros)),0)::text AS project,
          COALESCE(sum(COALESCE(actual_micros,reserved_micros)) FILTER(WHERE persona_id=$2),0)::text AS persona
          FROM ai_persona_executions WHERE project_id=$1 AND (created_at >= $3 OR actual_micros IS NULL)`,
              [projectId, p.id, t.project.period_start],
            )
          ).rows[0];
          if (
            bound >
              projectCap -
                knownUsage(usage.project) -
                knownUsage(legacy.project) ||
            bound >
              personaCap -
                knownUsage(usage.persona) -
                knownUsage(legacy.persona)
          )
            deny("BUDGET_EXCEEDED");
          const id = nextSocialId();
          const run = (
            await t.client.query(
              `INSERT INTO ai_persona_runs(persona_id,triggered_by,status,cost_usd,error_message,output_payload)
          VALUES ($1,'manual','error',NULL,'MOCK_RESERVED_NOT_COMPLETED',$2::jsonb) RETURNING id`,
              [p.id, JSON.stringify({ executionId: id })],
            )
          ).rows[0];
          await t.client.query(
            `INSERT INTO ai_persona_executions(id,tenant_id,organization_id,project_id,persona_id,approval_id,run_id,actor,reserved_micros,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RESERVED')`,
            [
              id,
              t.context.tenantId,
              t.context.organizationId,
              projectId,
              p.id,
              actionId,
              run.id,
              t.context.principalId,
              bound,
            ],
          );
          await t.client.query(
            "UPDATE ai_persona_approval_bindings SET consumed_by=$2 WHERE action_id=$1",
            [actionId, id],
          );
          return { executionId: id, replay: false };
        },
      );
      if (admission.replay) return admission;
      await checkpoint("after_reservation");
      await tx(identity, projectId, "ai.persona.execute", async (t) => {
        const e = await execution(t, admission.executionId);
        mockPermissions((await action(t, e.approval_id)).p);
        await t.authorize("ai.persona_tool.draft");
        if (e.state !== "RESERVED") deny("EXECUTION_ALREADY_DISPATCHED");
        await t.client.query(
          "UPDATE ai_persona_executions SET state='DISPATCHED' WHERE id=$1",
          [e.id],
        );
      });
      await checkpoint("after_dispatch");
      await tx(identity, projectId, "ai.persona_tool.draft", async (t) => {
        const e = await execution(t, admission.executionId);
        const { row: a, p } = await action(t, e.approval_id);
        mockPermissions(p);
        await t.authorize("ai.persona_context.read");
        if (e.state !== "DISPATCHED") deny("EXECUTION_ALREADY_DISPATCHED");
        // The sole provider is this deterministic SQL-backed mock. No network I/O.
        await t.authorize("ai.persona_tool.draft");
        await t.client.query(
          `INSERT INTO ai_persona_mock_receipts(execution_id,tenant_id,organization_id,project_id,digest,output,actual_micros)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            e.id,
            t.context.tenantId,
            t.context.organizationId,
            projectId,
            a.digest,
            `MOCK DRAFT: ${a.intent.content}`,
            Math.min(20, Number(e.reserved_micros)),
          ],
        );
      });
      await checkpoint("after_provider");
      return tx(identity, projectId, "ai.persona.execute", (t) =>
        settle(t, admission.executionId),
      );
    },
    reconcile(
      identity: PersonaMockIdentity,
      projectId: string,
      executionId: string,
    ) {
      return tx(identity, projectId, "ai.persona.reconcile", async (t) => {
        const state = await t.authorize("ai.persona.reconcile");
        if (state.principal.principalType !== "HUMAN") deny("HUMAN_REQUIRED");
        return settle(t, executionId);
      });
    },
  };
}
