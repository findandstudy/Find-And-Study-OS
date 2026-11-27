import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  workTx,
  readWorkBoard,
  assertWorkRevision,
  validateWorkMembers,
  event,
  WorkError,
  WP_UUID,
  type WorkBoard,
  type WorkCard,
  type WorkActor,
} from "./workPipelines";
import { invalidateNotificationCounts } from "./notificationCountCache";

const activityInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("note"),
      text: z.string().trim().min(1).max(5000),
    })
    .strict(),
  z
    .object({
      action: z.literal("followup"),
      id: WP_UUID.optional(),
      title: z.string().trim().min(1).max(200),
      notes: z.string().trim().max(5000).default(""),
      scheduledAt: z.string().datetime({ offset: true }),
      assigneeId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      id: WP_UUID,
      completed: z.boolean(),
    })
    .strict(),
]);

// In-app only: do not use rule-driven email/WhatsApp delivery for this local module.
// Keep notification copy generic: a later membership revocation must not expose
// private card/note content through an old notification.
async function notify(
  c: PoolClient,
  userId: number,
  boardId: string,
  cardId: string,
  type: string,
  followUpId?: string,
) {
  const data = { resourceType: "work_pipeline", boardId, cardId, followUpId };
  const url = `/staff/pipelines?pipeline=${boardId}&card=${cardId}`;
  const title =
    type === "pipeline.note_added"
      ? "Pipeline: Yeni not / New note"
      : type === "pipeline.follow_up_due"
        ? "Pipeline: Takip zamanı / Follow-up due"
        : "Pipeline: Takip planlandı / Follow-up scheduled";
  const r = await c.query(
    "INSERT INTO notifications(user_id,type,title,body,icon,action_url,data,channel) VALUES($1,$2,$3,$4,'CalendarClock',$5,$6,'in_app') RETURNING id",
    [
      userId,
      type,
      title,
      "Pipeline kaydını açın / Open the pipeline record",
      url,
      data,
    ],
  );
  await c.query("SELECT pg_notify('notification_events',$1)", [
    JSON.stringify({
      userId,
      notificationId: r.rows[0].id,
      type,
      title,
      data,
      priority: type.endsWith("due") ? "high" : "normal",
    }),
  ]);
  invalidateNotificationCounts(userId);
}

export async function changeWorkActivity(
  actor: WorkActor,
  boardId: string,
  cardId: string,
  revision: number,
  raw: unknown,
) {
  const input = activityInput.parse(raw);
  WP_UUID.parse(cardId);
  return workTx(async (c, t) => {
    const { document: board } = await readWorkBoard(c, t, boardId, actor, true);
    if (board.archived) throw new WorkError(409, "Pipeline is archived");
    const r = await c.query(
      "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE",
      [t, boardId, cardId],
    );
    if (!r.rowCount) throw new WorkError(404, "Card not found");
    assertWorkRevision(r.rows[0].revision, revision);
    const card: WorkCard = r.rows[0].document;
    card.followUps ??= [];
    if (input.action === "note") {
      if (card.notes.length >= 500)
        throw new WorkError(400, "Note limit reached");
      card.notes.push(event(actor.id, "note", input.text));
      for (const uid of new Set([board.createdBy, ...board.memberIds])) {
        if (uid !== actor.id) {
          const active = await c.query(
            "SELECT id FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL",
            [uid],
          );
          if (active.rowCount)
            await notify(c, uid, boardId, cardId, "pipeline.note_added");
        }
      }
    } else {
      if (input.action === "followup") {
        await validateWorkMembers(c, [input.assigneeId]);
        if (
          input.assigneeId !== board.createdBy &&
          !board.memberIds.includes(input.assigneeId)
        )
          throw new WorkError(400, "Assignee must belong to this pipeline");
        const previous = input.id
          ? card.followUps.find((f) => f.id === input.id)
          : undefined;
        if (input.id && !previous)
          throw new WorkError(404, "Follow-up not found");
        if (!previous && card.followUps.length >= 100)
          throw new WorkError(400, "Follow-up limit reached");
        const next = {
          id: input.id ?? randomUUID(),
          title: input.title,
          notes: input.notes,
          scheduledAt: new Date(input.scheduledAt).toISOString(),
          assigneeId: input.assigneeId,
          completed: false,
          createdBy: previous?.createdBy ?? actor.id,
          remindedAt: null,
        };
        if (previous)
          card.followUps = card.followUps.map((f) =>
            f.id === previous.id ? next : f,
          );
        else card.followUps.push(next);
        await clearFollowUpNotifications(c, next.id);
        await notify(
          c,
          next.assigneeId,
          boardId,
          cardId,
          "pipeline.follow_up_scheduled",
          next.id,
        );
      } else {
        const followUp = card.followUps.find((f) => f.id === input.id);
        if (!followUp) throw new WorkError(404, "Follow-up not found");
        followUp.completed = input.completed;
        if (!input.completed) followUp.remindedAt = null;
        await clearFollowUpNotifications(c, followUp.id);
      }
    }
    card.updatedAt = new Date().toISOString();
    card.history.push(
      event(
        actor.id,
        input.action === "note" ? "note-added" : "followup-updated",
        "",
      ),
    );
    await c.query(
      "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
      [t, boardId, cardId, card],
    );
    return { document: card, revision: r.rows[0].revision + 1 };
  });
}

