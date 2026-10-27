import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { assertPersonaRuntime, type PersonaRuntimeBoundary } from "./personaRuntimeBoundary";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^[1-9][0-9]{0,18}$/);
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const scopeSchema = z.object({
  tenantId: uuid, organizationId: uuid, projectId: uuid, principalId: uuid,
}).strict();
export type PersonaSocialLinkScope = z.infer<typeof scopeSchema>;
export type PersonaSocialUserAuthority = PersonaSocialLinkScope & {
  legacyUserId: number;
  permission: "social.view";
};
export type PersonaSocialLinkAccess = {
  /** These callbacks must resolve CURRENT authority in the caller's locked
   * canonical session/transaction. A role/body field is not an adapter. */
  authorizeProject: (capability: "ai.persona.read" | "ai.persona_task.manage") => Promise<{ authorized: true }>;
  assertSocialPermission: (
    permission: "social.view",
    expected: Readonly<PersonaSocialLinkScope>,
  ) => Promise<PersonaSocialUserAuthority>;
};
const authoritySchema = scopeSchema.extend({
  legacyUserId: z.number().int().positive().safe(),
  permission: z.literal("social.view"),
}).strict();
const sourceSchema = z.object({
  briefId: uuid,
  sourceVersion: version,
  title: z.string().min(1).max(240),
  objective: z.string().min(1).max(2000),
  audience: z.string().min(1).max(1000),
  contentKind: z.enum(["POST", "STORY", "REEL", "VIDEO", "ARTICLE", "AD_CREATIVE"]),
  locales: z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)).min(1).max(20),
  channels: z.array(z.enum(["instagram", "facebook", "linkedin", "youtube", "tiktok", "x", "blog"])).min(1).max(20),
  caption: z.string().max(10000).nullable(),
  scheduledFor: z.string().datetime({ offset: true }).nullable()
    .transform((value) => value === null ? null : new Date(value).toISOString()),
  // This first corridor intentionally cannot read any private media object.
  mediaRefs: z.array(z.never()).length(0),
}).strict();
export type PersonaSocialSourceSnapshot = z.infer<typeof sourceSchema>;
const linkInputSchema = z.object({
  workflowId: z.number().int().positive().safe(),
  briefId: uuid,
  sourceVersion: version,
  sourceDigest: hash,
  requestKey,
}).strict();
const deny = (code: string): never => { throw new Error(`PERSONA_SOCIAL_${code}`); };

/** Stable allowlisted projection. No URL/object fetch, account reference, UTM,
 * actor PII, credentials or duplicated content persisted by this module. */
export function personaSocialSourceDigest(input: unknown): string {
  const value = sourceSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 24000) deny("SOURCE_TOO_LARGE");
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const sourceColumns = `brief.id,brief.version,brief.title,brief.objective,brief.audience,
  brief.content_kind,brief.locales,brief.channels,brief.caption,brief.scheduled_for,
  brief.media_refs,brief.status,binding.source_version AS bound_source_version,
  binding.source_digest AS bound_source_digest,binding.synthetic_fixture`;

function sourceProjection(row: Record<string, any>) {
  if (row.synthetic_fixture !== true || row.status !== "DRAFT") deny("SYNTHETIC_SOURCE_REQUIRED");
  const snapshot = sourceSchema.parse({
    briefId: row.id,
    sourceVersion: String(row.version),
    title: row.title,
    objective: row.objective,
    audience: row.audience,
    contentKind: row.content_kind,
    locales: row.locales,
    channels: row.channels,
    caption: row.caption,
    scheduledFor: row.scheduled_for === null ? null : new Date(row.scheduled_for).toISOString(),
    mediaRefs: row.media_refs,
  });
  const digest = personaSocialSourceDigest(snapshot);
  if (String(row.bound_source_version) !== snapshot.sourceVersion || row.bound_source_digest !== digest)
    deny("SOURCE_CHANGED");
  return { ...snapshot, sourceDigest: digest, synthetic: true as const };
}

/** LOCAL / SYNTHETIC ONLY. Caller owns BEGIN/COMMIT/ROLLBACK and must already
 * hold the canonical session and project locks. This adapter creates no grants,
 * ownership, source content, approvals, executions or publication jobs.
 * Prepared migration must be applied only in an explicitly disposable fixture. */
