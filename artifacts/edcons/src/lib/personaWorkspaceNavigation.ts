/** UI discoverability only. Project/session authorization is always server-side. */
export function isLocalPersonaWorkspaceHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}
/** Persona-only discovery: does not widen the local gate used by other modules. */
export function isPersonaWorkspaceLocation(protocol: string, hostname: string): boolean {
  return (protocol === "http:" && isLocalPersonaWorkspaceHost(hostname)) ||
    (protocol === "https:" && hostname === "staging.findandstudy.com");
}
export function personaWorkspacePath(project: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project)
    ? `/admin/agent-team-workspace/${project.toLowerCase()}` : null;
}

export type PersonaWorkspaceProject = { id: string; label: string };
/** The list is supplied by the authenticated server, never derived from a role or URL. */
export function parsePersonaWorkspaceProjects(value: unknown): PersonaWorkspaceProject[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("PERSONA_PROJECT_LIST_INVALID");
  const data = value as Record<string, unknown>;
  if ((data.mode !== "staging-mock" && data.mode !== "disposable-test") ||
    !Array.isArray(data.projects) || data.projects.length > 100)
    throw Error("PERSONA_PROJECT_LIST_INVALID");
  const seen = new Set<string>();
  return data.projects.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("PERSONA_PROJECT_LIST_INVALID");
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !personaWorkspacePath(item.id) ||
      typeof item.label !== "string" || !item.label.trim() || item.label.length > 200 ||
      seen.has(item.id.toLowerCase())) throw Error("PERSONA_PROJECT_LIST_INVALID");
    seen.add(item.id.toLowerCase());
    return { id: item.id.toLowerCase(), label: item.label.trim() };
  });
}
