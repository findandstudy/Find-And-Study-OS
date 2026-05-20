import { db, leadsTable, type Lead } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { applyLeadAssignmentRules } from "./leadAssignment";

export interface EmbedLeadFields {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  nationality?: string | null;
  interestedProgram?: string | null;
  interestedCountry?: string | null;
  notes?: string | null;
  sourcePageUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;

function nonEmpty(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Merge update payload: only overwrite columns when the incoming value is
 * a non-empty string. Preserves prior assignment, status, agent and any
 * data populated by earlier submissions.
 */
function buildUpdatePatch(fields: EmbedLeadFields): Partial<typeof leadsTable.$inferInsert> {
  const patch: Partial<typeof leadsTable.$inferInsert> = {};
  const fn = nonEmpty(fields.firstName);
  const ln = nonEmpty(fields.lastName);
  const em = nonEmpty(fields.email);
  if (fn) patch.firstName = fn;
  if (ln) patch.lastName = ln;
  if (em) patch.email = em;
  if (nonEmpty(fields.phone)) patch.phone = fields.phone as string;
  if (nonEmpty(fields.nationality)) patch.nationality = fields.nationality as string;
  if (nonEmpty(fields.interestedProgram)) patch.interestedProgram = fields.interestedProgram as string;
  if (nonEmpty(fields.interestedCountry)) patch.interestedCountry = fields.interestedCountry as string;
  if (nonEmpty(fields.notes)) patch.notes = fields.notes as string;
  if (nonEmpty(fields.sourcePageUrl)) patch.sourcePageUrl = fields.sourcePageUrl as string;
  if (nonEmpty(fields.utmSource)) patch.utmSource = fields.utmSource as string;
  if (nonEmpty(fields.utmMedium)) patch.utmMedium = fields.utmMedium as string;
  if (nonEmpty(fields.utmCampaign)) patch.utmCampaign = fields.utmCampaign as string;
  if (nonEmpty(fields.utmTerm)) patch.utmTerm = fields.utmTerm as string;
  if (nonEmpty(fields.utmContent)) patch.utmContent = fields.utmContent as string;
  return patch;
}

/**
 * Find an existing widget lead for (lower(email), embed:<slug>) and reuse
 * it, or insert a new one. Dedup is global per (email, source) — matching
 * the partial unique index `leads_embed_email_source_uniq` installed by
 * the cleanup migration. When an existing row is reused only non-empty
 * incoming fields overwrite stored values; status, assignedToId and
 * agentId are left untouched. Lead assignment rules are only invoked on
 * a brand-new insert — re-running them on every submission would let a
 * refresh re-route the lead to a different staff member.
 *
 * Race-safe: if the partial unique index rejects a concurrent insert
 * (23505) we re-select the winning row and update it.
 */
export async function findOrUpsertEmbedLead(opts: {
  slug: string;
  fields: EmbedLeadFields;
  ip?: string;
  tx?: DbLike;
}): Promise<{ lead: Lead; created: boolean }> {
  const conn: DbLike = opts.tx ?? db;
  const source = `embed:${opts.slug}`;
  const emailNorm = String(opts.fields.email || "").toLowerCase().trim();
  if (!emailNorm) {
    throw new Error("findOrUpsertEmbedLead: email is required");
  }
  const existing = await conn.select().from(leadsTable).where(
    and(
      sql`lower(${leadsTable.email}) = ${emailNorm}`,
      eq(leadsTable.source, source),
      isNull(leadsTable.deletedAt),
    ),
  ).orderBy(desc(leadsTable.createdAt)).limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const patch = buildUpdatePatch(opts.fields);
    if (Object.keys(patch).length === 0) {
      return { lead: row, created: false };
    }
    const [updated] = await conn.update(leadsTable).set(patch).where(eq(leadsTable.id, row.id)).returning();
    return { lead: updated ?? row, created: false };
  }

  try {
    const [inserted] = await conn.insert(leadsTable).values({
      firstName: String(opts.fields.firstName),
      lastName: String(opts.fields.lastName),
      email: emailNorm,
      phone: opts.fields.phone ?? null,
      nationality: opts.fields.nationality ?? null,
      source,
      status: "new",
      interestedProgram: opts.fields.interestedProgram ?? null,
      interestedCountry: opts.fields.interestedCountry ?? null,
      notes: opts.fields.notes ?? null,
      sourcePageUrl: opts.fields.sourcePageUrl ?? null,
      utmSource: opts.fields.utmSource ?? null,
      utmMedium: opts.fields.utmMedium ?? null,
      utmCampaign: opts.fields.utmCampaign ?? null,
      utmTerm: opts.fields.utmTerm ?? null,
      utmContent: opts.fields.utmContent ?? null,
    }).returning();
    if (inserted && !opts.tx) {
      await applyLeadAssignmentRules(inserted, opts.ip);
    } else if (inserted && opts.tx) {
      // Apply rules after the caller's transaction commits so we don't
      // hold row locks during external work.
      queueMicrotask(() => { applyLeadAssignmentRules(inserted, opts.ip).catch(() => {}); });
    }
    return { lead: inserted, created: true };
  } catch (err: any) {
    // 23505 = unique_violation. Another concurrent request inserted the
    // same (lower(email), source) row first; re-select and update it.
    if (err && (err.code === "23505" || /duplicate key|unique/i.test(err.message || ""))) {
      const [reFound] = await conn.select().from(leadsTable).where(
        and(
          sql`lower(${leadsTable.email}) = ${emailNorm}`,
          eq(leadsTable.source, source),
          isNull(leadsTable.deletedAt),
        ),
      ).orderBy(desc(leadsTable.createdAt)).limit(1);
      if (reFound) {
        const patch = buildUpdatePatch(opts.fields);
        if (Object.keys(patch).length === 0) {
          return { lead: reFound, created: false };
        }
        const [updated] = await conn.update(leadsTable).set(patch).where(eq(leadsTable.id, reFound.id)).returning();
        return { lead: updated ?? reFound, created: false };
      }
    }
    throw err;
  }
}
