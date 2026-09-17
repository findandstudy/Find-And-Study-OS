export function inboxListFilters(input: {
  tab: string; channel: string; order: string; showTests: boolean;
  search: string; assignedToId: number | null; channelAccountId: string; cursor: string | null;
  assignment?: "all" | "mine" | "unassigned";
}): URLSearchParams {
  const params = new URLSearchParams({ tab: input.tab, order: input.order, limit: "200" });
  if (input.channel !== "all") params.set("channel", input.channel);
  if (input.showTests) params.set("showTests", "true");
  if (input.search) params.set("search", input.search);
  if (input.assignedToId !== null) params.set("assignedToId", String(input.assignedToId));
  if (input.assignment && input.assignment !== "all") params.set("assignment", input.assignment);
  if (input.channelAccountId) params.set("channelAccountId", input.channelAccountId);
  if (input.cursor) params.set("cursor", input.cursor);
  return params;
}
