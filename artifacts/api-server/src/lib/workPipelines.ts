import { randomUUID, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { z } from "zod";
import { STAFF_ROLES } from "./roles";
import { workPipelineEnvironmentAllowed } from "./workPipelineEnvironment";

export const WP_UUID = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
export const workBoardInput = z
  .object({
    name: text(120).min(1),
    description: text(2000).default(""),
    stages: z
      .array(
        z.object({
          id: WP_UUID,
          name: text(80).min(1),
          color: z.string().regex(/^#[0-9a-f]{6}$/i),
          result: z.enum(["open", "won", "closed"]).default("open"),
        }),
      )
      .min(1)
      .max(50),
    memberIds: z.array(z.number().int().positive()).max(200).default([]),
    sources: z
      .array(
        z.object({
          kind: z.enum(["channel", "embed", "web"]),
          key: text(100).min(1),
        }),
      )
      .max(100)
      .default([]),
    archived: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.stages.map((s) => s.id)).size !== v.stages.length)
      c.addIssue({
        code: "custom",
        message: "Duplicate stage",
        path: ["stages"],
      });
    if (
      new Set(v.sources.map((s) => s.kind + ":" + s.key)).size !==
      v.sources.length
    )
      c.addIssue({
        code: "custom",
        message: "Duplicate source",
        path: ["sources"],
      });
    if (v.archived && v.sources.length)
      c.addIssue({
        code: "custom",
        message: "Disconnect sources explicitly before archiving",
        path: ["sources"],
      });
  });
