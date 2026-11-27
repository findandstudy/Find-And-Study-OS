import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  workTx,
  readWorkBoard,
  workCardInput,
  WorkError,
  event,
  type WorkActor,
  type WorkCard,
  type WorkBoard,
} from "./workPipelines";

export const TRANSFER_LIMIT = 2000;
export const TRANSFER_COLUMNS = [
  "PipelineId",
  "RecordId",
  "Title",
  "Email",
  "Phone",
  "ContactName",
  "StageId",
  "Stage",
  "AssigneeId",
  "Assignee",
  "DueDate",
  "Priority",
  "Status",
  "Description",
];
const bodySchema = z
  .object({
    sourceBoardId: z.string().uuid().optional(),
    rows: z
      .array(z.record(z.union([z.string().max(10000), z.number(), z.null()])))
      .min(1)
      .max(TRANSFER_LIMIT),
    previewHash: z.string().length(64).optional(),
  })
  .strict();
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Stored = { document: WorkCard & { importKey?: string }; revision: number };
const fields = (d: WorkCard) =>
  workCardInput.parse(
    Object.fromEntries(
      [
        "title",
        "description",
        "stageId",
        "assigneeId",
        "dueDate",
        "priority",
        "status",
        "contactName",
        "email",
        "phone",
        "tasks",
      ].map((k) => [k, (d as any)[k]]),
    ),
  );

export async function exportWorkRecords(
  actor: WorkActor,
  id: string,
  raw: unknown,
) {
  const filter = z
    .object({
      q: z.string().max(200).default(""),
      stage: z.string().default("all"),
      assignee: z.string().default("all"),
      template: z.enum(["true", "false"]).default("false"),
    })
    .parse(raw);
  return workTx(async (c, t) => {
    const board = await readWorkBoard(c, t, id, actor);
    const r =
      filter.template === "true"
        ? { rows: [] as Stored[] }
        : await c.query(
            "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND ($3='' OR document->>'title' ILIKE $4 OR document->>'contactName' ILIKE $4) AND ($5='all' OR document->>'stageId'=$5) AND ($6='all' OR ($6='none' AND document->>'assigneeId' IS NULL) OR document->>'assigneeId'=$6) ORDER BY document->>'createdAt',id LIMIT 2001",
            [t, id, filter.q, `%${filter.q}%`, filter.stage, filter.assignee],
          );
    if (r.rows.length > TRANSFER_LIMIT)
      throw new WorkError(
        400,
        "Export exceeds 2000 records. Narrow the filters; no partial file was created.",
      );
    const users = await c.query(
      "SELECT id,trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) name FROM users WHERE id=ANY($1::int[])",
      [
        [
          ...new Set(
            r.rows.map((x: Stored) => x.document.assigneeId).filter(Boolean),
          ),
        ],
      ],
    );
    const rows = r.rows.map(({ document: d }: Stored) => ({
      PipelineId: id,
      RecordId: d.id,
      Title: d.title,
      Email: d.email,
      Phone: d.phone,
      ContactName: d.contactName,
      StageId: d.stageId,
      Stage: board.document.stages.find((s) => s.id === d.stageId)?.name ?? "",
      AssigneeId: d.assigneeId ?? "",
      Assignee: users.rows.find((u) => u.id === d.assigneeId)?.name ?? "",
      DueDate: d.dueDate ?? "",
      Priority: d.priority,
      Status: d.status,
      Description: d.description,
    }));
    const assignees = await c.query(
      "SELECT id,trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) name FROM users WHERE is_active=true AND deleted_at IS NULL AND id=ANY($1::int[])",
      [[board.document.createdBy, ...board.document.memberIds]],
    );
    return {
      boardId: id,
      boardName: board.document.name,
      columns: TRANSFER_COLUMNS,
      rows,
      limit: TRANSFER_LIMIT,
      stages: board.document.stages.map((s) => ({ id: s.id, name: s.name })),
      assignees: assignees.rows,
    };
  });
}

/** Preview and commit use the same locked planner. A changed board/card invalidates
 * the preview. Import never searches or writes outside the explicit board. */
