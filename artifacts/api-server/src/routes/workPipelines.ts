import {emailAutomationHumanAllowed} from "../lib/notifications/emailAutomationPolicy";
import {configurePipelineNotice} from "../lib/notifications/pipelineNoticeConfiguration";
import { bulkUpdateWorkCards, workConversationState, updateWorkCard } from "../lib/workPipelineInbox";
import { readPipelineNoticeHistory } from "../lib/notifications/pipelineNoticeHistory";
import {
  changeWorkActivity,
  workActivityDashboard,
} from "../lib/workPipelineActivity";
import { Router, type IRouter } from "express";
import {
  exportWorkRecords,
  importWorkRecords,
} from "../lib/workPipelineTransfer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import { resolveAgentFeatures } from "../lib/agentFeatures";
import {
  workPipelineTenant,
  workTx,
  WorkError,
  workBoardInput,
  workCardInput,
  readWorkBoard,
  isWorkAdmin,
  canUseWorkBoard,
  validateWorkMembers,
  assertWorkRevision,
  event,
  WP_UUID,
  type WorkBoard,
  type WorkCard,
} from "../lib/workPipelines";

const router: IRouter = Router();
router.use(
  "/work-pipelines",
  requireAuth,
  requireRole(...STAFF_ROLES),
  (req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.apiTokenAuth) {
      res.status(403).json({ error: "Internal session required" });
      return;
    }
    next();
  },
);
const wrap = (fn: any) => async (req: any, res: any) => {
  try {
    await fn(req, res);
  } catch (e: any) {
    const status =
      e instanceof WorkError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : e.code === "23505"
            ? 409
            : 503;
    res.status(status).json({
      error:
        status === 503
          ? "Pipeline service unavailable"
          : e instanceof z.ZodError
            ? e.issues.map((x: any) => x.message).join("; ")
            : e.code === "23505"
              ? "This source is already connected to another pipeline"
              : e.message,
    });
  }
};
router.get(
  "/work-pipelines/feature",
  wrap(async (_req: any, res: any) =>
    res.json({ enabled: Boolean(workPipelineTenant()) }),
  ),
);
router.get(
  "/work-pipelines/options",
  wrap(async (req: any, res: any) =>
    res.json(
      await workTx(async (c) => {
        const people = await c.query(
          "SELECT id,trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) AS name,role FROM users WHERE is_active=true AND role=ANY($1::text[]) ORDER BY first_name,id LIMIT 500",
          [STAFF_ROLES],
        );
        if (!isWorkAdmin(req.user))
          return { people: people.rows, sources: [], canManage: false };
        const channels = await c.query(
          "SELECT id,display_name AS name,channel FROM channel_accounts WHERE is_active=true ORDER BY id LIMIT 500",
        );
        const embeds = await c.query(
          "SELECT id,name,slug FROM embed_widgets WHERE is_active=true AND mode='lead_form' ORDER BY id LIMIT 500",
        );
        const forms = await c.query(
          "SELECT id,company_name,plan_tier,feature_overrides FROM agents WHERE status='active' AND embed_token IS NOT NULL ORDER BY id LIMIT 500",
        );
        const bindings = await c.query(
          "SELECT s.kind,s.source_key,s.board_id,b.document->>'name' AS board_name FROM local_work_pipelines.sources s JOIN local_work_pipelines.boards b ON b.tenant_id=s.tenant_id AND b.id=s.board_id",
        );
        return {
          bindings: bindings.rows,
          people: people.rows,
          canManage: true,
          sources: [
            ...channels.rows.map((r) => ({
              kind: "channel",
              key: String(r.id),
              label: `${r.name} (${r.channel})`,
            })),
            ...embeds.rows.map((r) => ({
              kind: "embed",
              key: String(r.id),
              label: `${r.name} / ${r.slug}`,
            })),
            ...forms.rows
              .filter(
                (r) =>
                  resolveAgentFeatures(r.plan_tier, r.feature_overrides)
                    .web_to_lead,
              )
              .map((r) => ({
                kind: "web",
                key: String(r.id),
                label: `Web-to-lead: ${r.company_name || r.id}`,
              })),
          ],
        };
      }),
    ),
  ),
);
router.get(
  "/work-pipelines",
  wrap(async (req: any, res: any) =>
    res.json(
      await workTx(async (c, t) => {
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .parse(req.query.offset || 0);
        const q = z
          .string()
          .trim()
          .max(120)
          .parse(req.query.q || "");
        const ids =
          req.query.ids === undefined
            ? null
            : z
                .array(WP_UUID)
                .max(100)
                .parse(String(req.query.ids).split(",").filter(Boolean));
        const pageSize = ids ? 100 : 50;
        // Access is evaluated before search/ID filtering and pagination.
        const r = await c.query(
          `SELECT document,revision FROM local_work_pipelines.boards
           WHERE tenant_id=$1
             AND ($2::boolean OR document->>'createdBy'=$3 OR document->'memberIds' @> $4::jsonb)
             AND ($6='' OR document->>'name' ILIKE $7)
             AND ($8::uuid[] IS NULL OR id=ANY($8::uuid[]))
           ORDER BY (document->>'archived' IS NOT DISTINCT FROM 'true'), document->>'createdAt', id
           LIMIT $9 OFFSET $5`,
          [
            t,
            isWorkAdmin(req.user),
            String(req.user.id),
            JSON.stringify([req.user.id]),
            offset,
            q,
            `%${q}%`,
            ids,
            pageSize + 1,
          ],
        );
        return {
          items: r.rows.slice(0, pageSize),
          nextOffset: r.rows.length > pageSize ? offset + pageSize : null,
        };
      }),
    ),
  ),
);
async function sourceExists(c: any, s: { kind: string; key: string }) {
  if (!/^\d+$/.test(s.key)) throw new WorkError(400, "Invalid source");
  const r = await c.query(
    s.kind === "channel"
      ? "SELECT id FROM channel_accounts WHERE id=$1 AND is_active=true"
      : s.kind === "web"
        ? "SELECT id FROM agents WHERE id=$1 AND status='active' AND embed_token IS NOT NULL"
        : "SELECT id FROM embed_widgets WHERE id=$1 AND mode='lead_form' AND is_active=true",
    [Number(s.key)],
  );
  if (!r.rowCount)
    throw new WorkError(
      400,
      "Source is not an active message account or lead form",
    );
}
router.get("/work-pipelines/:id/cards/:cardId/delivery-history", wrap(async (req: any, res: any) => {
  const cardId = WP_UUID.parse(req.params.cardId);
  const items = await workTx(async (client, tenantId) => {
    const board = await readWorkBoard(client, tenantId, req.params.id, req.user);
    const { rowCount } = await client.query(
      "SELECT 1 FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=$3 AND document->>'removedAt' IS NULL",
      [tenantId, board.document.id, cardId],
    );
    if (!rowCount) throw new WorkError(404, "Record not found");
    return readPipelineNoticeHistory(client, "work", { tenantId, boardId: board.document.id, cardId });
  });
  res.set("Cache-Control", "private, no-store");
  res.json({ items });
}));

