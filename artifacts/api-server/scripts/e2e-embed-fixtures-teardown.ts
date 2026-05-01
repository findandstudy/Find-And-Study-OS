/**
 * Playwright e2e teardown for embed widget fixtures.
 *
 * Reads e2e-embed-state.json (written by e2e-embed-fixtures.ts) and removes
 * only the rows that the setup script created. Pre-existing rows that the
 * setup script reused are left untouched.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  db,
  universitiesTable,
  programsTable,
  embedWidgetsTable,
  embedSubmissionsTable,
  leadsTable,
  documentsTable,
} from "@workspace/db";
import { eq, like, and } from "drizzle-orm";

const stateFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../e2e-embed-state.json",
);

interface EmbedFixtureState {
  createdUniversityId: number | null;
  createdProgramId: number | null;
  createdWidgetId: number | null;
  createdAllowlistWidgetId: number | null;
  priorProgramIsActive: boolean | null;
  priorProgramId: number | null;
  priorWidgetSnapshot: Record<string, unknown> | null;
  priorAllowlistWidgetSnapshot: Record<string, unknown> | null;
}

const ALLOWLIST_SLUG = "e2e-embed-test-allowlist";

async function main() {
  if (!fs.existsSync(stateFile)) {
    console.log("[e2e-embed-teardown] No saved state — skipping");
    process.exit(0);
  }

  const raw = fs.readFileSync(stateFile, "utf8");
  const state = JSON.parse(raw) as EmbedFixtureState;
  fs.unlinkSync(stateFile);

  const widgetIds: number[] = [];
  const submissionLeadIds: number[] = [];

  if (state.createdWidgetId != null) {
    widgetIds.push(state.createdWidgetId);
  } else {
    const widgets = await db
      .select()
      .from(embedWidgetsTable)
      .where(eq(embedWidgetsTable.slug, "e2e-embed-test"));
    widgets.forEach((w) => widgetIds.push(w.id));
  }

  for (const wid of widgetIds) {
    const subs = await db
      .select()
      .from(embedSubmissionsTable)
      .where(eq(embedSubmissionsTable.widgetId, wid));
    for (const s of subs) {
      if (s.leadId != null) submissionLeadIds.push(s.leadId);
    }
  }

  for (const leadId of submissionLeadIds) {
    try {
      await db.delete(documentsTable).where(eq(documentsTable.leadId, leadId));
    } catch {}
  }

  if (widgetIds.length > 0 && state.createdWidgetId != null) {
    await db.delete(embedWidgetsTable).where(eq(embedWidgetsTable.id, state.createdWidgetId));
    console.log(`[e2e-embed-teardown] Deleted widget id=${state.createdWidgetId}`);
  } else if (widgetIds.length > 0) {
    for (const wid of widgetIds) {
      try {
        await db.delete(embedSubmissionsTable).where(eq(embedSubmissionsTable.widgetId, wid));
      } catch {}
    }
  }

  for (const leadId of submissionLeadIds) {
    try {
      await db.delete(leadsTable).where(and(eq(leadsTable.id, leadId), like(leadsTable.source, "embed:%")));
    } catch {}
  }

  if (state.createdWidgetId == null && state.priorWidgetSnapshot != null) {
    await db
      .update(embedWidgetsTable)
      .set(state.priorWidgetSnapshot as Partial<typeof embedWidgetsTable.$inferInsert>)
      .where(eq(embedWidgetsTable.slug, "e2e-embed-test"));
    console.log("[e2e-embed-teardown] Restored prior widget config for slug=e2e-embed-test");
  }

  // Allowlist widget: same pattern — delete if we created it, otherwise
  // restore the snapshot we saved at setup time.
  if (state.createdAllowlistWidgetId != null) {
    try {
      await db
        .delete(embedSubmissionsTable)
        .where(eq(embedSubmissionsTable.widgetId, state.createdAllowlistWidgetId));
    } catch {}
    await db
      .delete(embedWidgetsTable)
      .where(eq(embedWidgetsTable.id, state.createdAllowlistWidgetId));
    console.log(
      `[e2e-embed-teardown] Deleted allowlist widget id=${state.createdAllowlistWidgetId}`,
    );
  } else if (state.priorAllowlistWidgetSnapshot != null) {
    await db
      .update(embedWidgetsTable)
      .set(state.priorAllowlistWidgetSnapshot as Partial<typeof embedWidgetsTable.$inferInsert>)
      .where(eq(embedWidgetsTable.slug, ALLOWLIST_SLUG));
    console.log(
      `[e2e-embed-teardown] Restored prior widget config for slug=${ALLOWLIST_SLUG}`,
    );
  }

  if (state.createdProgramId != null) {
    await db.delete(programsTable).where(eq(programsTable.id, state.createdProgramId));
    console.log(`[e2e-embed-teardown] Deleted program id=${state.createdProgramId}`);
  } else if (
    state.priorProgramId != null &&
    state.priorProgramIsActive === false
  ) {
    await db
      .update(programsTable)
      .set({ isActive: false })
      .where(eq(programsTable.id, state.priorProgramId));
    console.log(`[e2e-embed-teardown] Restored program id=${state.priorProgramId} isActive=false`);
  }

  if (state.createdUniversityId != null) {
    await db.delete(universitiesTable).where(eq(universitiesTable.id, state.createdUniversityId));
    console.log(`[e2e-embed-teardown] Deleted university id=${state.createdUniversityId}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e-embed-teardown] error:", err);
  process.exit(1);
});
