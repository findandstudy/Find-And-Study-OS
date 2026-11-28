import { z } from "zod";
import {
  workTx,
  workPipelineTenant,
  readWorkBoard,
  canUseWorkBoard,
  assertWorkRevision,
  validateWorkMembers,
  workCardInput,
  isWorkAdmin,
  WP_UUID,
  event,
  WorkError,
  type WorkActor,
  type WorkBoard,
  type WorkCard,
} from "./workPipelines";
import type { PoolClient } from "pg";

const positiveId = z.number().int().positive();
type Link = { board: WorkBoard; document: WorkCard; revision: number };

async function links(
  c: PoolClient,
  t: string,
  conversationId: number,
): Promise<Link[]> {
  const r = await c.query(
    `SELECT b.document AS board,k.document,k.revision
     FROM local_work_pipelines.cards k JOIN local_work_pipelines.boards b
       ON b.tenant_id=k.tenant_id AND b.id=k.board_id
     WHERE k.tenant_id=$1 AND k.document->'source'->>'conversationId'=$2
       AND k.document->>'removedAt' IS NULL AND b.document->>'archived'='false' ORDER BY b.id,k.id`,
    [t, String(positiveId.parse(conversationId))],
  );
  return r.rows;
}

export async function workConversationState(
  actor: WorkActor,
  conversationId: number,
) {
  if (!workPipelineTenant()) return { linked: false, items: [] };
  return workTx(async (c, t) => {
    const rows = await links(c, t, conversationId);
    if (rows.some((r) => !canUseWorkBoard(actor, r.board)))
      throw new WorkError(403, "You do not have access to this pipeline");
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.board.createdBy, ...r.board.memberIds]),
      ),
    ];
    const people = ids.length
      ? (
          await c.query(
            "SELECT id,trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) AS name FROM users WHERE id=ANY($1::int[]) AND is_active=true",
            [ids],
          )
        ).rows
      : [];
    return {
      linked: rows.length > 0,
      items: rows.map((r) => ({
        boardId: r.board.id,
        boardName: r.board.name,
        stages: r.board.stages,
        card: {
          id: r.document.id,
          title: r.document.title,
          contactName: r.document.contactName,
          email: r.document.email,
          phone: r.document.phone,
          stageId: r.document.stageId,
          assigneeId: r.document.assigneeId,
        },
        revision: r.revision,
        people: people.filter(
          (p) => p.id === r.board.createdBy || r.board.memberIds.includes(p.id),
        ),
      })),
    };
  });
}

/** No CRM writes. Commit-bound event contains only the existing conversation ID. */
async function syncConversation(
  c: PoolClient,
  t: string,
  card: WorkCard,
  assignmentChanged: boolean,
) {
  const id = card.source?.conversationId;
  if (!id) return;
  if (assignmentChanged) {
    const all = await links(c, t, id);
    if (
      all.some(
        (r) =>
          r.document.id !== card.id &&
          r.document.assigneeId !== card.assigneeId,
      )
    )
      throw new WorkError(
        409,
        "Conversation belongs to multiple pipelines with different owners",
      );
    // Never propagate a work-pipeline owner into the student CRM chain.
    const updated = await c.query(
      `UPDATE conversations c SET assigned_to_id=$2
       WHERE c.id=$1 AND NOT EXISTS (SELECT 1 FROM external_contacts e
         WHERE e.id=c.external_contact_id AND (e.lead_id IS NOT NULL OR e.student_id IS NOT NULL)) RETURNING c.id`,
      [id, card.assigneeId],
    );
    if (!updated.rowCount)
      throw new WorkError(
        409,
        "Conversation is missing or linked to a CRM record",
      );
  }
  await c.query("SELECT pg_notify('inbox_events',$1)", [
    JSON.stringify({ type: "pipeline", conversationId: id }),
  ]);
}

