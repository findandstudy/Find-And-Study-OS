import type { QueryClient, QueryKey } from "@tanstack/react-query";

const FOLLOW_UP_QUERY_ROOTS = [
  "/api/follow-ups",
  "/api/leads",
  "/api/students",
] as const;

const ASSIGNMENT_QUERY_ROOTS = [
  "/api/leads",
  "/api/students",
  "/api/applications",
  "applications",
  "/api/follow-ups",
] as const;

function matchesRoot(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root}/`) || value.startsWith(`${root}?`);
}

export function queryKeyMatchesAnyRoot(queryKey: QueryKey, roots: readonly string[]): boolean {
  return queryKey.some(part => (
    typeof part === "string" && roots.some(root => matchesRoot(part, root))
  ));
}

function invalidateMatchingQueries(queryClient: QueryClient, roots: readonly string[]): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: query => queryKeyMatchesAnyRoot(query.queryKey, roots),
    refetchType: "active",
  });
}

/**
 * Follow-up changes affect the dashboard reminder, the shared follow-up workspace,
 * and lead/student cards that expose the next follow-up date.
 */
export function invalidateFollowUpWorkspaceQueries(queryClient: QueryClient): Promise<void> {
  return invalidateMatchingQueries(queryClient, FOLLOW_UP_QUERY_ROOTS);
}

/**
 * Assignment is synchronized across the related lead, student and application.
 * Invalidate the complete relationship so navigation cannot reveal a stale owner.
 */
export function invalidateAssignmentWorkspaceQueries(queryClient: QueryClient): Promise<void> {
  return invalidateMatchingQueries(queryClient, ASSIGNMENT_QUERY_ROOTS);
}
