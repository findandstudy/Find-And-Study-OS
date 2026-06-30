/**
 * programMappingLoader.ts — loads panel-managed mapping data from
 * portal_program_mapping and shapes it into the optional SubmitProfile fields
 * consumed by the adapters.
 *
 * Single source of truth: the adapter keeps its built-in code defaults as a
 * fallback; whatever this loader returns is merged OVER those defaults by the
 * adapter (DB wins). When no row exists (or the columns are empty) every field
 * is omitted, so the adapter behaves exactly as before — no prod change.
 */

import { db, portalProgramMappingTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export interface ProgramMappingData {
  /** CRM programId → portal option value/text. */
  programOverrides?: Record<string, string>;
  /** EN↔TR synonym equivalence groups (folded single tokens). */
  programSynonyms?: string[][];
  /** Country name/adjective (lowercase) → portal label. */
  countryOverrides?: Record<string, string>;
}

/**
 * Fetch the mapping row for a university and return only the populated fields.
 * Never throws — on any DB error returns {} so the adapter falls back to its
 * built-in defaults (the submission must not fail because the table is missing).
 */
export async function loadProgramMapping(
  universityKey: string,
  memberUniversityId: number | null = null,
): Promise<ProgramMappingData> {
  try {
    // memberUniversityId null → 1:1 row (member_university_id IS NULL), today's
    // behaviour. Non-null → the multi-portal account's row for that member.
    const memberCondition =
      memberUniversityId == null
        ? isNull(portalProgramMappingTable.memberUniversityId)
        : eq(portalProgramMappingTable.memberUniversityId, memberUniversityId);
    const [row] = await db
      .select({
        programOverrides: portalProgramMappingTable.programOverrides,
        synonyms:         portalProgramMappingTable.synonyms,
        countryOverrides: portalProgramMappingTable.countryOverrides,
      })
      .from(portalProgramMappingTable)
      .where(
        and(
          eq(portalProgramMappingTable.universityKey, universityKey),
          memberCondition,
        ),
      );

    if (!row) return {};

    const out: ProgramMappingData = {};
    if (row.programOverrides && Object.keys(row.programOverrides).length > 0) {
      out.programOverrides = row.programOverrides;
    }
    if (Array.isArray(row.synonyms) && row.synonyms.length > 0) {
      out.programSynonyms = row.synonyms;
    }
    if (row.countryOverrides && Object.keys(row.countryOverrides).length > 0) {
      out.countryOverrides = row.countryOverrides;
    }
    return out;
  } catch {
    return {};
  }
}