router.post(
  "/work-pipelines",
  wrap(async (req: any, res: any) => {
    if (!isWorkAdmin(req.user))
      throw new WorkError(403, "Only admins create pipelines");
    const input = workBoardInput.parse(req.body.data);
    for(const stage of input.stages)for(const channel of ['email','whatsapp'] as const){const key=channel==='email'?'automaticEmail':'automaticMessage';try{stage[key]=await configurePipelineNotice(req,'work',channel,stage[key],null);}catch{throw new WorkError(400,'Invalid stage notification configuration');}}
    const result = await workTx(async (c, t) => {
      await validateWorkMembers(c, input.memberIds);
      for (const s of input.sources) await sourceExists(c, s);
      const b: WorkBoard = {
        ...input,
        id: randomUUID(),
        createdBy: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [event(req.user.id, "created", input.name)],
      };
      await c.query(
        "INSERT INTO local_work_pipelines.boards(tenant_id,id,document) VALUES($1,$2,$3)",
        [t, b.id, b],
      );
      for (const s of b.sources)
        await c.query(
          "INSERT INTO local_work_pipelines.sources VALUES($1,$2,$3,$4)",
          [t, s.kind, s.key, b.id],
        );
      return { document: b, revision: 1 };
    });
    res.status(201).json(result);
  }),
);
router.put(
  "/work-pipelines/:id",
  wrap(async (req: any, res: any) => {
    if (!isWorkAdmin(req.user))
      throw new WorkError(403, "Only admins manage pipelines");
    const input = workBoardInput.parse(req.body.data);
    res.json(
      await workTx(async (c, t) => {
        const old = await readWorkBoard(c, t, req.params.id, req.user, true);
        assertWorkRevision(old.revision, req.body.revision);
        for(const stage of input.stages)for(const channel of ['email','whatsapp'] as const){const key=channel==='email'?'automaticEmail':'automaticMessage';try{const previous=old.document.stages.find(x=>x.id===stage.id)?.[key];stage[key]=await configurePipelineNotice(req,'work',channel,stage[key]===undefined?previous:stage[key],previous);}catch{throw new WorkError(400,'Invalid stage notification configuration');}}
        if(old.document.stages.some(s=>!input.stages.some(x=>x.id===s.id)&&(s.automaticEmail?.enabled||s.automaticMessage?.enabled))&&!await emailAutomationHumanAllowed(req))throw new WorkError(403,'Human administrator required');
        await validateWorkMembers(c, input.memberIds);
        for (const s of input.sources) await sourceExists(c, s);
        const invalid = await c.query(
          "SELECT id FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND document->>'removedAt' IS NULL AND NOT(document->>'stageId'=ANY($3::text[])) LIMIT 1",
          [t, req.params.id, input.stages.map((s) => s.id)],
        );
        if (invalid.rowCount)
          throw new WorkError(409, "Move cards before removing their stage");
        const allowed = [old.document.createdBy, ...input.memberIds];
        const stranded = await c.query(
          "SELECT id FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND document->>'removedAt' IS NULL AND ((document->>'assigneeId' IS NOT NULL AND NOT ((document->>'assigneeId')::int=ANY($3::int[]))) OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(document->'followUps','[]'::jsonb)) f WHERE f->>'completed'='false' AND NOT ((f->>'assigneeId')::int=ANY($3::int[])))) LIMIT 1",
          [t, req.params.id, allowed],
        );
        if (stranded.rowCount) throw new WorkError(409, "Reassign records and open follow-ups before removing a team member");
        const b = {
          ...old.document,
          ...input,
          updatedAt: new Date().toISOString(),
          history: [
            ...old.document.history,
            event(req.user.id, "settings", input.name),
          ],
        };
        await c.query(
          "UPDATE local_work_pipelines.boards SET document=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
          [t, b.id, b],
        );
        await c.query(
          "DELETE FROM local_work_pipelines.sources WHERE tenant_id=$1 AND board_id=$2",
          [t, b.id],
        );
        if (!b.archived)
          for (const s of b.sources)
            await c.query(
              "INSERT INTO local_work_pipelines.sources VALUES($1,$2,$3,$4)",
              [t, s.kind, s.key, b.id],
            );
        return { document: b, revision: old.revision + 1 };
      }),
    );
  }),
);
router.get(
  "/work-pipelines/:id/cards",
  wrap(async (req: any, res: any) =>
    res.json(
      await workTx(async (c, t) => {
        const board = await readWorkBoard(c, t, req.params.id, req.user);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .parse(req.query.offset || 0);
        const q = z
          .string()
          .max(200)
          .parse(req.query.q || "");
        const r = await c.query(
          "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND document->>'removedAt' IS NULL AND ($3='' OR document->>'title' ILIKE $4 OR document->>'contactName' ILIKE $4) ORDER BY document->>'createdAt' DESC,id LIMIT 201 OFFSET $5",
          [t, req.params.id, q, `%${q}%`, offset],
        );
        return {
          board,
          items: r.rows.slice(0, 200),
          nextOffset: r.rows.length > 200 ? offset + 200 : null,
        };
      }),
    ),
  ),
);
router.post(
  "/work-pipelines/:id/cards",
  wrap(async (req: any, res: any) => {
    const input = workCardInput.parse(req.body.data);
    res.status(201).json(
      await workTx(async (c, t) => {
        const { document: b } = await readWorkBoard(
          c,
          t,
          req.params.id,
          req.user,
          true,
        );
        if (b.archived) throw new WorkError(409, "Pipeline is archived");
        if (!b.stages.some((s) => s.id === input.stageId))
          throw new WorkError(400, "Invalid stage");
        if (input.assigneeId !== null) {
          await validateWorkMembers(c, [input.assigneeId]);
          if (
            input.assigneeId !== b.createdBy &&
            !b.memberIds.includes(input.assigneeId)
          )
            throw new WorkError(400, "Assignee must belong to this pipeline");
        }
        const card: WorkCard = {
          ...input,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          notes: [],
          history: [event(req.user.id, "created", input.title)],
        };
        await c.query(
          "INSERT INTO local_work_pipelines.cards(tenant_id,board_id,id,document) VALUES($1,$2,$3,$4)",
          [t, b.id, card.id, card],
        );
        return { document: card, revision: 1 };
      }),
    );
  }),
);
router.put(
  "/work-pipelines/:id/cards/:cardId",
  wrap(async (req: any, res: any) => {
    WP_UUID.parse(req.params.cardId);
    const note = z.string().trim().max(5000).parse(req.body.note || "");
    res.json(await updateWorkCard(req.user, req.params.id, req.params.cardId,
      req.body.revision, req.body.data, note));
  }),
);
router.post(
  "/work-pipelines/:id/cards/bulk",
  wrap(async (req: any, res: any) => {
    res.json(await bulkUpdateWorkCards(req.user, req.params.id, req.body));
  }),
);
router.get("/work-pipelines/conversation/:conversationId", wrap(async (req: any, res: any) => {
  const id = z.coerce.number().int().positive().parse(req.params.conversationId);
  res.json(await workConversationState(req.user, id));
}));
router.patch("/work-pipelines/:id/cards/:cardId", wrap(async (req: any, res: any) => {
  WP_UUID.parse(req.params.cardId);
  res.json(await updateWorkCard(req.user, req.params.id, req.params.cardId,
    req.body.revision, req.body.patch, "", true));
}));
router.get(
  "/work-pipelines/dashboard",
  wrap(async (req: any, res: any) =>
    res.json(await workActivityDashboard(req.user)),
  ),
);
router.post(
  "/work-pipelines/:id/cards/:cardId/activity",
  wrap(async (req: any, res: any) =>
    res.json(
      await changeWorkActivity(
        req.user,
        req.params.id,
        req.params.cardId,
        req.body.revision,
        req.body.activity,
      ),
    ),
  ),
);
router.get(
  "/work-pipelines/:id/cards/:cardId",
  wrap(async (req: any, res: any) => {
    WP_UUID.parse(req.params.cardId);
    res.json(
      await workTx(async (c, t) => {
        await readWorkBoard(c, t, req.params.id, req.user);
        const r = await c.query(
          "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=$3 AND document->>'removedAt' IS NULL",
          [t, req.params.id, req.params.cardId],
        );
        if (!r.rowCount) throw new WorkError(404, "Card not found");
        return r.rows[0];
      }),
    );
  }),
);
router.get(
  "/work-pipelines/:id/transfer/export",
  wrap(async (req: any, res: any) =>
    res.json(await exportWorkRecords(req.user, req.params.id, req.query)),
  ),
);
router.post(
  "/work-pipelines/:id/transfer/preview",
  wrap(async (req: any, res: any) =>
    res.json(await importWorkRecords(req.user, req.params.id, req.body)),
  ),
);
router.post(
  "/work-pipelines/:id/transfer/import",
  wrap(async (req: any, res: any) =>
    res.json(await importWorkRecords(req.user, req.params.id, req.body, true)),
  ),
);
export default router;
