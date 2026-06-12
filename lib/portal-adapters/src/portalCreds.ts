// ---------------------------------------------------------------------------
// portalCreds — read portal login credentials from process.env
//
// Convention:
//   user field → {KEY}_USER  or  {KEY}_EMAIL  (first defined wins)
//   pass field → {KEY}_PASSWORD
//
// Examples:
//   portalCreds("sit")     reads SIT_USER     + SIT_PASSWORD
//   portalCreds("united")  reads UNITED_USER  + UNITED_PASSWORD
//   portalCreds("topkapi") reads TOPKAPI_USER + TOPKAPI_PASSWORD
//   portalCreds("uskudar") reads USKUDAR_EMAIL + USKUDAR_PASSWORD
//                           (falls back to USKUDAR_USER if EMAIL is absent)
// ---------------------------------------------------------------------------
export interface ResolvedCreds {
  user: string;
  password: string;
}

export function portalCreds(adapterKey: string): ResolvedCreds {
  const K = adapterKey.toUpperCase().replace(/-/g, "_");

  const user =
    process.env[`${K}_EMAIL`] ??
    process.env[`${K}_USER`]  ??
    "";

  const password = process.env[`${K}_PASSWORD`] ?? "";

  if (!user || !password) {
    throw new Error(
      `[portal-adapters] Missing credentials for "${adapterKey}". ` +
      `Set ${K}_EMAIL (or ${K}_USER) and ${K}_PASSWORD in .env`,
    );
  }

  return { user, password };
}
