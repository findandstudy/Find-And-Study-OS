// ---------------------------------------------------------------------------
// portalCreds — read portal login credentials
//
// Convention (env fallback):
//   user field → {KEY}_USER  or  {KEY}_EMAIL  (first defined wins)
//   pass field → {KEY}_PASSWORD
//
// Override mechanism: the worker/runner can inject resolved credentials
// (e.g. from the DB-backed portal_credentials table) via setCredsOverride()
// before calling adapter.login(), then clearCredsOverride() in finally.
// ---------------------------------------------------------------------------

export interface ResolvedCreds {
  user: string;
  password: string;
}

const _overrides = new Map<string, ResolvedCreds>();

export function setCredsOverride(adapterKey: string, creds: ResolvedCreds): void {
  _overrides.set(adapterKey, creds);
}

export function clearCredsOverride(adapterKey: string): void {
  _overrides.delete(adapterKey);
}

export function portalCreds(adapterKey: string): ResolvedCreds {
  const override = _overrides.get(adapterKey);
  if (override) return override;

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
