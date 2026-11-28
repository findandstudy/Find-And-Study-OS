import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, test } from "node:test";
import express from "express";
import * as XLSX from "xlsx";

assert.equal(process.env.DATABASE_URL, "postgresql://postgres@127.0.0.1:5433/fas_dev_pipeline_hardening");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
assert.equal(process.env.EMAIL_DELIVERY_DISABLED, "true");

const { pool } = await import("@workspace/db");
const { default: catalog } = await import("../src/routes/catalog");
const id = randomUUID();
const adminEmail = "program-import-" + id + "@example.invalid";
const identity = (await pool.query("SELECT current_database() AS db_name, inet_server_port() AS port")).rows[0];
assert.deepEqual(identity, { db_name: "fas_dev_pipeline_hardening", port: 5433 });
const userId: number = (await pool.query(
  "INSERT INTO users (email, first_name, last_name, role) VALUES ($1, 'Synthetic', 'Catalogue', 'super_admin') RETURNING id",
  [adminEmail],
)).rows[0].id;
const documentKeys = ["qa_id_" + id, "qa_diploma_" + id];
await pool.query("INSERT INTO catalog_options (category, value) SELECT 'documents', unnest($1::text[])", [documentKeys]);

const app = express();
app.use((_req, _res, next) => {
  _req.user = { id: userId, replitId: id, email: adminEmail, firstName: "Synthetic", lastName: "Catalogue", role: "super_admin", avatarUrl: null, language: "en", isActive: true };
  next();
});
app.use("/api", catalog);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/api/programs";
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

function send(path: string, rows?: Record<string, unknown>[], revision?: string) {
  return fetch(base + path, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    ...(rows ? {
      method: "POST",
      headers: { "content-type": "application/json", ...(revision ? { "X-Program-Import-Preview": revision } : {}) },
      body: JSON.stringify(rows),
    } : {}),
  });
}

function workbookRows(headers: string[], rows: Record<string, unknown>[]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows, { header: headers }), "Programs");
  const parsed = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets.Programs, { defval: "" });
}

test("a reviewed thirteen-row programme workbook keeps distinct PLN fees, campus links and documents", async () => {
  const template = await send("/import-template");
  assert.equal(template.status, 200);
  assert.match(template.headers.get("cache-control") ?? "", /no-store/);
  const templateBook = XLSX.read(Buffer.from(await template.arrayBuffer()), { type: "buffer" });
  const [headers] = XLSX.utils.sheet_to_json<string[]>(templateBook.Sheets.Programs, { header: 1 });
  for (const header of ["enrollmentFee", "applicationFee", "adaptationFee", "refundProcess", "requirements", ...documentKeys]) {
    assert.ok(headers.includes(header), "Expected template column " + header);
  }

  const universityName = "Synthetic March Entry " + id;
  const cases = Array.from({ length: 13 }, (_, index) => ({
    universityName, country: "Poland", name: "Synthetic programme " + (index + 1), degree: "Bachelor", language: "English",
    tuitionFee: 0, currency: "PLN", feeType: "per semester", applicationFee: 85, adaptationFee: 400,
    enrollmentFee: index === 0 ? 0 : " ", commissionRate: 11, financeNotes: "Synthetic private commission note",
    requirements: "Synthetic diploma requirement", refundProcess: index === 0 ? "Synthetic paragraph one.\n\nSynthetic paragraph two." : "",
    applicationPeriodTermName: "March entry", applicationPeriodAcademicYear: 2027,
    applicationPeriodCampusName: index < 7 ? "Gdańsk" : "Gdynia",
    applicationsOpenAt: "2026-09-01", applicationDeadlineAt: "2027-03-11", applicationPeriodTimezone: "Europe/Warsaw",
    applicationPeriodSourceUrl: "https://example.invalid/pilot-fixture", priceValidFrom: "2026-09-01", priceValidUntil: "2027-03-11",
    [documentKeys[0]]: "mandatory", [documentKeys[1]]: "optional",
  }));
  const input = workbookRows(headers, cases);
  const bad = await send("/bulk/preview", [{ ...cases[0], currency: "" }, ...cases.slice(1)]);
  assert.equal(bad.status, 200);
  const invalid = await bad.json();
  assert.deepEqual(invalid.summary, { add: 12, update: 0, error: 1 });
  assert.equal(invalid.canImport, false);

  const preview = await send("/bulk/preview", input);
  assert.equal(preview.status, 200);
  const reviewed = await preview.json();
  assert.deepEqual(reviewed.summary, { add: 13, update: 0, error: 0 });
  assert.match(reviewed.revision, /^[a-f0-9]{64}$/);

  const results = await Promise.all([send("/bulk", input, reviewed.revision), send("/bulk", input, reviewed.revision)]);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  const applied = await results.find(item => item.ok)!.json();
  assert.deepEqual([applied.inserted, applied.updated, applied.docsTouched], [13, 0, 13]);

  const programs = (await pool.query(
    "SELECT p.*, period.campus_name, period.applications_open_at::text AS opens, period.application_deadline_at::text AS deadline, period.classes_start_on FROM programs p JOIN universities u ON u.id=p.university_id JOIN university_application_periods period ON p.university_application_period_id=period.id WHERE u.name=$1 ORDER BY p.id",
    [universityName],
  )).rows;
  assert.equal(programs.length, 13);
  assert.deepEqual([...new Set(programs.map(row => row.campus_name))].sort(), ["Gdańsk", "Gdynia"]);
  assert.ok(programs.every(row => row.currency === "PLN" && row.tuition_fee === 0 && row.application_fee === 85 &&
    row.adaptation_fee === 400 && row.commission_rate === 11 && row.fee_type === "per semester" &&
    row.opens === "2026-09-01" && row.deadline === "2027-03-11" && row.classes_start_on === null));
  assert.equal(programs[0].enrollment_fee, 0);
  assert.equal(programs[1].enrollment_fee, null);
  assert.equal(programs[0].refund_process, cases[0].refundProcess);

  const exportLabels = {
    Program: programs[0].name, University: universityName, Degree: programs[0].degree, Language: programs[0].language,
    "Enrolment Fee": programs[0].enrollment_fee, "Application Fee": programs[0].application_fee,
    "Adaptation Fee": programs[0].adaptation_fee, "Tuition Fee": programs[0].tuition_fee, Currency: programs[0].currency,
    "Refund Process": programs[0].refund_process, "School Period ID": programs[0].university_application_period_id,
    [documentKeys[0]]: "mandatory",
  };
  const roundTrip = workbookRows(Object.keys(exportLabels), [exportLabels]);
  const update = await (await send("/bulk/preview", roundTrip)).json();
  assert.deepEqual(update.summary, { add: 0, update: 1, error: 0 });
  const second = await send("/bulk", roundTrip, update.revision);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).updated, 1);
  const retained = (await pool.query(
    "SELECT tuition_fee, currency, enrollment_fee, adaptation_fee, refund_process, fee_type, finance_notes FROM programs WHERE id=$1",
    [programs[0].id],
  )).rows[0];
  assert.deepEqual(retained, {
    tuition_fee: 0, currency: "PLN", enrollment_fee: 0, adaptation_fee: 400, refund_process: cases[0].refundProcess,
    fee_type: "per semester", finance_notes: "Synthetic private commission note",
  });
  const documents = (await pool.query(
    "SELECT document_type FROM program_document_requirements WHERE program_id=$1 ORDER BY document_type",
    [programs[0].id],
  )).rows;
  assert.deepEqual(documents.map(row => row.document_type), [...documentKeys].sort());
});
