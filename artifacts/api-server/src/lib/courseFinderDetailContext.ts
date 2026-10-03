/** An explicit public-detail scope cannot be widened by facet pruning or clear-all. */
export function parseCourseFinderDetailContext(query: Record<string, unknown>): number | null {
  if (query.detailUniversityId === undefined) return null;
  const id = query.detailUniversityId;
  if (typeof id !== "string" || !/^[1-9]\d{0,9}$/.test(id)
    || Number(id) > 2_147_483_647 || query.scope !== "public" || query.universityId !== id) {
    throw new Error("INVALID_DETAIL_UNIVERSITY_CONTEXT");
  }
  return Number(id);
}
