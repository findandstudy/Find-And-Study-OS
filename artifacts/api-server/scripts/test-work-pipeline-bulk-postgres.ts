import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { bulkUpdateWorkCards, updateWorkCard, workConversationState } from "../src/lib/workPipelineInbox";
import { captureWorkSource, workBoardInput, workCardInput, workPipelineTenant, workSourceKey, workTx } from "../src/lib/workPipelines";
import { upcomingWorkFollowUps } from "../src/lib/workPipelineUpcoming";
import { exportWorkRecords } from "../src/lib/workPipelineTransfer";

const url = new URL(process.env.DATABASE_URL ?? "invalid:");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(url.host, "127.0.0.1:5433");
assert.equal(url.pathname, "/fas_dev_pipeline_hardening");
assert.equal(url.username, "fas_app");
assert.ok(workPipelineTenant());

const admin = { id: 101, role: "admin" };
const member = { id: 102, role: "consultant" };
const outsider = { id: 103, role: "consultant" };
const boardId = randomUUID();
const otherBoard = randomUUID();
const firstStage = randomUUID();
const secondStage = randomUUID();
const first = randomUUID();
const second = randomUUID();
const otherCard = randomUUID();
const conversation = 41;
const now = new Date().toISOString();
const stages = [{ id: firstStage, name: "Open", color: "#2563eb" }, { id: secondStage, name: "Review", color: "#2563eb" }];
const command = (entries: [string, number][], action: unknown) => ({
  cards: entries.map(([id, revision]) => ({ id, revision })),
  action,
});
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, expected);
  return true;
};
const rows = () => workTx(async (c, tenant) => (await c.query(
  "SELECT id,document,revision FROM local_work_pipelines.cards WHERE tenant_id=$1 AND board_id=$2",
  [tenant, boardId],
)).rows);
const ownership = async () => (await pool.query("SELECT assigned_to_id FROM conversations WHERE id=$1", [conversation])).rows[0].assigned_to_id;

try {
  await workTx(async (c, tenant) => {
    for (const id of [boardId, otherBoard]) {
      const input = workBoardInput.parse({ name: "Synthetic bulk test", memberIds: [member.id], stages });
      await c.query("INSERT INTO local_work_pipelines.boards(tenant_id,id,document) VALUES($1,$2,$3)", [
        tenant, id, { ...input, id, createdBy: admin.id, createdAt: now, updatedAt: now, history: [] },
      ]);
    }
    await c.query("INSERT INTO local_work_pipelines.sources VALUES($1,'channel','synthetic',$2)", [tenant, boardId]);
    for (const [id, board] of [[first, boardId], [second, boardId], [otherCard, otherBoard]]) {
      const base = { ...workCardInput.parse({ title: "Synthetic card", stageId: firstStage }), id, createdAt: now, updatedAt: now, history: [], notes: [] };
      const linked = id === first;
      const document = linked ? {
        ...base,
        source: { kind: "channel", key: "synthetic", conversationId: conversation },
        followUps: [{ id: randomUUID(), title: "Test follow-up", notes: "", scheduledAt: now, assigneeId: admin.id, createdBy: admin.id, completed: false }],
      } : base;
      await c.query("INSERT INTO local_work_pipelines.cards(tenant_id,board_id,id,document,source_kind,source_key) VALUES($1,$2,$3,$4,$5,$6)", [
        tenant, board, id, document, linked ? "channel" : null, linked ? workSourceKey("channel", String(conversation)) : null,
      ]);
    }
  });
  const both: [string, number][] = [[first, 1], [second, 1]];
  const assign = { type: "assign", assigneeId: member.id };
  await assert.rejects(bulkUpdateWorkCards(outsider, boardId, command(both, assign)), status(404));
  await assert.rejects(bulkUpdateWorkCards(member, boardId, command(both, { type: "delete" })), status(403));
  await assert.rejects(bulkUpdateWorkCards(admin, boardId, command([[first, 1], [otherCard, 1]], assign)), status(404));
  await assert.rejects(bulkUpdateWorkCards(admin, boardId, command([[first, 1], [first.toUpperCase(), 1]], assign)));
  await assert.rejects(bulkUpdateWorkCards(admin, boardId, command([[first, 1], [second, 2]], assign)), status(409));
  assert.ok((await rows()).every((r) => r.revision === 1 && r.document.assigneeId === null));
  assert.equal(await ownership(), null);

  const [a, b] = await Promise.allSettled([
    bulkUpdateWorkCards(member, boardId, command(both, assign)),
    bulkUpdateWorkCards(member, boardId, command(both, { type: "move", stageId: secondStage })),
  ]);
  const race = [a, b];
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.find((r) => r.status === "rejected")?.reason.status, 409);
  const live = await rows();
  assert.ok(live.every((r) => r.revision === 2));
  const refs = live.map((r) => [r.id, r.revision] as [string, number]);
  await bulkUpdateWorkCards(member, boardId, command(refs, a.status === "fulfilled" ? { type: "move", stageId: secondStage } : assign));
  assert.ok((await rows()).every((r) => r.document.assigneeId === member.id && r.document.stageId === secondStage));
  assert.equal(await ownership(), member.id);
  assert.equal((await workConversationState(admin, conversation)).items[0]?.card.stageId, secondStage);
  assert.equal((await upcomingWorkFollowUps(admin, new Date())).length, 1);

  const ready = (await rows()).map((r) => [r.id, r.revision] as [string, number]);
  assert.equal((await bulkUpdateWorkCards(admin, boardId, command(ready, { type: "delete" }))).count, 2);
  assert.ok((await rows()).every((row) => row.document.removedAt && row.document.removedBy === admin.id && row.document.history.at(-1).action === "removed"));
  assert.equal((await exportWorkRecords(admin, boardId, {})).rows.length, 0);
  assert.equal((await upcomingWorkFollowUps(admin, new Date())).length, 0);
  assert.equal((await workConversationState(admin, conversation)).linked, false);
  assert.equal(await ownership(), member.id);
  await assert.rejects(updateWorkCard(admin, boardId, first, 4, { stageId: firstStage }, "", true), status(404));
  const inbound = await captureWorkSource({ kind: "channel", key: "synthetic", identity: String(conversation), title: "Synthetic retry", description: "", conversationId: conversation });
  assert.deepEqual(inbound, { cardId: first, created: false });
  console.log("PASS: board scope, permissions, atomic conflicts, concurrent updates, Inbox sync, soft removal, exports, follow-ups and inbound deduplication.");
} finally {
  await pool.end();
}
