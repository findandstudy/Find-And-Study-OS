/** This receiver is production-only. Never mint its bearer token from a test origin. */
const PRODUCTION_ORIGINS = new Set([
  "https://apply.findandstudy.com",
  "https://findandstudy.com",
]);

export function canUseProductionAcademyReceiver(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production" || /^staging(?:-|$)/i.test(env.RELEASE_ID ?? "")) return false;
  const configured = [env.APP_BASE_URL, env.BASE_URL].filter((value): value is string => value !== undefined);
  if (configured.length === 0) return false;
  let origin: string | undefined;
  for (const value of configured) {
    try {
      const url = new URL(value);
      // No userinfo, alternate ports, paths, query or fragments. Do not infer
      // deployment identity from request Host/X-Forwarded-Host headers.
      if (value !== url.origin && value !== `${url.origin}/`) return false;
      if (!PRODUCTION_ORIGINS.has(url.origin) || (origin && origin !== url.origin)) return false;
      origin = url.origin;
    } catch {
      return false;
    }
  }
  return true;
}
