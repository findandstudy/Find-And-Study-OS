// This server-rendered, memory-only preview is not an SPA route. These links
// are discoverability only; the server still validates every request/session.
export const PERSONA_TEAM_PREVIEW_PATH = "/admin/agent-team-preview/";
const STAGING_ORIGIN = "https://staging.findandstudy.com";

export function getPersonaTeamPreviewMenuLink(origin: string, role: string, language: string) {
  if (origin !== STAGING_ORIGIN || !["admin", "super_admin"].includes(role)) return null;
  return {
    title: language === "tr" ? "Takım Tasarımcısı — Önizleme" : "Team Designer — Preview",
    url: PERSONA_TEAM_PREVIEW_PATH,
    externalHref: PERSONA_TEAM_PREVIEW_PATH,
  };
}

export function getPersonaTeamPreviewReturnTarget(origin: string, returnTo: string | null): string | null {
  if (origin !== STAGING_ORIGIN) return null;
  return returnTo === PERSONA_TEAM_PREVIEW_PATH || returnTo === PERSONA_TEAM_PREVIEW_PATH.slice(0, -1)
    ? PERSONA_TEAM_PREVIEW_PATH
    : null;
}
