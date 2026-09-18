export type PublicWebRobotsMode = "disallow" | "published";

export type PublicWebRobotsConfig = {
  mode: PublicWebRobotsMode;
  siteUrl: string | null;
  reason: "disabled" | "enabled" | "invalid_site_url";
};

function exactHttpsOrigin(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function parsePublicWebRobotsConfig(input: {
  mode?: unknown;
  siteUrl?: unknown;
}): PublicWebRobotsConfig {
  if (String(input.mode ?? "").trim().toLowerCase() !== "published") {
    return { mode: "disallow", siteUrl: null, reason: "disabled" };
  }
  const siteUrl = exactHttpsOrigin(input.siteUrl);
  return siteUrl
    ? { mode: "published", siteUrl, reason: "enabled" }
    : { mode: "disallow", siteUrl: null, reason: "invalid_site_url" };
}

export function renderPublicWebRobots(config: PublicWebRobotsConfig): string {
  if (config.mode !== "published" || !config.siteUrl) {
    return "User-agent: *\nDisallow: /\n";
  }
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin/",
    "Disallow: /staff/",
    "Disallow: /student/",
    "Disallow: /agent/",
    "Disallow: /institution/",
    "Disallow: /accommodation/",
    "Disallow: /instructor/",
    "Disallow: /login",
    "Disallow: /*/login",
    "Disallow: /sign/",
    `Sitemap: ${config.siteUrl}/sitemap.xml`,
    "",
  ].join("\n");
}
