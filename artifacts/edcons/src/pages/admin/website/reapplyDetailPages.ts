import { customFetch } from "@workspace/api-client-react";

export type ReapplyDetailPageKind = "country" | "city" | "university" | "program";
export type ReapplyDetailPageResult = {
  entityId: number;
  locale: string;
  status: "created" | "completed" | "preserved" | "failed";
  pageId?: number | null;
  addedSections?: number;
  generatedSections?: number;
  generatedImages?: number;
  imageFailures?: number;
  error?: string;
};
export type ReapplyDetailPagesResponse = {
  requested: number;
  summary: { created: number; completed: number; preserved: number; failed: number };
  results: ReapplyDetailPageResult[];
  publication: "draft_review_required";
};

/** Generates bounded, reviewable page drafts; regeneration never publishes automatically. */
export async function reapplyDetailPages(kind: ReapplyDetailPageKind, locales: string[], sourceIds: number[], mode: "fill_missing" | "regenerate" = "fill_missing") {
  const perBatch = Math.max(1, Math.floor(50 / locales.length));
  const combined: ReapplyDetailPagesResponse = {
    requested: 0,
    summary: { created: 0, completed: 0, preserved: 0, failed: 0 },
    results: [],
    publication: "draft_review_required",
  };
  for (let index = 0; index < sourceIds.length; index += perBatch) {
    const result = await customFetch<ReapplyDetailPagesResponse>("/api/website/catalog-pages/reapply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, locales, mode, sourceIds: sourceIds.slice(index, index + perBatch) }),
    });
    combined.requested += result.requested;
    combined.results.push(...result.results);
    for (const key of ["created", "completed", "preserved", "failed"] as const) combined.summary[key] += result.summary[key];
  }
  return combined;
}

