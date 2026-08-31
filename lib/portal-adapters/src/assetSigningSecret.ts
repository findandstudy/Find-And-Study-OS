// ---------------------------------------------------------------------------
// Shared signing-secret resolution for auth-free external-webhook asset URLs
// (student documents + student photo).
// ---------------------------------------------------------------------------
// Both documentSigning.ts and studentPhotoSigning.ts need the SAME secret
// precedence so a signature produced by one process (portal worker) always
// verifies on another (api-server) even when only a subset of these env vars
// is configured on a given deploy target.
//
// Production requires a domain-separated ASSET_URL_SIGNING_SECRET. Reusing a
// session/embed secret would unnecessarily couple independent trust domains.
// Development/test retain the legacy fallback so local tooling stays usable.
// Returns "" when none are configured; callers then skip signing entirely
// (documents/photo become best-effort-omitted, never a hard failure).
// ---------------------------------------------------------------------------
export function getAssetSigningSecret(): string {
  const dedicated = (process.env.ASSET_URL_SIGNING_SECRET || "").trim();
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") return "";
  return (
    process.env.SESSION_SECRET ||
    process.env.EMBED_TOKEN_SECRET ||
    ""
  ).trim();
}
