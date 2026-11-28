function resolvePhotoUrl(base: string, value?: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes("\\")) return null;
  return base && value.startsWith(base + "/") ? value : base + (value.startsWith("/") ? value : "/" + value);
}

export function studentPhotoSources({
  base,
  origin = "https://app.invalid",
  studentId,
  photoUrl,
  hasPhoto,
  revision,
}: {
  base: string;
  origin?: string;
  studentId?: number | null;
  photoUrl?: string | null;
  hasPhoto?: boolean | null;
  revision?: number;
}): { images: string[]; pdf: string | null } {
  const given = resolvePhotoUrl(base, photoUrl);
  if (!studentId || !Number.isSafeInteger(studentId) || studentId < 1 || (hasPhoto === false && !given)) return { images: given ? [given] : [], pdf: null };

  const original = base + "/api/students/" + studentId + "/photo";
  const thumbnail = original + "/thumbnail";
  const versionQuery = revision === undefined ? "" : "v=" + revision;
  const query = new URLSearchParams(versionQuery);
  query.set("fallback", "source");
  const images = [thumbnail + "?" + query.toString()];
  let pdf = original + (versionQuery ? "?" + versionQuery : "");
  if (!given || given === original) return { images, pdf };

  let parsed: URL;
  try {
    parsed = new URL(given, origin);
  } catch {
    return { images, pdf };
  }
  if (parsed.origin === origin && (parsed.pathname === thumbnail || parsed.pathname === original)) {
    if (revision !== undefined) parsed.searchParams.set("v", String(revision));
    if (parsed.pathname === thumbnail) parsed.searchParams.set("fallback", "source");
    if (parsed.searchParams.has("exp") && parsed.searchParams.has("sig")) {
      const signed = new URL(parsed.href);
      signed.pathname = original;
      signed.searchParams.delete("fallback");
      pdf = signed.pathname + signed.search;
    }
    const relative = parsed.pathname + parsed.search;
    const canonicalOriginal = original + (versionQuery ? "?" + versionQuery : "");
    if (relative !== canonicalOriginal && !images.includes(relative)) images.push(relative);
    return { images, pdf };
  }
  if (parsed.origin !== origin || !/\/api\/students\/\d+\/photo(?:\/thumbnail)?$/.test(parsed.pathname)) images.push(given);
  return { images, pdf };
}