export const workCardInput = z
  .object({
    title: text(200).min(1),
    description: text(10000).default(""),
    stageId: WP_UUID,
    assigneeId: z.number().int().positive().nullable().default(null),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
      )
      .nullable()
      .default(null),
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    status: z
      .enum(["active", "waiting", "done", "cancelled"])
      .default("active"),
    contactName: text(200).default(""),
    email: z.union([z.literal(""), z.string().email().max(255)]).default(""),
    phone: text(80).default(""),
    tasks: z
      .array(
        z.object({ id: WP_UUID, title: text(300).min(1), done: z.boolean() }),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type WorkBoard = z.infer<typeof workBoardInput> & {
  id: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  history: WorkEvent[];
};
export type WorkEvent = {
  id: string;
  at: string;
  by: number | null;
  action: string;
  text: string;
};
export type WorkFollowUp = {
  id: string; title: string; notes: string; scheduledAt: string; assigneeId: number;
  completed: boolean; createdBy: number; remindedAt: string | null;
};
export type WorkCard = z.infer<typeof workCardInput> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  followUps?: WorkFollowUp[];
  notes: WorkEvent[];
  history: WorkEvent[];
  source?: { kind: string; key: string; conversationId?: number };
};
export type WorkActor = { id: number; role: string };
export class WorkError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function workPipelineTenant(): string | null {
  if (process.env.WORK_PIPELINES_ENABLED !== "true") return null;
  if (!workPipelineEnvironmentAllowed(process.env))
    throw new WorkError(
      503,
      "Work pipelines require the isolated local or explicit staging environment",
    );
  return WP_UUID.parse(process.env.WORK_PIPELINES_TENANT_ID);
}
export async function workTx<T>(
  fn: (client: PoolClient, tenant: string) => Promise<T>,
): Promise<T> {
  const tenant = workPipelineTenant();
  if (!tenant) throw new WorkError(404, "Work pipelines are disabled");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    if (process.env.WORK_PIPELINES_ENV === "staging") {
      const identity = await c.query("SELECT current_database() AS name, current_user AS actor, inet_server_port() AS port");
      const row = identity.rows[0];
      if (row?.name !== "fasos_staging" || row?.actor !== "fas_app" || row?.port !== 5432)
        throw new WorkError(503, "Work pipeline database identity mismatch");
    }
    await c.query("SELECT set_config('app.work_pipeline_tenant',$1,true)", [
      tenant,
    ]);
    await c.query("SET LOCAL statement_timeout='8000ms'");
    const result = await fn(c, tenant);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export const isWorkAdmin = (a: WorkActor) =>
  ["super_admin", "admin"].includes(a.role);
export function canUseWorkBoard(a: WorkActor, b: WorkBoard): boolean {
  return (
    STAFF_ROLES.includes(a.role) &&
    (isWorkAdmin(a) || b.createdBy === a.id || b.memberIds.includes(a.id))
  );
}
export async function readWorkBoard(
  c: PoolClient,
  t: string,
  id: string,
  a?: WorkActor,
  lock = false,
) {
  WP_UUID.parse(id);
  const r = await c.query(
    `SELECT document,revision FROM local_work_pipelines.boards WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [t, id],
  );
  if (!r.rows[0] || (a && !canUseWorkBoard(a, r.rows[0].document)))
    throw new WorkError(404, "Pipeline not found");
  return r.rows[0] as { document: WorkBoard; revision: number };
}
export function event(
  by: number | null,
  action: string,
  value: string,
): WorkEvent {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    by,
    action,
    text: value,
  };
}
export async function validateWorkMembers(c: PoolClient, ids: number[]) {
  if (!ids.length) return;
  const r = await c.query(
    "SELECT id FROM users WHERE id=ANY($1::int[]) AND is_active=true AND role=ANY($2::text[])",
    [ids, STAFF_ROLES],
  );
  if (new Set(ids).size !== r.rowCount)
    throw new WorkError(400, "Choose active internal team members");
}
export function assertWorkRevision(actual: number, expected: unknown) {
  if (!Number.isInteger(expected) || actual !== expected)
    throw new WorkError(409, "This record changed. Reload before saving.");
}
export function workSourceKey(kind: string, key: string) {
  return createHash("sha256")
    .update(kind + ":" + key)
    .digest("hex");
}
export async function resolveWorkSource(
  kind: "channel" | "embed" | "web",
  key: string,
) {
  if (!workPipelineTenant()) return null;
  return workTx(async (c, t) => {
    const r = await c.query(
      "SELECT board_id FROM local_work_pipelines.sources WHERE tenant_id=$1 AND kind=$2 AND source_key=$3",
      [t, kind, key],
    );
    return (r.rows[0]?.board_id as string) || null;
  });
}
/** One card per conversation/form identity, transaction-safe on webhook retries. No CRM writer. */
export async function captureWorkSource(input: {
  kind: "channel" | "embed" | "web";
  key: string;
  identity: string;
  title: string;
  description: string;
  contactName?: string;
  email?: string;
  phone?: string;
  conversationId?: number;
}) {
  if (!workPipelineTenant()) return null;
  return workTx(async (c, t) => {
    const binding = await c.query(
      "SELECT board_id FROM local_work_pipelines.sources WHERE tenant_id=$1 AND kind=$2 AND source_key=$3 FOR SHARE",
      [t, input.kind, input.key],
    );
    if (!binding.rowCount) return null;
    const { document: b } = await readWorkBoard(c, t, binding.rows[0].board_id);
    if (b.archived) throw new WorkError(409, "The source pipeline is archived");
    const card: WorkCard = {
      ...workCardInput.parse({
        title: input.title.trim().slice(0, 200) || input.kind,
        description: input.description.slice(0, 10000),
        stageId: b.stages[0].id,
        contactName: (input.contactName || "").slice(0, 200),
        email: z.string().email().max(255).safeParse(input.email?.trim())
          .success
          ? input.email!.trim()
          : "",
        phone: (input.phone || "").slice(0, 80),
      }),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: [],
      history: [event(null, "captured", input.kind)],
      source: {
        kind: input.kind,
        key: input.key,
        conversationId: input.conversationId,
      },
    };
    const dedup = workSourceKey(input.kind, input.identity);
    const r = await c.query(
      "INSERT INTO local_work_pipelines.cards(tenant_id,board_id,id,document,source_kind,source_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,board_id,source_kind,source_key) DO NOTHING RETURNING id",
      [t, b.id, card.id, card, input.kind, dedup],
    );
    const row =
      r.rows[0] ||
      (
        await c.query(
          "SELECT id FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2 AND source_kind=$3 AND source_key=$4",
          [t, b.id, input.kind, dedup],
        )
      ).rows[0];
    return { cardId: row.id, created: Boolean(r.rowCount) };
  });
}
