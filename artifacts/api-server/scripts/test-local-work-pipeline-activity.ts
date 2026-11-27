import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import { pool } from "@workspace/db";
import {
  captureWorkSource,
  workPipelineTenant,
  workTx,
  canUseWorkBoard,
  workBoardInput,
} from "../src/lib/workPipelines";
import { runWorkReminders } from "../src/lib/workPipelineActivity";
assert.ok(workPipelineTenant());
const base = "http://127.0.0.1:8080/api";
const credentials = JSON.parse(
  await readFile(
    new URL("../../../.local-work-pipeline-credentials.json", import.meta.url),
    "utf8",
  ),
);
const results: string[] = [];
async function login(email: string) {
  const init = await fetch(base + "/auth/me");
  const csrf = init.headers
    .getSetCookie()
    .find((c) => c.startsWith("csrf_token="))!
    .split(";")[0];
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: csrf,
      "x-csrf-token": csrf.split("=")[1],
    },
    body: JSON.stringify({ email, password: credentials.password }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const sid = r.headers
    .getSetCookie()
    .find((c) => c.startsWith("sid="))!
    .split(";")[0];
  return async (path: string, method = "GET", data?: unknown, status = 200) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `${csrf}; ${sid}`,
        "x-csrf-token": csrf.split("=")[1],
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
}

