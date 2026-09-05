import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, logAudit } from "../lib/auth";
import {
  nextSocialId,
  socialHash,
  socialOperationsConfiguration,
  withSocialOperationsContext,
} from "../lib/socialOperationsStore";

const router: IRouter = Router();
const uuidSchema = z.string().uuid();
const requestKeySchema = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);
const channelSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "x",
  "blog",
]);
const contentKindSchema = z.enum([
  "POST",
  "STORY",
  "REEL",
  "VIDEO",
  "ARTICLE",
  "AD_CREATIVE",
]);
const briefBodySchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(2000),
    audience: z.string().trim().min(1).max(1000),
    contentKind: contentKindSchema,
    locales: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
      )
      .min(1)
      .max(20),
    channels: z.array(channelSchema).min(1).max(20),
    campaignKey: z
      .string()
      .trim()
      .max(96)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    caption: z.string().max(10_000).optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    utm: z
      .object({
        source: z.string().trim().max(128).optional(),
        medium: z.string().trim().max(128).optional(),
        campaign: z.string().trim().max(128).optional(),
        term: z.string().trim().max(128).optional(),
        content: z.string().trim().max(128).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const reviewBodySchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(2000).optional(),
    requestKey: requestKeySchema,
  })
  .strict();
const accountBodySchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z][a-z0-9._-]+$/),
    accountKey: z
      .string()
      .trim()
      .min(2)
      .max(96)
      .regex(/^[a-z][a-z0-9._:-]+$/),
    displayName: z.string().trim().min(1).max(160),
    integrationKey: z
      .string()
      .trim()
      .max(96)
      .regex(/^[a-z][a-z0-9._:-]+$/)
      .optional(),
    externalAccountRef: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

function failureStatus(error: unknown): number {
  const code =
    error instanceof Error ? error.message : "SOCIAL_OPERATIONS_FAILED";
  if (
    code.includes("DISABLED") ||
    code.includes("CONFIGURATION") ||
    code.includes("SCOPE_UNAVAILABLE")
  )
    return 503;
  if (code.includes("READ_ONLY")) return 403;
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("CONFLICT") || code.includes("MAKER_CHECKER")) return 409;
  return 500;
}

function sendFailure(res: Response, error: unknown): void {
  const code =
    error instanceof Error ? error.message : "SOCIAL_OPERATIONS_FAILED";
  const status = failureStatus(error);
  if (status === 500) console.error("[social-operations]", error);
  res.status(status).json({ error: code, code });
}