async function clearFollowUpNotifications(c: PoolClient, id: string) {
  const r = await c.query(
    "UPDATE notifications SET is_read=true,read_at=now() WHERE data->>'resourceType'='work_pipeline' AND data->>'followUpId'=$1 AND is_read=false RETURNING user_id",
    [id],
  );
  for (const row of r.rows) invalidateNotificationCounts(row.user_id);
}

export async function workActivityDashboard(actor: WorkActor) {
  return workTx(async (c, t) => {
    // Authorization before expansion/limit: never return another board's notes.
    const allowed =
      "b.tenant_id=$1 AND coalesce((b.document->>'archived')::boolean,false)=false AND ($2::boolean OR b.document->>'createdBy'=$3 OR b.document->'memberIds' @> $4::jsonb)";
    const args = [
      t,
      ["super_admin", "admin"].includes(actor.role),
      String(actor.id),
      JSON.stringify([actor.id]),
    ];
    const followUps = await c.query(
      `SELECT f AS item,b.id AS "boardId",b.document->>'name' AS "boardName",k.id AS "cardId",k.document->>'title' AS "cardTitle" FROM local_work_pipelines.boards b JOIN local_work_pipelines.cards k ON k.tenant_id=b.tenant_id AND k.board_id=b.id CROSS JOIN LATERAL jsonb_array_elements(coalesce(k.document->'followUps','[]')) f WHERE ${allowed} AND f->>'completed'='false' AND (f->>'assigneeId'=$3 OR f->>'createdBy'=$3) AND (f->>'scheduledAt')::timestamptz <= now()+interval '7 days' ORDER BY (f->>'scheduledAt')::timestamptz LIMIT 50`,
      args,
    );
    const notes = await c.query(
      `SELECT n AS item,b.id AS "boardId",b.document->>'name' AS "boardName",k.id AS "cardId",k.document->>'title' AS "cardTitle" FROM local_work_pipelines.boards b JOIN local_work_pipelines.cards k ON k.tenant_id=b.tenant_id AND k.board_id=b.id CROSS JOIN LATERAL jsonb_array_elements(coalesce(k.document->'notes','[]')) n WHERE ${allowed} ORDER BY n->>'at' DESC LIMIT 8`,
      args,
    );
    return { followUps: followUps.rows, notes: notes.rows };
  });
}

/** Persisted reminder marker + notification in one locked transaction. Safe on
 * overlapping ticks/restart; catch up overdue reminders once. */
export async function runWorkReminders(now = new Date(), onlyBoardId?: string) {
  if (onlyBoardId) WP_UUID.parse(onlyBoardId);
  return workTx(async (c, t) => {
    // Lock boards before cards, the same order as edits and membership changes.
    // This also stops revoked/archived sources from occupying the reminder batch.
    const boards = await c.query(
      "SELECT b.id,b.document FROM local_work_pipelines.boards b WHERE b.tenant_id=$1 AND ($3::uuid IS NULL OR b.id=$3::uuid) AND coalesce((b.document->>'archived')::boolean,false)=false AND EXISTS(SELECT 1 FROM local_work_pipelines.cards k CROSS JOIN LATERAL jsonb_array_elements(coalesce(k.document->'followUps','[]')) f JOIN users u ON u.id=(f->>'assigneeId')::int AND u.is_active=true AND u.deleted_at IS NULL WHERE k.tenant_id=b.tenant_id AND k.board_id=b.id AND f->>'completed'='false' AND f->>'remindedAt' IS NULL AND (f->>'scheduledAt')::timestamptz <= $2::timestamptz AND (b.document->>'createdBy'=f->>'assigneeId' OR b.document->'memberIds' @> jsonb_build_array((f->>'assigneeId')::int))) ORDER BY b.id LIMIT 50 FOR UPDATE OF b SKIP LOCKED",
      [t, now.toISOString(), onlyBoardId ?? null],
    );
    let sent = 0,
      remaining = 100;
    for (const br of boards.rows) {
      if (!remaining) break;
      const board: WorkBoard = br.document;
      const r = await c.query(
        "SELECT id,document FROM local_work_pipelines.cards k WHERE tenant_id=$1 AND board_id=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(k.document->'followUps','[]')) f WHERE f->>'completed'='false' AND f->>'remindedAt' IS NULL AND (f->>'scheduledAt')::timestamptz <= $3::timestamptz) ORDER BY id LIMIT $4 FOR UPDATE SKIP LOCKED",
        [t, board.id, now.toISOString(), remaining],
      );
      remaining -= r.rowCount ?? 0;
      for (const row of r.rows) {
        const card: WorkCard = row.document;
        let changed = false;
        for (const f of card.followUps ?? []) {
          if (
            f.completed ||
            f.remindedAt ||
            Date.parse(f.scheduledAt) > now.getTime()
          )
            continue;
          if (
            f.assigneeId !== board.createdBy &&
            !board.memberIds.includes(f.assigneeId)
          )
            continue;
          const active = await c.query(
            "SELECT id FROM users WHERE id=$1 AND is_active=true AND deleted_at IS NULL",
            [f.assigneeId],
          );
          if (!active.rowCount) continue;
          await notify(
            c,
            f.assigneeId,
            board.id,
            card.id,
            "pipeline.follow_up_due",
            f.id,
          );
          f.remindedAt = now.toISOString();
          sent++;
          changed = true;
        }
        if (changed)
          await c.query(
            "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
            [t, board.id, row.id, card],
          );
      }
    }
    return sent;
  });
}
