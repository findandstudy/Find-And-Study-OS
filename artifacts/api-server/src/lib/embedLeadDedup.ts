import { db, type Lead } from "@workspace/db";
import { findOrUpsertPublicLead, type LeadDedupFields } from "./leadDedup";

export type EmbedLeadFields = LeadDedupFields;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | Tx;

/**
 * Thin wrapper preserving the Task #168 call shape. Delegates to the
 * generic public-lead dedup helper with `source = "embed:<slug>"` and
 * `uniqueKey = emailSource`. Existing callers in `routes/embed.ts` keep
 * their signature.
 */
export async function findOrUpsertEmbedLead(opts: {
  slug: string;
  fields: EmbedLeadFields;
  ip?: string;
  tx?: DbLike;
}): Promise<{ lead: Lead; created: boolean }> {
  return findOrUpsertPublicLead({
    source: `embed:${opts.slug}`,
    uniqueKey: { kind: "emailSource" },
    fields: opts.fields,
    ip: opts.ip,
    tx: opts.tx,
  });
}