router.get(
  "/social/context",
  requireAuth,
  requirePermission("social.view"),
  async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const config = socialOperationsConfiguration();
    if (!config.enabled) {
      res.json({ ...config, publishingEnabled: false });
      return;
    }
    try {
      const context = await withSocialOperationsContext(
        req.user!.id,
        "read",
        async (_client, value) => value,
      );
      res.json({
        enabled: true,
        mode: context.mode,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        publishingEnabled: false,
      });
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.get(
  "/social/overview",
  requireAuth,
  requirePermission("social.view"),
  async (req, res) => {
    try {
      const result = await withSocialOperationsContext(
        req.user!.id,
        "read",
        async (client, context) => {
          const [briefs, accounts, intents, recent] = await Promise.all([
            client.query(
              `SELECT status, count(*)::int AS count FROM social_content_briefs WHERE tenant_id=$1 AND organization_id=$2 GROUP BY status`,
              [context.tenantId, context.organizationId],
            ),
            client.query(
              `SELECT status, count(*)::int AS count FROM social_accounts WHERE tenant_id=$1 AND organization_id=$2 GROUP BY status`,
              [context.tenantId, context.organizationId],
            ),
            client.query(
              `SELECT status, count(*)::int AS count FROM social_publication_intents WHERE tenant_id=$1 AND organization_id=$2 GROUP BY status`,
              [context.tenantId, context.organizationId],
            ),
            client.query(
              `SELECT id,title,content_kind,channels,locales,status,scheduled_for,created_by_legacy_user_id,reviewed_by_legacy_user_id,created_at,updated_at FROM social_content_briefs WHERE tenant_id=$1 AND organization_id=$2 ORDER BY scheduled_for ASC NULLS LAST, created_at DESC LIMIT 100`,
              [context.tenantId, context.organizationId],
            ),
          ]);
          return {
            briefCounts: briefs.rows,
            accountCounts: accounts.rows,
            publicationCounts: intents.rows,
            briefs: recent.rows,
            publishingEnabled: false,
          };
        },
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.json(result);
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.get(
  "/social/accounts",
  requireAuth,
  requirePermission("social.view"),
  async (req, res) => {
    try {
      const rows = await withSocialOperationsContext(
        req.user!.id,
        "read",
        async (client, context) =>
          (
            await client.query(
              `
      SELECT id,provider,account_key,display_name,integration_key,status,created_at,updated_at
      FROM social_accounts WHERE tenant_id=$1 AND organization_id=$2 ORDER BY provider,display_name
    `,
              [context.tenantId, context.organizationId],
            )
          ).rows,
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ data: rows });
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post(
  "/social/accounts",
  requireAuth,
  requirePermission("social.manage"),
  async (req, res) => {
    const parsed = accountBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "SOCIAL_ACCOUNT_INVALID",
        issues: parsed.error.flatten(),
      });
      return;
    }
    try {
      const id = nextSocialId();
      const row = await withSocialOperationsContext(
        req.user!.id,
        "manage",
        async (client, context) =>
          (
            await client.query(
              `
      INSERT INTO social_accounts (id,tenant_id,organization_id,provider,account_key,display_name,integration_key,external_account_ref_hash,status,created_by_legacy_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CONNECTED_UNVERIFIED',$9)
      RETURNING id,provider,account_key,display_name,integration_key,status,created_at,updated_at
    `,
              [
                id,
                context.tenantId,
                context.organizationId,
                parsed.data.provider,
                parsed.data.accountKey,
                parsed.data.displayName,
                parsed.data.integrationKey ?? null,
                parsed.data.externalAccountRef
                  ? socialHash(parsed.data.externalAccountRef)
                  : null,
                context.legacyUserId,
              ],
            )
          ).rows[0],
      );
      await logAudit(
        req.user!.id,
        "create_social_account_registry",
        "social_account",
        undefined,
        { socialAccountId: id, provider: parsed.data.provider },
        req.ip,
      );
      res.status(201).json(row);
    } catch (error: any) {
      if (error?.code === "23505") {
        res.status(409).json({ error: "SOCIAL_ACCOUNT_CONFLICT" });
        return;
      }
      sendFailure(res, error);
    }
  },
);

router.post(
  "/social/briefs",
  requireAuth,
  requirePermission("social.manage"),
  async (req, res) => {
    const parsed = briefBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "SOCIAL_BRIEF_INVALID",
        issues: parsed.error.flatten(),
      });
      return;
    }
    try {
      const id = nextSocialId();
      const row = await withSocialOperationsContext(
        req.user!.id,
        "manage",
        async (client, context) =>
          (
            await client.query(
              `
      INSERT INTO social_content_briefs (id,tenant_id,organization_id,title,objective,audience,content_kind,locales,channels,campaign_key,caption,utm,scheduled_for,created_by_legacy_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
      RETURNING *
    `,
              [
                id,
                context.tenantId,
                context.organizationId,
                parsed.data.title,
                parsed.data.objective,
                parsed.data.audience,
                parsed.data.contentKind,
                parsed.data.locales,
                parsed.data.channels,
                parsed.data.campaignKey ?? null,
                parsed.data.caption ?? null,
                JSON.stringify(parsed.data.utm ?? {}),
                parsed.data.scheduledFor
                  ? new Date(parsed.data.scheduledFor)
                  : null,
                context.legacyUserId,
              ],
            )
          ).rows[0],
      );
      await logAudit(
        req.user!.id,
        "create_social_content_brief",
        "social_content_brief",
        undefined,
        { socialBriefId: id, channels: parsed.data.channels },
        req.ip,
      );
      res.status(201).json(row);
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post(
  "/social/briefs/:id/submit",
  requireAuth,
  requirePermission("social.manage"),
  async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "SOCIAL_BRIEF_ID_INVALID" });
      return;
    }
    try {
      const row = await withSocialOperationsContext(
        req.user!.id,
        "manage",
        async (client, context) => {
          const result = await client.query(
            `UPDATE social_content_briefs SET status='IN_REVIEW',updated_at=now() WHERE tenant_id=$1 AND organization_id=$2 AND id=$3 AND status='DRAFT' RETURNING *`,
            [context.tenantId, context.organizationId, id.data],
          );
          if (result.rowCount !== 1)
            throw new Error("SOCIAL_BRIEF_NOT_FOUND_OR_CONFLICT");
          return result.rows[0];
        },
      );
      await logAudit(
        req.user!.id,
        "submit_social_content_brief",
        "social_content_brief",
        undefined,
        { socialBriefId: id.data },
        req.ip,
      );
      res.json(row);
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post(
  "/social/briefs/:id/review",
  requireAuth,
  requirePermission("social.approve"),
  async (req, res) => {
    const id = uuidSchema.safeParse(req.params.id);
    const body = reviewBodySchema.safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: "SOCIAL_REVIEW_INVALID" });
      return;
    }
    try {
      const result = await withSocialOperationsContext(
        req.user!.id,
        "manage",
        async (client, context) => {
          const brief = await client.query<{
            version: string;
            status: string;
            created_by_legacy_user_id: number;
          }>(
            `SELECT version,status,created_by_legacy_user_id FROM social_content_briefs WHERE tenant_id=$1 AND organization_id=$2 AND id=$3 FOR UPDATE`,
            [context.tenantId, context.organizationId, id.data],
          );
          if (brief.rowCount !== 1) throw new Error("SOCIAL_BRIEF_NOT_FOUND");
          const current = brief.rows[0];
          const evidence = socialHash({
            briefId: id.data,
            briefVersion: current.version,
            reviewerId: context.legacyUserId,
            ...body.data,
          });
          const replay = await client.query<{
            evidence_sha256: string;
            decision: string;
          }>(
            `SELECT evidence_sha256,decision FROM social_content_reviews WHERE tenant_id=$1 AND request_key=$2`,
            [context.tenantId, body.data.requestKey],
          );
          if (replay.rowCount === 1) {
            if (replay.rows[0].evidence_sha256 !== evidence)
              throw new Error("SOCIAL_REVIEW_IDEMPOTENCY_CONFLICT");
            return { replay: true, decision: replay.rows[0].decision };
          }
          if (current.status !== "IN_REVIEW")
            throw new Error("SOCIAL_REVIEW_STATE_CONFLICT");
          if (current.created_by_legacy_user_id === context.legacyUserId)
            throw new Error("SOCIAL_REVIEW_MAKER_CHECKER_REQUIRED");
          await client.query(
            `INSERT INTO social_content_reviews (id,tenant_id,organization_id,brief_id,brief_version,reviewer_legacy_user_id,decision,reason,request_key,evidence_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              nextSocialId(),
              context.tenantId,
              context.organizationId,
              id.data,
              current.version,
              context.legacyUserId,
              body.data.decision,
              body.data.reason ?? null,
              body.data.requestKey,
              evidence,
            ],
          );
          await client.query(
            `UPDATE social_content_briefs SET status=$4,reviewed_by_legacy_user_id=$5,reviewed_at=now(),updated_at=now() WHERE tenant_id=$1 AND organization_id=$2 AND id=$3`,
            [
              context.tenantId,
              context.organizationId,
              id.data,
              body.data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
              context.legacyUserId,
            ],
          );
          return { replay: false, decision: body.data.decision };
        },
      );
      await logAudit(
        req.user!.id,
        "review_social_content_brief",
        "social_content_brief",
        undefined,
        { socialBriefId: id.data, ...result },
        req.ip,
      );
      res.json(result);
    } catch (error: any) {
      if (error?.code === "23505") {
        res.status(409).json({ error: "SOCIAL_REVIEW_CONFLICT" });
        return;
      }
      sendFailure(res, error);
    }
  },
);

export default router;