const workCardPatch = z.object({
  stageId: WP_UUID.optional(),
  assigneeId: positiveId.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

type StoredWorkCard = { document: WorkCard; revision: number };

async function writeWorkCard(
  c: PoolClient,
  t: string,
  b: WorkBoard,
  actor: WorkActor,
  row: StoredWorkCard,
  raw: unknown,
  note: string,
  partial: boolean,
) {
  const old = row.document;
  const patch = partial ? workCardPatch.parse(raw) : null;
  const input = workCardInput.parse(
    partial
      ? {
          ...Object.fromEntries(
            Object.keys(workCardInput.shape).map((k) => [k, (old as any)[k]]),
          ),
          ...patch,
        }
      : raw,
  );
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
  const changed = Object.keys(input).filter(
    (k) =>
      JSON.stringify((input as any)[k]) !== JSON.stringify((old as any)[k]),
  );
  const card: WorkCard = {
    ...old,
    ...input,
    updatedAt: new Date().toISOString(),
    notes: note ? [...old.notes, event(actor.id, "note", note)] : old.notes,
    history: [
      ...old.history,
      ...(changed.length
        ? [
            event(
              actor.id,
              "updated",
              changed
                .map((k) =>
                  k === "stageId"
                    ? `${b.stages.find((s) => s.id === old.stageId)?.name} → ${b.stages.find((s) => s.id === input.stageId)?.name}`
                    : k === "assigneeId"
                      ? `assigneeId: ${old.assigneeId ?? "none"} → ${input.assigneeId ?? "none"}`
                      : k,
                )
                .join(", "),
            ),
          ]
        : []),
      ...(note ? [event(actor.id, "note-added", "")] : []),
    ],
  };
  await c.query(
    "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
    [t, b.id, old.id, card],
  );
  await syncConversation(
    c,
    t,
    card,
    old.assigneeId !== card.assigneeId ||
      Boolean(
        patch && Object.prototype.hasOwnProperty.call(patch, "assigneeId"),
      ),
  );
  return { document: card, revision: row.revision + 1 };
}

export async function updateWorkCard(
  actor: WorkActor,
  boardId: string,
  cardId: string,
  revision: unknown,
  raw: unknown,
  note = "",
  partial = false,
) {
  return workTx(async (c, t) => {
    const { document: board } = await readWorkBoard(c, t, boardId, actor, true);
    if (board.archived) throw new WorkError(409, "Pipeline is archived");
    const { rows } = await c.query<StoredWorkCard>(
      "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=$3 AND document->>'removedAt' IS NULL FOR UPDATE",
      [t, board.id, cardId],
    );
    const row = rows[0];
    if (!row) throw new WorkError(404, "Card not found");
    assertWorkRevision(row.revision, revision);
    return writeWorkCard(c, t, board, actor, row, raw, note, partial);
  });
}

const bulkWorkCardInput = z.object({
  cards: z.array(z.object({
    id: WP_UUID.transform((id) => id.toLowerCase()),
    revision: z.number().int().positive(),
  }).strict()).min(1).max(200).refine(
    (cards) => new Set(cards.map(({ id }) => id)).size === cards.length,
    "Duplicate cards",
  ),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("assign"), assigneeId: positiveId }).strict(),
    z.object({ type: z.literal("move"), stageId: WP_UUID }).strict(),
    z.object({ type: z.literal("delete") }).strict(),
  ]),
}).strict();

export async function bulkUpdateWorkCards(actor: WorkActor, boardId: string, raw: unknown) {
  const { cards, action } = bulkWorkCardInput.parse(raw);
  if (action.type === "delete" && !isWorkAdmin(actor)) {
    throw new WorkError(403, "Only admins remove pipeline records");
  }
  return workTx(async (c, t) => {
    const { document: board } = await readWorkBoard(c, t, boardId, actor, true);
    if (board.archived) throw new WorkError(409, "Pipeline is archived");

    const { rows } = await c.query<StoredWorkCard>(
      "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND id=ANY($3::uuid[]) AND document->>'removedAt' IS NULL ORDER BY id FOR UPDATE",
      [t, board.id, cards.map(({ id }) => id)],
    );
    if (rows.length !== cards.length) throw new WorkError(404, "Card not found");
    const revisions = new Map(cards.map(({ id, revision }) => [id, revision]));
    for (const row of rows) assertWorkRevision(row.revision, revisions.get(row.document.id));

    if (action.type === "delete") {
      // Retain the source key so an inbound retry cannot recreate a removed card.
      const removedAt = new Date().toISOString();
      for (const { document } of rows) {
        await c.query(
          "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
          [t, board.id, document.id, {
            ...document,
            removedAt,
            removedBy: actor.id,
            updatedAt: removedAt,
            history: [...document.history, event(actor.id, "removed", "")],
          }],
        );
        await syncConversation(c, t, document, false);
      }
    } else {
      const patch = action.type === "assign" ? { assigneeId: action.assigneeId } : { stageId: action.stageId };
      for (const row of rows) {
        await writeWorkCard(c, t, board, actor, row, patch, "", true);
      }
    }
    return { count: rows.length };
  });
}


export async function assignWorkConversation(
  actor: WorkActor,
  conversationId: number,
  assigneeId: number | null,
) {
  const state = await workConversationState(actor, conversationId);
  if (!state.linked) return null;
  if (state.items.length !== 1)
    throw new WorkError(409, "Select the pipeline record to change its owner");
  const item = state.items[0];
  return updateWorkCard(
    actor,
    item.boardId,
    item.card.id,
    item.revision,
    { assigneeId },
    "",
    true,
  );
}
