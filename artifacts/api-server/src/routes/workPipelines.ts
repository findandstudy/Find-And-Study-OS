import { Router, type IRouter } from "express";
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
    res
      .status(status)
      .json({
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
        return {
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
        // Access is evaluated before pagination; unauthorized boards never consume a page.
        const r = await c.query(
          "SELECT document,revision FROM local_work_pipelines.boards WHERE tenant_id=$1 AND ($2::boolean OR document->>'createdBy'=$3 OR document->'memberIds' @> $4::jsonb) ORDER BY document->>'createdAt',id LIMIT 51 OFFSET $5",
          [
            t,
            isWorkAdmin(req.user),
            String(req.user.id),
            JSON.stringify([req.user.id]),
            offset,
          ],
        );
        return {
          items: r.rows.slice(0, 50),
          nextOffset: r.rows.length > 50 ? offset + 50 : null,
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
router.post(
  "/work-pipelines",
  wrap(async (req: any, res: any) => {
    if (!isWorkAdmin(req.user))
      throw new WorkError(403, "Only admins create pipelines");
    const input = workBoardInput.parse(req.body.data);
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
        await validateWorkMembers(c, input.memberIds);
        for (const s of input.sources) await sourceExists(c, s);
        const invalid = await c.query(
          "SELECT id FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND NOT(document->>'stageId'=ANY($3::text[])) LIMIT 1",
          [t, req.params.id, input.stages.map((s) => s.id)],
        );
        if (invalid.rowCount)
          throw new WorkError(409, "Move cards before removing their stage");
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
          "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND ($3='' OR document->>'title' ILIKE $4 OR document->>'contactName' ILIKE $4) ORDER BY document->>'createdAt' DESC,id LIMIT 201 OFFSET $5",
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
    const input = workCardInput.parse(req.body.data);
    const note = z
      .string()
      .trim()
      .max(5000)
      .parse(req.body.note || "");
    WP_UUID.parse(req.params.cardId);
    res.json(
      await workTx(async (c, t) => {
        const { document: b } = await readWorkBoard(
          c,
          t,
          req.params.id,
          req.user,
          true,
        );
        if (b.archived) throw new WorkError(409, "Pipeline is archived");
        const r = await c.query(
          "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE",
          [t, b.id, req.params.cardId],
        );
        if (!r.rowCount) throw new WorkError(404, "Card not found");
        assertWorkRevision(r.rows[0].revision, req.body.revision);
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
        const old: WorkCard = r.rows[0].document;
        const changed = Object.keys(input).filter(
          (k) =>
            JSON.stringify((input as any)[k]) !==
            JSON.stringify((old as any)[k]),
        );
        const history = changed.length
          ? [
              ...old.history,
              event(
                req.user.id,
                "updated",
                changed
                  .map((k) =>
                    k === "stageId"
                      ? `${b.stages.find((s) => s.id === old.stageId)?.name} → ${b.stages.find((s) => s.id === input.stageId)?.name}`
                      : k,
                  )
                  .join(", "),
              ),
            ]
          : old.history;
        const card = {
          ...old,
          ...input,
          updatedAt: new Date().toISOString(),
          notes: note
            ? [...old.notes, event(req.user.id, "note", note)]
            : old.notes,
          history: note
            ? [...history, event(req.user.id, "note-added", "")]
            : history,
        };
        await c.query(
          "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
          [t, b.id, old.id, card],
        );
        return { document: card, revision: r.rows[0].revision + 1 };
      }),
    );
  }),
);
export default router;
