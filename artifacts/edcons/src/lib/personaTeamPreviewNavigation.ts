// This memory-only preview uses the existing dashboard SPA shell. Menu
// visibility is discoverability only; the server still validates its template
// request and direct document entry against the real session and staging gate.
export const PERSONA_TEAM_PREVIEW_PATH = "/admin/agent-team-preview/";
const STAGING_ORIGIN = "https://staging.findandstudy.com";

export function getPersonaTeamPreviewMenuLink(origin: string, role: string, language: string) {
  if (origin !== STAGING_ORIGIN || !["admin", "super_admin"].includes(role)) return null;
  return {
    title: language === "tr" ? "Takım Tasarımcısı — Önizleme" : "Team Designer — Preview",
    url: PERSONA_TEAM_PREVIEW_PATH,
  };
}

export function getPersonaTeamPreviewReturnTarget(origin: string, returnTo: string | null): string | null {
  if (origin !== STAGING_ORIGIN) return null;
  return returnTo === PERSONA_TEAM_PREVIEW_PATH || returnTo === PERSONA_TEAM_PREVIEW_PATH.slice(0, -1)
    ? PERSONA_TEAM_PREVIEW_PATH
    : null;
}

// The protected document route hands off to the normal application shell.
// This fixed, same-origin bootstrap hint is not a general redirect parameter.
export function getPersonaTeamPreviewBridgePath(origin: string, pathname: string, search: string): string | null {
  return origin === STAGING_ORIGIN && pathname === "/" && search === "?workspace=team-preview"
    ? PERSONA_TEAM_PREVIEW_PATH
    : null;
}
