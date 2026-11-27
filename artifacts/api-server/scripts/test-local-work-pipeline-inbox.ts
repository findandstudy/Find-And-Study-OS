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

const before = (
  await pool.query(
    "SELECT (SELECT count(*) FROM leads) l,(SELECT count(*) FROM students) s,(SELECT count(*) FROM applications) a",
  )
).rows[0];
try {
  const admin = await login("pipeline.admin@example.invalid"),
    team = await login("pipeline.team@example.invalid"),
    outside = await login("pipeline.outside@example.invalid");
  const board = await admin(
    "/work-pipelines",
    "POST",
    {
      data: workBoardInput.parse({
        name: "TEST Inbox parity " + randomUUID().slice(0, 6),
        memberIds: [2],
        stages: [
          { id: randomUUID(), name: "New", color: "#2563eb" },
          { id: randomUUID(), name: "Meeting", color: "#059669" },
        ],
      }),
    },
    201,
  );
  const conv = (
    await pool.query(
      "INSERT INTO conversations(title,channel,channel_account_id,bot_enabled) VALUES('TEST Pipeline assignment','whatsapp',1,false) RETURNING id",
    )
  ).rows[0].id;
  let card = await admin(
    "/work-pipelines/" + board.document.id + "/cards",
    "POST",
    {
      data: {
        title: "TEST Inbox linked person",
        stageId: board.document.stages[0].id,
      },
    },
    201,
  );
  await workTx(async (c, t) => {
    await c.query(
      "UPDATE local_work_pipelines.cards SET document=jsonb_set(document,'{source}',$4::jsonb) WHERE tenant_id=$1 AND board_id=$2 AND id=$3",
      [
        t,
        board.document.id,
        card.document.id,
        JSON.stringify({ kind: "channel", key: "1", conversationId: conv }),
      ],
    );
  });
  const path =
    "/work-pipelines/" + board.document.id + "/cards/" + card.document.id;
  let detail = await admin("/inbox/conversations/" + conv);
  assert.equal(
    detail.workPipeline.items[0].card.stageId,
    board.document.stages[0].id,
  );
  results.push("Inbox uses linked pipeline stage without creating CRM lead");
  const listener = await pool.connect();
  await listener.query("LISTEN inbox_events");
  const pushed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Pipeline event missing")),
      3000,
    );
    listener.on("notification", (msg) => {
      const data = JSON.parse(msg.payload || "{}");
      if (data.type === "pipeline" && data.conversationId === conv) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  card = await team(path, "PATCH", {
    revision: card.revision,
    patch: { stageId: board.document.stages[1].id, assigneeId: 2 },
  });
  await pushed;
  await listener.query("UNLISTEN inbox_events");
  listener.release();
  results.push("Committed stage/assignment emits pipeline inbox refresh event");
  detail = await admin("/inbox/conversations/" + conv);
  assert.equal(
    detail.workPipeline.items[0].card.stageId,
    board.document.stages[1].id,
  );
  assert.equal(detail.conversation.assignedToId, 2);
  results.push("Pipeline stage + owner appear in Inbox");
  await admin(
    "/work-pipelines/" + board.document.id,
    "PUT",
    {
      revision: board.revision,
      data: {
        name: board.document.name,
        stages: board.document.stages,
        memberIds: [],
        sources: [],
        archived: false,
      },
    },
    409,
  );
  results.push(
    "Assigned member cannot be removed until records are reassigned",
  );

  await admin("/inbox/conversations/" + conv + "/assign", "PATCH", {
    userId: 1,
  });
  card = await admin(path);
  assert.equal(card.document.assigneeId, 1);
  results.push("Inbox assignment updates same pipeline card");
  card = await team(path, "PATCH", {
    revision: card.revision,
    patch: { stageId: board.document.stages[0].id },
  });
  assert.equal(card.document.assigneeId, 1);
  results.push("Narrow stage patch preserves owner and other card fields");
  await admin(
    path,
    "PATCH",
    { revision: card.revision, patch: { assigneeId: 3 } },
    400,
  );
  await outside("/work-pipelines/conversation/" + conv, "GET", undefined, 403);
  await outside("/inbox/conversations/" + conv, "GET", undefined, 403);
  await outside(
    "/inbox/conversations/" + conv + "/assign",
    "PATCH",
    { userId: 3 },
    403,
  );
  results.push("Foreign member/owner and Inbox scope bypass denied");
  await admin(
    path,
    "PATCH",
    { revision: card.revision - 1, patch: { assigneeId: 2 } },
    409,
  );
  results.push("Stale edit rejected without overwriting stage");
  card = await admin(path, "PATCH", {
    revision: card.revision,
    patch: { assigneeId: null },
  });
  assert.equal(
    (await admin("/inbox/conversations/" + conv)).conversation.assignedToId,
    null,
  );
  results.push("Unassign is mirrored and survives detail reload");
  await pool.query("UPDATE conversations SET assigned_to_id=1 WHERE id=$1", [
    conv,
  ]);
  await admin("/inbox/conversations/" + conv + "/assign", "PATCH", {
    userId: null,
  });
  card = await admin(path);
  assert.equal(
    (await admin("/inbox/conversations/" + conv)).conversation.assignedToId,
    null,
  );
  results.push("Repeated same-owner assignment repairs conversation drift");

  await team(
    path,
    "PATCH",
    { revision: card.revision, patch: { stageId: randomUUID() } },
    400,
  );
  const currentBoard = (
    await admin("/work-pipelines/" + board.document.id + "/cards")
  ).board;
  await admin("/work-pipelines/" + board.document.id, "PUT", {
    revision: currentBoard.revision,
    data: {
      name: currentBoard.document.name,
      description: currentBoard.document.description,
      stages: currentBoard.document.stages,
      sources: currentBoard.document.sources,
      archived: false,
      memberIds: [],
    },
  });
  await team("/work-pipelines/conversation/" + conv, "GET", undefined, 403);
  results.push("Membership revocation immediately removes pipeline access");
  assert.deepEqual(
    (
      await pool.query(
        "SELECT (SELECT count(*) FROM leads) l,(SELECT count(*) FROM students) s,(SELECT count(*) FROM applications) a",
      )
    ).rows[0],
    before,
  );
  results.push(
    "No Lead/Student/Application rows created or changed by assignment",
  );
  console.log(
    JSON.stringify(
      {
        passed: results.length,
        results,
        fixture: {
          boardId: board.document.id,
          cardId: card.document.id,
          conversationId: conv,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