export async function importWorkRecords(
  actor: WorkActor,
  id: string,
  raw: unknown,
  commit = false,
) {
  const body = bodySchema.parse(raw);
  if (body.sourceBoardId && body.sourceBoardId !== id)
    throw new WorkError(
      400,
      "This workbook belongs to another pipeline. Use this pipeline's template.",
    );
  return workTx(async (c, t) => {
    const board = await readWorkBoard(c, t, id, actor, true);
    if (board.document.archived)
      throw new WorkError(409, "Pipeline is archived");
    const existing = await c.query(
      "SELECT document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 ORDER BY id LIMIT 10001 FOR UPDATE",
      [t, id],
    );
    if (existing.rowCount! > 10000)
      throw new WorkError(
        400,
        "Pipeline is too large for a single import batch",
      );
    const people = await c.query(
      "SELECT id,trim(coalesce(first_name,'')||' '||coalesce(last_name,'')) name FROM users WHERE is_active=true AND deleted_at IS NULL AND id=ANY($1::int[])",
      [[board.document.createdBy, ...board.document.memberIds]],
    );
    const seen = new Set<string>();
    const plans = body.rows.map((row, index) => {
      try {
        const text = (key: string) => String(row[key] ?? "").trim();
        if (text("PipelineId") && text("PipelineId") !== id)
          throw Error("Row belongs to another pipeline");
        const recordId = text("RecordId");
        const identity =
          text("Email").toLowerCase() ||
          text("Phone").replace(/\s/g, "") ||
          text("Title").toLocaleLowerCase("en");
        if (!identity) throw Error("Title is required");
        const importKey = digest(identity);
        let matches: Stored[] = recordId
          ? existing.rows.filter((r: Stored) => r.document.id === recordId)
          : existing.rows.filter(
              (r: Stored) =>
                r.document.importKey === importKey ||
                (text("Email") &&
                  r.document.email.toLowerCase() ===
                    text("Email").toLowerCase()),
            );
        if (recordId && !matches.length)
          throw Error("RecordId was not found in this pipeline");
        if (matches.length > 1) throw Error("Ambiguous match; use RecordId");
        const old: Stored | undefined = matches.length ? matches[0] : undefined;
        const key = old?.document.id ?? importKey;
        if (seen.has(key)) throw Error("Duplicate row in this file");
        seen.add(key);
        const stage = text("StageId")
          ? board.document.stages.find((s) => s.id === text("StageId"))
          : text("Stage")
            ? board.document.stages.find(
                (s) =>
                  s.name.toLocaleLowerCase() ===
                  text("Stage").toLocaleLowerCase(),
              )
            : undefined;
        if ((text("StageId") || text("Stage")) && !stage)
          throw Error("Unknown stage in this pipeline");
        const assignees = text("AssigneeId")
          ? people.rows.filter((p) => String(p.id) === text("AssigneeId"))
          : text("Assignee")
            ? people.rows.filter(
                (p) =>
                  p.name.toLocaleLowerCase() ===
                  text("Assignee").toLocaleLowerCase(),
              )
            : [];
        if ((text("AssigneeId") || text("Assignee")) && assignees.length !== 1)
          throw Error("Choose a current pipeline team member as assignee");
        const base = old ? fields(old.document) : { tasks: [] };
        const value = (key: string, previous: string | undefined) =>
          key in row ? text(key) : (previous ?? "");
        const data = workCardInput.parse({
          ...base,
          title: text("Title"),
          email: value("Email", old?.document.email),
          phone: value("Phone", old?.document.phone),
          contactName: value("ContactName", old?.document.contactName),
          description: value("Description", old?.document.description),
          stageId:
            stage?.id ?? old?.document.stageId ?? board.document.stages[0].id,
          assigneeId:
            !("AssigneeId" in row) && !("Assignee" in row)
              ? (old?.document.assigneeId ?? null)
              : (assignees[0]?.id ?? null),
          dueDate:
            "DueDate" in row
              ? text("DueDate") || null
              : (old?.document.dueDate ?? null),
          priority: text("Priority") || old?.document.priority || "normal",
          status: text("Status") || old?.document.status || "active",
        });
        const action = old
          ? JSON.stringify(fields(old.document)) === JSON.stringify(data)
            ? "unchanged"
            : "update"
          : "create";
        return {
          row: index + 2,
          action,
          title: data.title,
          error: "",
          data,
          old,
          importKey,
        };
      } catch (e: any) {
        return {
          row: index + 2,
          action: "error",
          title: String(row.Title ?? ""),
          error:
            e instanceof z.ZodError
              ? e.issues
                  .map((x) => `${x.path.join(".")}: ${x.message}`)
                  .join("; ")
              : e.message,
        };
      }
    });
    const hash = digest({ boardId: id, revision: board.revision, plans });
    const counts = Object.fromEntries(
      ["create", "update", "unchanged", "error"].map((a) => [
        a,
        plans.filter((p) => p.action === a).length,
      ]),
    );
    if (commit) {
      if (!body.previewHash || body.previewHash !== hash)
        throw new WorkError(
          409,
          "Records changed. Preview the file again before importing.",
        );
      if (counts.error)
        throw new WorkError(
          400,
          "Fix all invalid rows before importing. No records were changed.",
        );
      for (const p of plans) {
        if (!p.data || p.action === "unchanged") continue;
        const now = new Date().toISOString();
        const card = p.old
          ? {
              ...p.old.document,
              ...p.data,
              updatedAt: now,
              history: [
                ...p.old.document.history,
                event(actor.id, "import-updated", ""),
              ],
            }
          : {
              ...p.data,
              id: randomUUID(),
              createdAt: now,
              updatedAt: now,
              importKey: p.importKey,
              notes: [],
              history: [event(actor.id, "import-created", "")],
            };
        if (p.old)
          await c.query(
            "UPDATE local_work_pipelines.cards SET document=$4,revision=revision+1 WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
            [t, id, card.id, card],
          );
        else
          await c.query(
            "INSERT INTO local_work_pipelines.cards(tenant_id,board_id,id,document) VALUES($1,$2,$3,$4)",
            [t, id, card.id, card],
          );
      }
    }
    return {
      boardId: id,
      boardName: board.document.name,
      previewHash: hash,
      counts,
      rows: plans.map((p) => ({
        row: p.row,
        action: p.action,
        title: p.title,
        error: p.error,
      })),
      committed: commit,
    };
  });
}
