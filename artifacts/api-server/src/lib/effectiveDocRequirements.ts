import {
  db,
  programDocumentRequirementsTable,
  degreeDocumentRequirementsTable,
  catalogOptionsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface EffectiveDocRequirement {
  documentType: string;
  mandatory: boolean;
  sortOrder: number;
  source: "program" | "degree";
}

/**
 * SINGLE SOURCE OF TRUTH for the document requirements that apply to an
 * application. Merges program-level requirements (when a programId is known)
 * with degree-level requirements (when a study level is known), deduplicated
 * by documentType. If either source marks a type mandatory, it is mandatory.
 *
 * The POST /applications mandatory-doc gate and every UI list (Inbox
 * DOCUMENTS tab, Add-popup, APPLICATION pre-warning) must derive from this
 * helper so they can never disagree.
 */
export async function getEffectiveDocRequirements(opts: {
  programId?: number | null;
  level?: string | null;
}): Promise<EffectiveDocRequirement[]> {
  const programId =
    opts.programId != null && Number.isFinite(Number(opts.programId))
      ? Number(opts.programId)
      : null;
  const level = (opts.level || "").trim() || null;

  const [programReqs, degreeOptRows] = await Promise.all([
    programId
      ? db
          .select({
            documentType: programDocumentRequirementsTable.documentType,
            mandatory: programDocumentRequirementsTable.mandatory,
            sortOrder: programDocumentRequirementsTable.sortOrder,
          })
          .from(programDocumentRequirementsTable)
          .where(eq(programDocumentRequirementsTable.programId, programId))
      : Promise.resolve([] as { documentType: string; mandatory: boolean; sortOrder: number }[]),
    level
      ? db
          .select({ id: catalogOptionsTable.id })
          .from(catalogOptionsTable)
          .where(and(
            eq(catalogOptionsTable.category, "degree"),
            eq(catalogOptionsTable.value, level),
          ))
      : Promise.resolve([] as { id: number }[]),
  ]);

  const degreeOpt = degreeOptRows[0] ?? null;
  const degreeReqs = degreeOpt
    ? await db
        .select({
          documentType: degreeDocumentRequirementsTable.documentType,
          mandatory: degreeDocumentRequirementsTable.mandatory,
          sortOrder: degreeDocumentRequirementsTable.sortOrder,
        })
        .from(degreeDocumentRequirementsTable)
        .where(eq(degreeDocumentRequirementsTable.catalogOptionId, degreeOpt.id))
    : [];

  const merged = new Map<string, EffectiveDocRequirement>();
  for (const r of degreeReqs) {
    const key = r.documentType.toLowerCase();
    merged.set(key, {
      documentType: r.documentType,
      mandatory: r.mandatory,
      sortOrder: r.sortOrder,
      source: "degree",
    });
  }
  for (const r of programReqs) {
    const key = r.documentType.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      // Program entry refines the degree entry; mandatory if either says so.
      merged.set(key, {
        ...existing,
        mandatory: existing.mandatory || r.mandatory,
        source: "program",
      });
    } else {
      merged.set(key, {
        documentType: r.documentType,
        mandatory: r.mandatory,
        sortOrder: 1000 + r.sortOrder, // program-only extras after degree ordering
        source: "program",
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.sortOrder - b.sortOrder || a.documentType.localeCompare(b.documentType),
  );
}

/** Mandatory documentType list from an effective requirements set. */
export function mandatoryDocTypes(reqs: EffectiveDocRequirement[]): string[] {
  return reqs.filter((r) => r.mandatory).map((r) => r.documentType);
}