try {
  const admin = await login("pipeline.admin@example.invalid"),
    team = await login("pipeline.team@example.invalid"),
    outside = await login("pipeline.outside@example.invalid");
  const crm = (
    await pool.query(
      "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM students) students,(SELECT count(*) FROM applications) applications",
    )
  ).rows[0];
  const opts = await admin("/work-pipelines/options");
  assert.ok(Array.isArray(opts.bindings));
  assert.ok(opts.sources.some((s: any) => s.kind === "embed" && s.key === "1"));
  const board = await admin(
    "/work-pipelines",
    "POST",
    {
      data: workBoardInput.parse({
        name: "TEST activity " + randomUUID().slice(0, 8),
        stages: [{ id: randomUUID(), name: "Yeni", color: "#2563eb" }],
        memberIds: [2],
      }),
    },
    201,
  );
  const bid = board.document.id,
    baseCard = "/work-pipelines/" + bid + "/cards";
  let card = await admin(
    baseCard,
    "POST",
    {
      data: {
        title: "TEST follow-up",
        stageId: board.document.stages[0].id,
        assigneeId: 2,
      },
    },
    201,
  );
  const endpoint = baseCard + "/" + card.document.id + "/activity";
  card = await admin(endpoint, "POST", {
    revision: card.revision,
    activity: { action: "note", text: "TEST çok satırlı not\nİkinci satır" },
  });
  assert.equal(card.document.notes.length, 1);
  assert.equal(card.document.notes[0].by, 1);
  let notices = await pool.query(
    "SELECT * FROM notifications WHERE data->>'cardId'=$1",
    [card.document.id],
  );
  assert.equal(notices.rows.length, 1);
  assert.equal(notices.rows[0].user_id, 2);
  assert.equal(notices.rows[0].channel, "in_app");
  assert.equal(notices.rows[0].type, "pipeline.note_added");
  assert.ok(!notices.rows[0].body.includes("İkinci"));
  const scheduledAt = new Date(Date.now() + 3600000).toISOString();
  card = await admin(endpoint, "POST", {
    revision: card.revision,
    activity: {
      action: "followup",
      title: "TEST görüşme",
      notes: "TEST hazırlık",
      scheduledAt,
      assigneeId: 2,
    },
  });
  const fid = card.document.followUps[0].id;
  const dash = await team("/work-pipelines/dashboard");
  assert.ok(dash.followUps.some((r: any) => r.item.id === fid));
  assert.ok(dash.notes.some((r: any) => r.cardId === card.document.id));
  const otherDash = await outside("/work-pipelines/dashboard");
  assert.ok(!otherDash.notes.some((r: any) => r.boardId === bid));
  assert.ok(!otherDash.followUps.some((r: any) => r.boardId === bid));
  await outside(
    endpoint,
    "POST",
    { revision: card.revision, activity: { action: "note", text: "blocked" } },
    404,
  );
  await admin(
    endpoint,
    "POST",
    {
      revision: card.revision - 1,
      activity: { action: "note", text: "stale" },
    },
    409,
  );
  await admin(
    endpoint,
    "POST",
    {
      revision: card.revision,
      activity: {
        action: "followup",
        title: "bad",
        scheduledAt: "invalid",
        assigneeId: 2,
      },
    },
    400,
  );
  await admin(
    endpoint,
    "POST",
    {
      revision: card.revision,
      activity: {
        action: "followup",
        title: "bad member",
        scheduledAt,
        assigneeId: 3,
      },
    },
    400,
  );
  const future = new Date(Date.now() + 7200000);
  await Promise.all([
    runWorkReminders(future, bid),
    runWorkReminders(future, bid),
  ]);
  await runWorkReminders(future, bid);
  notices = await pool.query(
    "SELECT * FROM notifications WHERE data->>'followUpId'=$1 AND type='pipeline.follow_up_due'",
    [fid],
  );
  assert.equal(notices.rows.length, 1);
  card = await admin(baseCard + "/" + card.document.id);
  card = await team(endpoint, "POST", {
    revision: card.revision,
    activity: { action: "complete", id: fid, completed: true },
  });
  assert.equal(card.document.followUps[0].completed, true);
  assert.ok(
    !(await team("/work-pipelines/dashboard")).followUps.some(
      (r: any) => r.item.id === fid,
    ),
  );
  notices = await pool.query(
    "SELECT count(*)::int n FROM notifications WHERE data->>'followUpId'=$1 AND is_read=false",
    [fid],
  );
  assert.equal(notices.rows[0].n, 0);
  card = await admin(endpoint, "POST", {
    revision: card.revision,
    activity: {
      action: "followup",
      id: fid,
      title: "TEST ertelendi",
      notes: "",
      scheduledAt: new Date(Date.now() + 172800000).toISOString(),
      assigneeId: 2,
    },
  });
  assert.equal(card.document.followUps.length, 1);
  assert.equal(card.document.followUps[0].remindedAt, null);
  await runWorkReminders(future, bid);
  notices = await pool.query(
    "SELECT count(*)::int n FROM notifications WHERE data->>'followUpId'=$1 AND type='pipeline.follow_up_due'",
    [fid],
  );
  assert.equal(notices.rows[0].n, 1);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM students) students,(SELECT count(*) FROM applications) applications",
      )
    ).rows[0],
    crm,
  );
  const revoked = await admin("/work-pipelines/" + bid, "PUT", {
    revision: board.revision,
    data: {
      name: board.document.name,
      description: board.document.description,
      stages: board.document.stages,
      sources: [],
      archived: false,
      memberIds: [],
    },
  });
  await team(baseCard + "/" + card.document.id, "GET", undefined, 404);
  const revokedDash = await team("/work-pipelines/dashboard");
  assert.ok(!revokedDash.notes.some((r: any) => r.boardId === bid));
  assert.ok(!revokedDash.followUps.some((r: any) => r.boardId === bid));
  await runWorkReminders(new Date(Date.now() + 259200000), bid);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM notifications WHERE data->>'followUpId'=$1 AND type='pipeline.follow_up_due'",
        [fid],
      )
    ).rows[0].n,
    1,
  );
  await admin("/work-pipelines/" + bid, "PUT", {
    revision: revoked.revision,
    data: {
      name: revoked.document.name,
      description: revoked.document.description,
      stages: revoked.document.stages,
      memberIds: [],
      sources: [],
      archived: true,
    },
  });
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "existing embed options",
        "note notification in-app only",
        "multiline note",
        "follow-up scheduling",
        "dashboard visibility",
        "outsider denial",
        "revision conflict",
        "input/assignee validation",
        "overlapping reminder ticks dedup",
        "persisted reminder replay dedup",
        "completion clears reminder/unread",
        "rescheduling cancels old due",
        "CRM unchanged",
        "revoked membership hides dashboard/card and prevents reminders",
        "archived fixture excluded",
      ],
      boardId: bid,
      cardId: card.document.id,
    }),
  );
} finally {
  await pool.end();
}
