import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkBulkImportRows,
  findProgramIdentityCollisions,
} from "../src/lib/catalogBulkImport";

const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

test("chunks rows without exceeding byte or row ceilings", () => {
  const rows = Array.from({ length: 11 }, (_, id) => ({ id, name: `Program ${id}` }));
  const chunks = chunkBulkImportRows(rows, { maxBytes: 100, maxRows: 3 });

  assert.deepEqual(chunks.flat(), rows);
  assert.ok(chunks.every((chunk) => chunk.length <= 3));
  assert.ok(chunks.every((chunk) => encodedBytes(chunk) <= 100));
});

test("uses UTF-8 byte size rather than JavaScript character count", () => {
  const rows = [{ name: "İstanbul Üniversitesi 🎓" }, { name: "短期大学" }];
  const exactSize = encodedBytes(rows);

  assert.equal(chunkBulkImportRows(rows, { maxBytes: exactSize, maxRows: 10 }).length, 1);
  assert.equal(chunkBulkImportRows(rows, { maxBytes: exactSize - 1, maxRows: 10 }).length, 2);
});

test("rejects a row that cannot fit in one safe request", () => {
  assert.throws(
    () => chunkBulkImportRows([{ value: "x".repeat(100) }], { maxBytes: 20 }),
    /single import row exceeds/i,
  );
});

test("detects importer identity collisions case-insensitively", () => {
  const report = findProgramIdentityCollisions([
    { universityName: "Example University", name: "Computer Science", degree: "Master", language: "English" },
    { University: " example university ", Program: "COMPUTER SCIENCE", Degree: "master", Language: "english" },
    { universityName: "Example University", name: "Business", degree: "Bachelor", language: "English" },
    { universityName: "Example University", name: "Computer Science", degree: "Master", language: "English" },
  ]);

  assert.equal(report.groups, 1);
  assert.equal(report.extraRows, 2);
  assert.deepEqual(report.sampleRows, [
    { firstRow: 2, duplicateRow: 3 },
    { firstRow: 2, duplicateRow: 5 },
  ]);
});

test("keeps different degree or language variants distinct", () => {
  const report = findProgramIdentityCollisions([
    { universityName: "Example University", name: "Business", degree: "Bachelor", language: "English" },
    { universityName: "Example University", name: "Business", degree: "Master", language: "English" },
    { universityName: "Example University", name: "Business", degree: "Bachelor", language: "Turkish" },
  ]);

  assert.deepEqual(report, { groups: 0, extraRows: 0, sampleRows: [] });
});