export function createPersonaSocialContentLink(
  client: Pick<PoolClient, "query">,
  inputScope: PersonaSocialLinkScope,
  access: PersonaSocialLinkAccess,
  runtime: PersonaRuntimeBoundary,
) {
  const scope = Object.freeze(scopeSchema.parse(inputScope));
  function assertLocal() {
    assertPersonaRuntime(runtime);
    if (runtime.mode !== "disposable-test") deny("LOCAL_ONLY");
    if (typeof access?.authorizeProject !== "function" || typeof access?.assertSocialPermission !== "function")
      deny("AUTHORIZATION_ADAPTER_REQUIRED");
  }
  assertLocal();
  async function authorize(capability: "ai.persona.read" | "ai.persona_task.manage") {
    assertLocal();
    if ((await access.authorizeProject(capability))?.authorized !== true) deny("PROJECT_AUTHORIZATION_REQUIRED");
    const authority = authoritySchema.parse(await access.assertSocialPermission("social.view", scope));
    if (authority.tenantId !== scope.tenantId || authority.organizationId !== scope.organizationId ||
        authority.projectId !== scope.projectId || authority.principalId !== scope.principalId)
      deny("AUTHORITY_SCOPE_MISMATCH");
    assertLocal();
    return authority;
  }
  const params = [scope.tenantId, scope.organizationId, scope.projectId];
  async function source(briefId: string) {
    uuid.parse(briefId);
    await authorize("ai.persona.read");
    const result = await client.query(
      `SELECT ${sourceColumns} FROM ai_persona_social_sources binding
       JOIN social_content_briefs brief ON brief.tenant_id=binding.tenant_id
        AND brief.organization_id=binding.organization_id AND brief.id=binding.brief_id
       WHERE binding.tenant_id=$1 AND binding.organization_id=$2 AND binding.project_id=$3
        AND binding.brief_id=$4 FOR SHARE OF binding,brief`, [...params, briefId]);
    if (result.rowCount !== 1) deny("SOURCE_OWNERSHIP_REQUIRED");
    return sourceProjection(result.rows[0]);
  }
  async function links(briefId: string) {
    const snapshot = await source(briefId);
    await authorize("ai.persona.read");
    const result = await client.query(
      `SELECT link.workflow_id,link.brief_id,link.source_version,link.source_digest,
              review.result_digest AS reviewed_result_digest
       FROM ai_persona_social_links link
       LEFT JOIN ai_persona_workflow_reviews review ON review.tenant_id=link.tenant_id
        AND review.organization_id=link.organization_id AND review.project_id=link.project_id
        AND review.workflow_id=link.workflow_id
       WHERE link.tenant_id=$1 AND link.organization_id=$2 AND link.project_id=$3
        AND link.brief_id=$4 ORDER BY link.workflow_id DESC LIMIT 50`, [...params, briefId]);
    return result.rows.map((row) => ({
      workflowId: row.workflow_id, briefId: row.brief_id,
      sourceVersion: String(row.source_version), sourceDigest: row.source_digest,
      sourceCurrent: String(row.source_version) === snapshot.sourceVersion && row.source_digest === snapshot.sourceDigest,
      reviewedResultDigest: row.reviewed_result_digest ?? null,
      // A workflow review is NOT social content or publication approval.
      socialApproved: false as const, published: false as const,
    }));
  }
  return {
    source,
    links,
    async workflowSource(workflowId: number) {
      z.number().int().positive().safe().parse(workflowId);
      await authorize("ai.persona.read");
      const result = await client.query(
        `SELECT brief_id FROM ai_persona_social_links
         WHERE tenant_id=$1 AND organization_id=$2 AND project_id=$3 AND workflow_id=$4`,
        [...params, workflowId]);
      if (result.rowCount !== 1) deny("LINK_NOT_FOUND");
      const snapshot = await source(result.rows[0].brief_id);
      return { source: snapshot, links: await links(snapshot.briefId) };
    },
    async linkWorkflow(input: unknown) {
      const value = linkInputSchema.parse(input);
      const actor = await authorize("ai.persona_task.manage");
      const snapshot = await source(value.briefId);
      if (snapshot.sourceVersion !== value.sourceVersion || snapshot.sourceDigest !== value.sourceDigest)
        deny("SOURCE_CHANGED");
      await authorize("ai.persona.read");
      const workflow = await client.query(
        `SELECT action_id FROM ai_persona_workflows
         WHERE tenant_id=$1 AND organization_id=$2 AND project_id=$3 AND action_id=$4 AND state='OPEN'
         FOR SHARE`, [...params, value.workflowId]);
      if (workflow.rowCount !== 1) deny("WORKFLOW_NOT_FOUND");
      await authorize("ai.persona_task.manage");
      // Project mutex is held by the caller. Unique keys also fail closed if a
      // caller violates that contract; there is no blind retry here.
      const replay = await client.query(
        `SELECT workflow_id,brief_id,source_version,source_digest,request_key,actor
         FROM ai_persona_social_links WHERE tenant_id=$1 AND organization_id=$2 AND project_id=$3
          AND (request_key=$4 OR workflow_id=$5) FOR SHARE`,
        [...params, value.requestKey, value.workflowId]);
      if (replay.rowCount) {
        const row = replay.rows[0];
        if (replay.rowCount !== 1 || row.workflow_id !== value.workflowId || row.brief_id !== value.briefId ||
            String(row.source_version) !== value.sourceVersion || row.source_digest !== value.sourceDigest ||
            row.request_key !== value.requestKey || row.actor !== scope.principalId)
          deny("IDEMPOTENCY_CONFLICT");
        return { ...value, replay: true, socialApproved: false, published: false };
      }
      await authorize("ai.persona.read");
      const started = await client.query(
        `SELECT 1 FROM ai_persona_workflow_nodes
         WHERE tenant_id=$1 AND organization_id=$2 AND project_id=$3 AND workflow_id=$4 LIMIT 1`,
        [...params, value.workflowId]);
      if (started.rowCount) deny("WORKFLOW_ALREADY_STARTED");
      const currentActor = await authorize("ai.persona_task.manage");
      if (currentActor.legacyUserId !== actor.legacyUserId) deny("AUTHORITY_SCOPE_MISMATCH");
      await client.query(
        `INSERT INTO ai_persona_social_links
         (tenant_id,organization_id,project_id,workflow_id,brief_id,source_version,source_digest,request_key,actor,actor_legacy_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [...params, value.workflowId, value.briefId, value.sourceVersion, value.sourceDigest,
          value.requestKey, scope.principalId, actor.legacyUserId]);
      return { ...value, replay: false, socialApproved: false, published: false };
    },
  };
}
