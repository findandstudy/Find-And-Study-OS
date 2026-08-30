import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const apiSource = await readFile(new URL("../src/routes/finance.ts", import.meta.url), "utf8");
const uiSource = await readFile(new URL("../../edcons/src/pages/staff/Finance.tsx", import.meta.url), "utf8");

test("university breakdown and export use confirmed lifecycle states only", () => {
  const confirmedSql = "IN ('confirmed', 'collected_partial', 'collected_full', 'settled')";
  assert.ok(apiSource.includes(`const CONFIRMED_COMMISSION_STATUSES = [\"confirmed\", \"collected_partial\", \"collected_full\", \"settled\"]`));
  assert.ok(apiSource.split(confirmedSql).length >= 4, "confirmed-only SQL must protect breakdown, receivables, and exports");
  assert.match(apiSource, /router\.get\("\/finance\/university-breakdown"[\s\S]*?totalsByCurrency/);
});

test("reconciliation data includes passport, programme, student expansion, and two-sheet Excel", () => {
  assert.match(apiSource, /passportNumber:\s*studentsTable\.passportNumber/);
  assert.match(apiSource, /programName:\s*linkedApplication\?\.programName\s*\|\|\s*c\.programName/);
  assert.match(apiSource, /name:\s*"Confirmed Students"/);
  assert.match(uiSource, /Passport number/);
  assert.match(uiSource, /Export students/);
  assert.match(uiSource, /expandedUniversities/);
});

test("row transactions parse dates, cap remaining balance, and recompute commission totals", () => {
  assert.match(apiSource, /const parsedDate = new Date\(transactionDate\)/);
  assert.match(apiSource, /Amount exceeds remaining balance/);
  assert.match(apiSource, /await recalculateCommissionFinancials\(parsedCommissionId\)/);
  assert.match(apiSource, /transactionDate:\s*parsedDate/);
});

test("new service fees require an authoritative student/application link", () => {
  assert.match(apiSource, /A linked student and application are required/);
  assert.match(apiSource, /The selected application does not belong to this student/);
  assert.match(apiSource, /agentId:\s*application\.agentId/);
  assert.match(uiSource, /finance-student-apps/);
  assert.match(uiSource, /Select a student and application/);
});

test("finance UI shows agency names and confirmed cash-flow additions", () => {
  assert.match(uiSource, /agent\?\.companyName[\s\S]*agent\?\.businessName/);
  assert.match(uiSource, /Service Fee Income/);
  assert.match(uiSource, /financePage\.subAgentPaid/);
  assert.doesNotMatch(
    uiSource,
    /totalSubAgentCommission\)\s*>\s*0\s*&&\s*\([\s\S]{0,500}financePage\.subAgentPaid/,
    "Sub Agent Paid must remain visible even when its confirmed amount is zero",
  );
  assert.match(uiSource, /studentsCount", \{ count: u\.studentCount \}/);
});
