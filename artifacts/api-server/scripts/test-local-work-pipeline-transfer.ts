import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { workPipelineTenant } from "../src/lib/workPipelines";
assert.ok(workPipelineTenant());
const XLSX = createRequire(
  new URL("../../edcons/package.json", import.meta.url),
)("xlsx");
const credentials = JSON.parse(
  await readFile(
    new URL("../../../.local-work-pipeline-credentials.json", import.meta.url),
    "utf8",
  ),
);
const base = "http://127.0.0.1:8080/api";
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
  assert.equal(r.status, 200);
  const sid = r.headers
    .getSetCookie()
    .find((c) => c.startsWith("sid="))!
    .split(";")[0];
  return async (path: string, method = "GET", data?: unknown, status = 200) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `${csrf}; ${sid}`,
        "x-csrf-token": csrf.split("=")[1],
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await r.json();
    assert.equal(r.status, status, JSON.stringify(body));
    return body;
  };
}
try {
  const admin = await login("pipeline.admin@example.invalid"),
    outsider = await login("pipeline.outside@example.invalid");
  const crm = async () =>
    (
      await pool.query(
        "SELECT (SELECT count(*) FROM leads) leads,(SELECT count(*) FROM students) students,(SELECT count(*) FROM applications) applications",
      )
    ).rows[0];
  const before = await crm();
  const make = async (name: string) =>
    admin(
      "/work-pipelines",
      "POST",
      {
        data: {
          name,
          stages: [
            { id: randomUUID(), name: "Yeni", color: "#2563eb" },
            { id: randomUUID(), name: "Görüşme", color: "#059669" },
          ],
          memberIds: [2],
        },
      },
      201,
    );
  const a = await make("TEST Excel A " + randomUUID().slice(0, 6)),
    b = await make("TEST Excel B " + randomUUID().slice(0, 6));
  const path = (board: string, action: string) =>
    `/work-pipelines/${board}/transfer/${action}`;
  const rows = [
    {
      Title: "TEST Excel Partner",
      Email: "excel-partner@example.invalid",
      Phone: "00123456789",
      Stage: a.document.stages[1].name,
      Description: "=1+1\nİkinci satır",
    },
    { Title: "TEST Excel İkinci", Email: "excel-second@example.invalid" },
  ];
  let preview = await admin(path(a.document.id, "preview"), "POST", {
    sourceBoardId: a.document.id,
    rows,
  });
  assert.equal(preview.counts.create, 2);
  assert.equal(
    (await admin(`/work-pipelines/${a.document.id}/cards`)).items.length,
    0,
  );
  await admin(path(a.document.id, "import"), "POST", {
    sourceBoardId: a.document.id,
    rows,
    previewHash: preview.previewHash,
  });
  let exported = await admin(path(a.document.id, "export"));
  assert.equal(exported.rows.length, 2);
  assert.ok(exported.rows.every((r: any) => r.PipelineId === a.document.id));
  assert.equal((await admin(path(b.document.id, "export"))).rows.length, 0);
  const filtered = await admin(
    path(a.document.id, "export") + `?stage=${a.document.stages[1].id}`,
  );
  assert.equal(filtered.rows.length, 1);
  preview = await admin(path(a.document.id, "preview"), "POST", {
    sourceBoardId: a.document.id,
    rows,
  });
  assert.equal(preview.counts.unchanged, 2);
  await admin(path(a.document.id, "import"), "POST", {
    sourceBoardId: a.document.id,
    rows,
    previewHash: preview.previewHash,
  });
  assert.equal((await admin(path(a.document.id, "export"))).rows.length, 2);
  await admin(
    path(b.document.id, "preview"),
    "POST",
    { sourceBoardId: a.document.id, rows: exported.rows },
    400,
  );
  const foreign = await admin(path(b.document.id, "preview"), "POST", {
    rows: exported.rows.map((r: any) => ({ ...r, PipelineId: b.document.id })),
  });
  assert.equal(foreign.counts.error, 2);
  const badRows = [
    { Title: "TEST should not be created" },
    { Title: "TEST invalid", Email: "bad", StageId: b.document.stages[0].id },
  ];
  const bad = await admin(path(a.document.id, "preview"), "POST", {
    rows: badRows,
  });
  assert.equal(bad.counts.error, 1);
  await admin(
    path(a.document.id, "import"),
    "POST",
    { rows: badRows, previewHash: bad.previewHash },
    400,
  );
  assert.equal((await admin(path(a.document.id, "export"))).rows.length, 2);
  await outsider(path(a.document.id, "export"), "GET", undefined, 404);
  await outsider(path(a.document.id, "preview"), "POST", { rows }, 404);
  const row = exported.rows.find((r: any) => r.Email === rows[0].Email);
  let card = await admin(
    `/work-pipelines/${a.document.id}/cards/${row.RecordId}`,
  );
  card = await admin(
    `/work-pipelines/${a.document.id}/cards/${row.RecordId}/activity`,
    "POST",
    {
      revision: card.revision,
      activity: { action: "note", text: "TEST note survives Excel" },
    },
  );
  const changed = [{ RecordId: row.RecordId, Title: "TEST updated title" }];
  const update = await admin(path(a.document.id, "preview"), "POST", {
    rows: changed,
  });
  assert.equal(update.counts.update, 1);
  await admin(path(a.document.id, "import"), "POST", {
    rows: changed,
    previewHash: update.previewHash,
  });
  card = await admin(`/work-pipelines/${a.document.id}/cards/${row.RecordId}`);
  assert.equal(card.document.notes.length, 1);
  assert.equal(card.document.phone, "00123456789");
  assert.equal(card.document.description, rows[0].Description);
  const stale = await admin(path(a.document.id, "preview"), "POST", {
    rows: [{ RecordId: row.RecordId, Title: "TEST stale" }],
  });
  await admin(
    `/work-pipelines/${a.document.id}/cards/${row.RecordId}/activity`,
    "POST",
    {
      revision: card.revision,
      activity: { action: "note", text: "TEST revision change" },
    },
  );
  await admin(
    path(a.document.id, "import"),
    "POST",
    {
      rows: [{ RecordId: row.RecordId, Title: "TEST stale" }],
      previewHash: stale.previewHash,
    },
    409,
  );
  exported = await admin(path(a.document.id, "export"));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(exported.rows, { header: exported.columns }),
    "Records",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["PipelineId", a.document.id]]),
    "Pipeline",
  );
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const parsed = XLSX.read(bytes, { type: "buffer", cellFormula: true });
  const parsedRows = XLSX.utils.sheet_to_json(parsed.Sheets.Records, {
    defval: "",
    raw: false,
  });
  const roundtrip = await admin(path(a.document.id, "preview"), "POST", {
    sourceBoardId: a.document.id,
    rows: parsedRows,
  });
  assert.equal(roundtrip.counts.unchanged, 2);
  for (const [key, value] of Object.entries(parsed.Sheets.Records))
    if (!key.startsWith("!")) assert.ok(!(value as any).f);
  const template = await admin(
    path(a.document.id, "export") + "?template=true",
  );
  assert.equal(template.rows.length, 0);
  assert.equal(template.stages.length, 2);
  assert.ok(template.assignees.some((p: any) => p.id === 2));
  const fixture = join(tmpdir(), "pipeline-excel-ui-test.xlsx");
  const ui = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    ui,
    XLSX.utils.json_to_sheet([
      {
        Title: "TEST UI Excel import",
        Email: "ui-excel@example.invalid",
        Stage: "Yeni",
      },
    ]),
    "Records",
  );
  XLSX.utils.book_append_sheet(
    ui,
    XLSX.utils.aoa_to_sheet([["PipelineId", b.document.id]]),
    "Pipeline",
  );
  await writeFile(
    fixture,
    XLSX.write(ui, { type: "buffer", bookType: "xlsx" }),
  );
  assert.deepEqual(await crm(), before);
  console.log(
    JSON.stringify({
      ok: true,
      checks: 14,
      boardA: a.document.id,
      boardB: b.document.id,
      fixture,
    }),
  );
} finally {
  await pool.end();
}
