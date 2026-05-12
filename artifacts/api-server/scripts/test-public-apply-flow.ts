/**
 * Public/Embed Apply flow regression test (Task #135).
 *
 * Verifies the lead-first + auto-convert behavior end-to-end against the
 * live api-server (default http://localhost:8080). Two flows tested:
 *
 *   (a) Embed widget — POST /public/embed/:slug/lead then
 *       POST /public/embed/:slug/apply with the same email + leadId.
 *       Expect:
 *         - lead-only call leaves the row at status="new", no student
 *         - full apply auto-converts the lead (status="converted",
 *           convertedStudentId set) and creates a student/application
 *         - student persists ALL AI-extractable fields submitted
 *           (motherName, fatherName, gender, dateOfBirth, passport*,
 *           address, highSchool, graduationYear, gpa, languageScore)
 *
 *   (b) Program-detail public apply — POST /public/lead then
 *       POST /public/apply with the same email + leadId. Same auto-
 *       convert + persistence assertions as the embed flow.
 *
 * Self-seeds its own university/program/widget rows tagged with the
 * RUN_ID so reruns never collide. Cleans up at the end (best-effort).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx ./scripts/test-public-apply-flow.ts
 */
import {
  db,
  universitiesTable,
  programsTable,
  embedWidgetsTable,
  leadsTable,
  studentsTable,
  usersTable,
  applicationsTable,
  documentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const BASE = process.env.API_BASE_URL || "http://localhost:8080";
const RUN_ID = `t135_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

interface Section { name: string; ok: boolean; details: string[] }
function assert(cond: boolean, msg: string, details: string[]): boolean {
  details.push(`${cond ? "OK   " : "FAIL "} ${msg}`);
  return cond;
}

async function setupFixtures() {
  const [uni] = await db.insert(universitiesTable).values({
    name: `T135 Test University ${RUN_ID}`,
    country: "Turkey",
    city: "Istanbul",
    isActive: true,
  } as any).returning();
  const [prog] = await db.insert(programsTable).values({
    universityId: uni.id,
    name: `T135 Test Program ${RUN_ID}`,
    degree: "Bachelor",
    language: "English",
    isActive: true,
  } as any).returning();
  const slug = `t135-widget-${RUN_ID}`;
  const [widget] = await db.insert(embedWidgetsTable).values({
    slug,
    name: `T135 Widget ${RUN_ID}`,
    isActive: true,
    primaryColor: "#000000",
    mode: "combined",
    allowedDomains: [],
  } as any).returning();
  return { uni, prog, widget, slug };
}

async function teardownFixtures(ids: { uniId: number; progId: number; widgetId: number; emails: string[] }) {
  try {
    for (const email of ids.emails) {
      const lc = email.toLowerCase().trim();
      const [u] = await db.select().from(usersTable).where(eq(usersTable.email, lc));
      if (u) {
        await db.delete(applicationsTable).where(eq(applicationsTable.studentId, -1)).catch(() => {});
        const studs = await db.select().from(studentsTable).where(eq(studentsTable.userId, u.id));
        for (const st of studs) {
          await db.delete(documentsTable).where(eq(documentsTable.studentId, st.id)).catch(() => {});
          await db.delete(applicationsTable).where(eq(applicationsTable.studentId, st.id)).catch(() => {});
          await db.delete(studentsTable).where(eq(studentsTable.id, st.id)).catch(() => {});
        }
        await db.delete(usersTable).where(eq(usersTable.id, u.id)).catch(() => {});
      }
      await db.delete(leadsTable).where(eq(leadsTable.email, email)).catch(() => {});
    }
    await db.delete(embedWidgetsTable).where(eq(embedWidgetsTable.id, ids.widgetId)).catch(() => {});
    await db.delete(programsTable).where(eq(programsTable.id, ids.progId)).catch(() => {});
    await db.delete(universitiesTable).where(eq(universitiesTable.id, ids.uniId)).catch(() => {});
  } catch (e) {
    console.warn(`[t135] teardown warning: ${(e as Error).message}`);
  }
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data };
}

function buildFullFields(suffix: string) {
  return {
    motherName: "ANNE TEST",
    fatherName: "BABA TEST",
    gender: "female",
    dateOfBirth: "2000-01-15",
    passportNumber: `T135${suffix}${Date.now().toString(36).slice(-5).toUpperCase()}`,
    passportIssueDate: "2020-06-01",
    passportExpiry: "2030-06-01",
    address: "Test Sokak No 1, Istanbul",
    highSchool: "Test Lisesi",
    graduationYear: 2018,
    gpa: "85",
    languageScore: "IELTS 7.0",
  };
}

async function runEmbedFlow(slug: string): Promise<Section> {
  const details: string[] = [];
  let ok = true;
  const email = `t135-embed-${RUN_ID}@test.local`;
  const FULL_FIELDS = buildFullFields("E");

  // (1) Lead-only step. After this, lead must exist and status=new with
  // NO student record for this email.
  const r1 = await postJson(`${BASE}/api/public/embed/${slug}/lead`, {
    firstName: "EmbedFirst",
    lastName: "EmbedLast",
    email,
    phone: "5551234567",
    countryCode: "+90",
    programName: "T135 Test Program",
    universityName: "T135 Test University",
  });
  ok = assert(r1.status === 201 && !!r1.data?.leadId, `embed /lead returns 201 with leadId (got ${r1.status})`, details) && ok;
  const leadId: number | null = r1.data?.leadId ?? null;

  if (leadId) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    ok = assert(!!lead && lead.status === "new", `lead-only row exists with status="new" (got ${lead?.status})`, details) && ok;
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    ok = assert(!usr, `lead-only step did NOT create a user account`, details) && ok;
  }

  // (2) Full apply with same email + leadId. Lead must be reused
  // (not duplicated), converted, student created with all AI fields.
  const r2 = await postJson(`${BASE}/api/public/embed/${slug}/apply`, {
    firstName: "EmbedFirst",
    lastName: "EmbedLast",
    email,
    phone: "5551234567",
    countryCode: "+90",
    nationality: "Turkey",
    desiredLevel: "Bachelor",
    leadId,
    ...FULL_FIELDS,
  });
  ok = assert(r2.status === 201 && !!r2.data?.success, `embed /apply returns 201 success (got ${r2.status} ${JSON.stringify(r2.data)})`, details) && ok;

  if (leadId) {
    const [leadAfter] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    ok = assert(leadAfter?.status === "converted", `lead auto-converted to status="converted" (got ${leadAfter?.status})`, details) && ok;
    ok = assert(!!leadAfter?.convertedStudentId, `lead.convertedStudentId is set (got ${leadAfter?.convertedStudentId})`, details) && ok;

    if (leadAfter?.convertedStudentId) {
      const [stu] = await db.select().from(studentsTable).where(eq(studentsTable.id, leadAfter.convertedStudentId));
      ok = assert(!!stu, `student row created`, details) && ok;
      if (stu) {
        ok = assert(stu.motherName === FULL_FIELDS.motherName, `student.motherName persisted (got "${stu.motherName}")`, details) && ok;
        ok = assert(stu.fatherName === FULL_FIELDS.fatherName, `student.fatherName persisted (got "${stu.fatherName}")`, details) && ok;
        ok = assert(stu.gender === FULL_FIELDS.gender, `student.gender persisted (got "${stu.gender}")`, details) && ok;
        ok = assert(stu.dateOfBirth === FULL_FIELDS.dateOfBirth, `student.dateOfBirth persisted (got "${stu.dateOfBirth}")`, details) && ok;
        ok = assert(stu.passportNumber === FULL_FIELDS.passportNumber, `student.passportNumber persisted`, details) && ok;
        ok = assert(stu.passportIssueDate === FULL_FIELDS.passportIssueDate, `student.passportIssueDate persisted`, details) && ok;
        ok = assert(stu.passportExpiry === FULL_FIELDS.passportExpiry, `student.passportExpiry persisted`, details) && ok;
        ok = assert(stu.address === FULL_FIELDS.address, `student.address persisted`, details) && ok;
        ok = assert(stu.highSchool === FULL_FIELDS.highSchool, `student.highSchool persisted`, details) && ok;
        ok = assert(stu.graduationYear === FULL_FIELDS.graduationYear, `student.graduationYear persisted (got ${stu.graduationYear})`, details) && ok;
        ok = assert(stu.gpa === FULL_FIELDS.gpa, `student.gpa persisted (got "${stu.gpa}")`, details) && ok;
        ok = assert(stu.languageScore === FULL_FIELDS.languageScore, `student.languageScore persisted (got "${stu.languageScore}")`, details) && ok;
      }
    }
  }

  return { name: "(a) Embed widget lead-first + full submit", ok, details };
}

async function runPublicApplyFlow(progId: number): Promise<Section> {
  const details: string[] = [];
  let ok = true;
  const email = `t135-pub-${RUN_ID}@test.local`;
  const FULL_FIELDS = buildFullFields("P");

  // (1) Lead-only step.
  const r1 = await postJson(`${BASE}/api/public/lead`, {
    firstName: "PubFirst",
    lastName: "PubLast",
    email,
    phone: "+905557654321",
    interestedProgram: "T135 Test Program",
    interestedCountry: "Turkey",
  });
  ok = assert(r1.status === 201 && !!r1.data?.leadId, `public /lead returns 201 with leadId (got ${r1.status})`, details) && ok;
  const leadId: number | null = r1.data?.leadId ?? null;

  if (leadId) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    ok = assert(!!lead && lead.status === "new", `lead-only row status="new" (got ${lead?.status})`, details) && ok;
    const [usr] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    ok = assert(!usr, `lead-only step did NOT create user account`, details) && ok;
  }

  // (2) Full apply.
  const r2 = await postJson(`${BASE}/api/public/apply`, {
    firstName: "PubFirst",
    lastName: "PubLast",
    email,
    phone: "5557654321",
    phoneCode: "+90",
    nationality: "Turkey",
    programId: progId,
    programName: "T135 Test Program",
    universityName: "T135 Test University",
    leadId,
    ...FULL_FIELDS,
  });
  ok = assert(r2.status === 201 || r2.status === 200, `public /apply success (got ${r2.status} ${JSON.stringify(r2.data).slice(0,200)})`, details) && ok;

  if (leadId) {
    const [leadAfter] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    ok = assert(leadAfter?.status === "converted", `lead auto-converted to "converted" (got ${leadAfter?.status})`, details) && ok;
    ok = assert(!!leadAfter?.convertedStudentId, `lead.convertedStudentId set`, details) && ok;

    if (leadAfter?.convertedStudentId) {
      const [stu] = await db.select().from(studentsTable).where(eq(studentsTable.id, leadAfter.convertedStudentId));
      ok = assert(!!stu, `student row created`, details) && ok;
      if (stu) {
        ok = assert(stu.motherName === FULL_FIELDS.motherName, `student.motherName persisted (got "${stu.motherName}")`, details) && ok;
        ok = assert(stu.fatherName === FULL_FIELDS.fatherName, `student.fatherName persisted (got "${stu.fatherName}")`, details) && ok;
        ok = assert(stu.gender === FULL_FIELDS.gender, `student.gender persisted (got "${stu.gender}")`, details) && ok;
        ok = assert(stu.dateOfBirth === FULL_FIELDS.dateOfBirth, `student.dateOfBirth persisted (got "${stu.dateOfBirth}")`, details) && ok;
        ok = assert(stu.passportNumber === FULL_FIELDS.passportNumber, `student.passportNumber persisted`, details) && ok;
        ok = assert(stu.passportIssueDate === FULL_FIELDS.passportIssueDate, `student.passportIssueDate persisted (got "${stu.passportIssueDate}")`, details) && ok;
        ok = assert(stu.passportExpiry === FULL_FIELDS.passportExpiry, `student.passportExpiry persisted (got "${stu.passportExpiry}")`, details) && ok;
        ok = assert(stu.address === FULL_FIELDS.address, `student.address persisted (got "${stu.address}")`, details) && ok;
        ok = assert(stu.highSchool === FULL_FIELDS.highSchool, `student.highSchool persisted (got "${stu.highSchool}")`, details) && ok;
        ok = assert(stu.graduationYear === FULL_FIELDS.graduationYear, `student.graduationYear persisted (got ${stu.graduationYear})`, details) && ok;
        ok = assert(stu.gpa === FULL_FIELDS.gpa, `student.gpa persisted (got "${stu.gpa}")`, details) && ok;
        ok = assert(stu.languageScore === FULL_FIELDS.languageScore, `student.languageScore persisted (got "${stu.languageScore}")`, details) && ok;
      }
    }
  }

  return { name: "(b) Public-apply lead-first + full submit", ok, details };
}

/**
 * (c) Gender normalization: AI extraction can return "F", "Female",
 * "M", "Male", or stray values. embed.ts handleAnalyze + Programs.tsx
 * mergeAiData must normalize to the canonical "female"/"male" tokens
 * that students.gender accepts; unknown values must be dropped (i.e.
 * never leak through to the column). We exercise the embed /apply
 * route directly with each variant and verify the persisted column.
 */
async function runGenderNormalizationFlow(slug: string): Promise<Section> {
  const details: string[] = [];
  let ok = true;
  const variants: Array<{ input: string; expected: string | null; label: string }> = [
    { input: "female", expected: "female", label: "canonical female" },
    { input: "male",   expected: "male",   label: "canonical male" },
    { input: "Female", expected: "female", label: "Female title-case" },
    { input: "Male",   expected: "male",   label: "Male title-case" },
    { input: "FEMALE", expected: "female", label: "uppercase FEMALE" },
  ];
  // The embed /apply route lowercases gender and only accepts the two
  // canonical tokens; anything else is coerced to NULL on the student
  // row (see embed.ts ~L645 normalizedGender / safeGender). Frontend
  // mergeAiData layers do the same on the AI extraction path, so any
  // stray AI variant either lands as canonical or doesn't pollute the
  // column. We assert both halves: canonical values persist exactly,
  // unknown values surface as NULL (never silently mis-mapped).
  for (const v of variants) {
    const email = `t135-gn-${RUN_ID}-${v.input}@test.local`;
    const r = await postJson(`${BASE}/api/public/embed/${slug}/apply`, {
      firstName: "GN", lastName: "Test", email,
      phone: "5550000000", countryCode: "+90",
      nationality: "Turkey", desiredLevel: "Bachelor",
      gender: v.input,
      passportNumber: `T135GN${v.label.replace(/\s/g,"").toUpperCase()}${Date.now().toString(36).slice(-4)}`,
    });
    ok = assert(r.status === 201, `apply with gender="${v.input}" (${v.label}) -> 201 (got ${r.status})`, details) && ok;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    if (u) {
      const [stu] = await db.select().from(studentsTable).where(eq(studentsTable.userId, u.id));
      ok = assert(stu?.gender === v.expected, `gender "${v.input}" persisted as "${v.expected}" (got "${stu?.gender}")`, details) && ok;
    }
  }
  // Unknown variant must be coerced to NULL on the student row, NOT
  // mis-mapped to "female"/"male". Apply still succeeds (other fields
  // are valid); we just verify the column ends up null.
  const badEmail = `t135-gn-${RUN_ID}-bad@test.local`;
  const rBad = await postJson(`${BASE}/api/public/embed/${slug}/apply`, {
    firstName: "GN", lastName: "Bad", email: badEmail,
    phone: "5550000000", countryCode: "+90",
    nationality: "Turkey", desiredLevel: "Bachelor",
    gender: "Other",
    passportNumber: `T135GNBAD${Date.now().toString(36).slice(-4)}`,
  });
  ok = assert(rBad.status === 201, `apply with gender="Other" still succeeds (got ${rBad.status})`, details) && ok;
  const [uBad] = await db.select().from(usersTable).where(eq(usersTable.email, badEmail.toLowerCase()));
  if (uBad) {
    const [stuBad] = await db.select().from(studentsTable).where(eq(studentsTable.userId, uBad.id));
    ok = assert(stuBad?.gender === null, `unknown gender coerced to NULL (got "${stuBad?.gender}")`, details) && ok;
  }

  return { name: "(c) Gender normalization variants", ok, details };
}

async function main() {
  console.log(`[t135] starting run ${RUN_ID} against ${BASE}`);
  // Wait briefly for api-server to be ready.
  let ready = false;
  for (let i = 0; i < 15; i++) {
    try {
      const r = await fetch(`${BASE}/api/public/embed/__nope__/config`);
      if (r.status === 404 || r.status === 200) { ready = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) {
    console.error(`[t135] api-server at ${BASE} did not respond — is the workflow running?`);
    process.exit(2);
  }

  const fx = await setupFixtures();
  const usedEmails: string[] = [
    `t135-embed-${RUN_ID}@test.local`,
    `t135-pub-${RUN_ID}@test.local`,
    `t135-gn-${RUN_ID}-female@test.local`,
    `t135-gn-${RUN_ID}-male@test.local`,
    `t135-gn-${RUN_ID}-Female@test.local`,
    `t135-gn-${RUN_ID}-Male@test.local`,
    `t135-gn-${RUN_ID}-FEMALE@test.local`,
    `t135-gn-${RUN_ID}-bad@test.local`,
  ];
  const sections: Section[] = [];
  try {
    sections.push(await runEmbedFlow(fx.slug));
    sections.push(await runPublicApplyFlow(fx.prog.id));
    sections.push(await runGenderNormalizationFlow(fx.slug));
  } finally {
    await teardownFixtures({ uniId: fx.uni.id, progId: fx.prog.id, widgetId: fx.widget.id, emails: usedEmails });
  }

  let allOk = true;
  for (const s of sections) {
    console.log(`\n=== ${s.name} ${s.ok ? "PASS" : "FAIL"} ===`);
    for (const d of s.details) console.log(`  ${d}`);
    if (!s.ok) allOk = false;
  }
  console.log(`\n[t135] ${allOk ? "PASS" : "FAIL"} (run ${RUN_ID})`);
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error(`[t135] crashed:`, err);
  process.exit(2);
});
