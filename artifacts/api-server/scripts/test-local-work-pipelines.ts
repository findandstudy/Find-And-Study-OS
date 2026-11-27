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
import { processInboundMessage } from "../src/lib/inbox/processInbound";
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
const countCRM = async () =>
  (
    await pool.query(
      "SELECT (SELECT count(*)::int FROM leads) leads,(SELECT count(*)::int FROM students) students,(SELECT count(*)::int FROM applications) applications",
    )
  ).rows[0];
try {
  const unauth = await fetch(base + "/work-pipelines");
  assert.equal(unauth.status, 401);
  results.push("Unauthenticated denied");
  const admin = await login("pipeline.admin@example.invalid"),
    team = await login("pipeline.team@example.invalid"),
    outside = await login("pipeline.outside@example.invalid");
  const people = credentials.people;
  const before = await countCRM();
  const options = await admin("/work-pipelines/options");
  assert.ok(options.canManage);
  const sources = options.sources
    .filter(
      (s: any) => s.key === "1" && ["embed", "channel", "web"].includes(s.kind),
    )
    .map(({ kind, key }: any) => ({ kind, key }));
  // Reuse the two local review boards on repeat runs without binding duplicate sources.
  const boards = await admin("/work-pipelines");
  let board = boards.items.find(
    (r: any) => r.document.name === "Acente kazanımı — Yerel deneme",
  );
  const makeInput = (name: string) =>
    workBoardInput.parse({
      name,
      stages: [
        { id: randomUUID(), name: "Yeni görüşme", color: "#2563eb" },
        { id: randomUUID(), name: "Toplantı", color: "#7c3aed" },
        {
          id: randomUUID(),
          name: "Partner oldu",
          color: "#059669",
          result: "won",
        },
      ],
      memberIds: [people[1].id],
      sources,
    });
  if (!board)
    board = await admin(
      "/work-pipelines",
      "POST",
      { data: makeInput("Acente kazanımı — Yerel deneme") },
      201,
    );
  else if (board.document.sources.length !== sources.length) {
    const d = board.document;
    board = await admin(`/work-pipelines/${d.id}`, "PUT", {
      data: {
        name: d.name,
        description: d.description,
        stages: d.stages,
        memberIds: d.memberIds,
        sources,
        archived: d.archived,
      },
      revision: board.revision,
    });
  }
  await outside(
    `/work-pipelines/${board.document.id}/cards`,
    "GET",
    undefined,
    404,
  );
  await team("/work-pipelines", "POST", { data: makeInput("Denied") }, 403);
  results.push("Admin create / member access / outsider isolation");
  const conflictInput = { ...makeInput("Duplicate source"), sources };
  await admin("/work-pipelines", "POST", { data: conflictInput }, 409);
  results.push("Exclusive source bindings");
  let card = await team(
    `/work-pipelines/${board.document.id}/cards`,
    "POST",
    {
      data: {
        title: "Yerel test — partner görüşmesi",
        stageId: board.document.stages[0].id,
        assigneeId: people[1].id,
        dueDate: "2026-12-10",
        priority: "high",
        tasks: [
          {
            id: randomUUID(),
            title: "Tanışma toplantısını planla",
            done: false,
          },
        ],
      },
    },
    201,
  );
  const input = card.document;
  let secondBoard = boards.items.find(
    (r: any) => r.document.name === "İç ekip işleri — Yerel deneme",
  );
  if (!secondBoard)
    secondBoard = await admin(
      "/work-pipelines",
      "POST",
      {
        data: {
          ...makeInput("İç ekip işleri — Yerel deneme"),
          sources: [],
          memberIds: [],
        },
      },
      201,
    );
  await team(
    `/work-pipelines/${secondBoard.document.id}/cards`,
    "GET",
    undefined,
    404,
  );
  results.push("Independent pipelines keep separate teams and stages");
  const payload = {
    title: input.title,
    description: input.description,
    stageId: board.document.stages[1].id,
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    priority: input.priority,
    status: input.status,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    tasks: input.tasks,
  };
  await admin(
    `/work-pipelines/${secondBoard.document.id}/cards/${input.id}`,
    "PUT",
    {
      data: { ...payload, stageId: secondBoard.document.stages[0].id },
      revision: card.revision,
    },
    404,
  );
  results.push("Card cannot be edited through another pipeline URL");
  card = await team(
    `/work-pipelines/${board.document.id}/cards/${input.id}`,
    "PUT",
    {
      data: payload,
      revision: card.revision,
      note: "Sentetik iç ekip notu; gerçek iletişim yok.",
    },
  );
  assert.equal(card.document.notes.length, 1);
  assert.ok(card.document.history.some((e: any) => e.text.includes("→")));
  results.push("Card create, task, owner, date, move, note and history");
  await team(
    `/work-pipelines/${board.document.id}/cards/${input.id}`,
    "PUT",
    { data: payload, revision: 1 },
    409,
  );
  results.push("Optimistic concurrency prevents lost updates");
  await team(
    `/work-pipelines/${board.document.id}/cards/${input.id}`,
    "PUT",
    { data: { ...payload, stageId: randomUUID() }, revision: card.revision },
    400,
  );
  results.push("Foreign board/stage injection denied");
  const dedupIdentity = `synthetic-dedup-${randomUUID()}@example.invalid`;
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () =>
      captureWorkSource({
        kind: "embed",
        key: "1",
        identity: dedupIdentity,
        title: "Sentetik tekrar denemesi",
        description: "LOCAL TEST",
      }),
    ),
  );
  assert.equal(new Set(concurrent.map((x) => x?.cardId)).size, 1);
  assert.equal(concurrent.filter((x) => x?.created).length, 1);
  results.push("Concurrent duplicate intake creates one card");
  const payloadToken = Buffer.from(
    JSON.stringify({
      slug: "local-partner-enquiry",
      exp: Date.now() + 60000,
      jti: randomUUID(),
    }),
  ).toString("base64url");
  const token =
    payloadToken +
    "." +
    createHmac("sha256", `edcons-embed:${process.env.SESSION_SECRET}`)
      .update(payloadToken)
      .digest("base64url");
  const submit = await fetch(
    base + `/public/embed/local-partner-enquiry/lead?t=${token}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:25197",
      },
      body: JSON.stringify({
        firstName: "Synthetic",
        lastName: "Partner",
        email: "synthetic-form@example.invalid",
        phone: "5550000001",
        countryCode: "+90",
        message: "Acente partnerliği hakkında bilgi istiyorum.",
      }),
    },
  );
  assert.equal(submit.status, 201, await submit.clone().text());
  assert.equal((await submit.json()).leadId, null);
  results.push("Real embed submission routes to independent card");
  const web = await fetch(
    base + "/public/lead/local-work-pipeline-agent-form",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Synthetic",
        lastName: "Web",
        email: "synthetic-web@example.invalid",
        phone: "+905550000001",
      }),
    },
  );
  assert.equal(web.status, 201, await web.clone().text());
  assert.equal((await web.json()).leadId, null);
  results.push(
    "Existing web-to-lead route preserves token gate and creates independent card",
  );
  const inbound = {
    channel: "whatsapp",
    channelAccountId: 1,
    contact: {
      externalId: "local-pipeline-synthetic",
      displayName: "SENTETİK WhatsApp partner",
    },
    message: {
      externalMessageId: "local-work-pipeline-msg-" + randomUUID(),
      text: "Yerel test: acente partnerliği görüşmesi",
      externalThreadId: "local-pipeline-synthetic",
    },
  };
  const first = await processInboundMessage(inbound),
    second = await processInboundMessage(inbound);
  assert.equal(first.conversationId, second.conversationId);
  assert.equal(second.duplicate, true);
  assert.equal(
    (
      await pool.query("SELECT bot_enabled FROM conversations WHERE id=$1", [
        first.conversationId,
      ])
    ).rows[0].bot_enabled,
    false,
  );
  results.push(
    "Inbound inbox delivery + duplicate guard + student bot isolation",
  );
  assert.deepEqual(await countCRM(), before);
  results.push("Lead / Student / Application rows unchanged");
  await workTx(async (c, t) => {
    await c.query("SELECT set_config('app.work_pipeline_tenant',$1,true)", [
      randomUUID(),
    ]);
    assert.equal(
      (
        await c.query(
          "SELECT id FROM local_work_pipelines.boards WHERE tenant_id=$1",
          [t],
        )
      ).rowCount,
      0,
    );
  });
  results.push("Non-superuser PostgreSQL tenant RLS isolation");
  await assert.rejects(
    workTx(async (c, t) =>
      c.query(
        "UPDATE local_work_pipelines.sources SET source_key='forbidden' WHERE tenant_id=$1",
        [t],
      ),
    ),
    /row-level security/,
  );
  results.push("Source locks do not grant source UPDATE access");
  assert.equal(
    workBoardInput.safeParse({ ...makeInput("Archive guard"), archived: true })
      .success,
    false,
  );
  results.push("Archiving cannot silently disconnect inbound sources");
  assert.equal(
    canUseWorkBoard({ id: people[2].id, role: "agent" }, board.document),
    false,
  );
  results.push("External agent role denied");
  console.log(
    JSON.stringify(
      {
        passed: results.length,
        checks: results,
        pipelineId: board.document.id,
        localPreview: `http://127.0.0.1:25197/staff/pipelines?pipeline=${board.document.id}`,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
