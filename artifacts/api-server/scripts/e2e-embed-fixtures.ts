/**
 * Playwright e2e fixtures for the embed widget apply form tests.
 *
 * Idempotently ensures the database has:
 *   - A test university (well-known name)
 *   - At least one active program belonging to that university
 *   - An active embed widget with a well-known slug, mode=combined, and
 *     no allowedDomains restriction so it can be loaded from any host page.
 *
 * The IDs of any rows created here are written to e2e-embed-state.json at the
 * project root. The teardown script (e2e-embed-fixtures-teardown.ts) reads
 * that file to clean up only the rows it created, leaving any pre-existing
 * data alone.
 *
 * Run via playwright globalSetup (see playwright-global-setup.ts).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  db,
  universitiesTable,
  programsTable,
  embedWidgetsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export const EMBED_TEST_SLUG = "e2e-embed-test";
export const EMBED_TEST_UNIVERSITY = "E2E Embed Test University";
export const EMBED_TEST_PROGRAM = "E2E Embed Test Program";

const stateFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../e2e-embed-state.json",
);

interface EmbedFixtureState {
  createdUniversityId: number | null;
  createdProgramId: number | null;
  createdWidgetId: number | null;
  priorProgramIsActive: boolean | null;
  priorProgramId: number | null;
  priorWidgetSnapshot: Record<string, unknown> | null;
}

async function main() {
  const state: EmbedFixtureState = {
    createdUniversityId: null,
    createdProgramId: null,
    createdWidgetId: null,
    priorProgramIsActive: null,
    priorProgramId: null,
    priorWidgetSnapshot: null,
  };

  const [existingUni] = await db
    .select()
    .from(universitiesTable)
    .where(eq(universitiesTable.name, EMBED_TEST_UNIVERSITY));

  let universityId: number;
  if (existingUni) {
    universityId = existingUni.id;
    console.log(`[e2e-embed-setup] Reusing university id=${universityId}`);
  } else {
    const [created] = await db
      .insert(universitiesTable)
      .values({
        name: EMBED_TEST_UNIVERSITY,
        country: "United Kingdom",
        city: "London",
        isActive: true,
        universityType: "Public",
      })
      .returning();
    universityId = created.id;
    state.createdUniversityId = universityId;
    console.log(`[e2e-embed-setup] Created university id=${universityId}`);
  }

  const existingProgs = await db
    .select()
    .from(programsTable)
    .where(eq(programsTable.universityId, universityId));
  const existingTestProg = existingProgs.find((p) => p.name === EMBED_TEST_PROGRAM);

  let programId: number;
  if (existingTestProg) {
    programId = existingTestProg.id;
    state.priorProgramId = programId;
    state.priorProgramIsActive = existingTestProg.isActive ?? null;
    if (!existingTestProg.isActive) {
      await db
        .update(programsTable)
        .set({ isActive: true })
        .where(eq(programsTable.id, programId));
      console.log(`[e2e-embed-setup] Reusing program id=${programId} (forced isActive=true)`);
    } else {
      console.log(`[e2e-embed-setup] Reusing program id=${programId}`);
    }
  } else {
    const [created] = await db
      .insert(programsTable)
      .values({
        universityId,
        name: EMBED_TEST_PROGRAM,
        degree: "Bachelor",
        field: "Computer Science",
        language: "English",
        duration: "4 years",
        tuitionFee: 12000,
        currency: "USD",
        intakes: "Fall",
        isActive: true,
      })
      .returning();
    programId = created.id;
    state.createdProgramId = programId;
    console.log(`[e2e-embed-setup] Created program id=${programId}`);
  }

  const [existingWidget] = await db
    .select()
    .from(embedWidgetsTable)
    .where(eq(embedWidgetsTable.slug, EMBED_TEST_SLUG));

  let widgetId: number;
  if (existingWidget) {
    widgetId = existingWidget.id;
    state.priorWidgetSnapshot = {
      isActive: existingWidget.isActive,
      mode: existingWidget.mode,
      presetFilters: existingWidget.presetFilters,
      lockedFilters: existingWidget.lockedFilters,
      hiddenFilters: existingWidget.hiddenFilters,
      visibleFilters: existingWidget.visibleFilters,
      theme: existingWidget.theme,
      allowedDomains: existingWidget.allowedDomains,
    };
    await db
      .update(embedWidgetsTable)
      .set({
        isActive: true,
        mode: "combined",
        presetFilters: {},
        lockedFilters: [],
        hiddenFilters: [],
        visibleFilters: [],
        theme: {},
        allowedDomains: [],
      })
      .where(eq(embedWidgetsTable.id, widgetId));
    console.log(`[e2e-embed-setup] Reused widget id=${widgetId} (snapshot saved, reset config)`);
  } else {
    const [created] = await db
      .insert(embedWidgetsTable)
      .values({
        name: "E2E Embed Test Widget",
        slug: EMBED_TEST_SLUG,
        mode: "combined",
        presetFilters: {},
        lockedFilters: [],
        hiddenFilters: [],
        visibleFilters: [],
        theme: {},
        allowedDomains: [],
        isActive: true,
      })
      .returning();
    widgetId = created.id;
    state.createdWidgetId = widgetId;
    console.log(`[e2e-embed-setup] Created widget id=${widgetId}`);
  }

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e-embed-setup] error:", err);
  process.exit(1);
});
