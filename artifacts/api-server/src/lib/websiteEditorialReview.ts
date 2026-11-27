/** Opt-in staging editorial workflow. Production always retains dual review. */
export function allowStagingEditorialSelfReview(role: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return role === "super_admin"
    && env.WEBSITE_STAGING_SINGLE_ADMIN_PUBLISH === "true"
    && /^staging-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(env.RELEASE_ID ?? "")
    && env.ALLOW_LIVE_INTEGRATIONS === "false"
    && env.EMAIL_DELIVERY_DISABLED === "true";
}
