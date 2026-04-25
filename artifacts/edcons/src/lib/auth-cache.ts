/**
 * Lightweight localStorage auth cache.
 *
 * On a canvas-triggered full-page reload (caused by the Replit canvas
 * intercepting navigation events), React Query's in-memory cache is wiped.
 * Without a persistent cache, `isLoading = true` for ~200-400ms after reload,
 * making ProtectedRoute and DashboardLayout return null — the white flash.
 *
 * This cache lets us provide `initialData` to useGetMe so the app
 * renders the full layout immediately on reload, then validates the session
 * in the background.
 */

const CACHE_KEY = "edcons_auth_v2";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface AuthCacheEntry {
  data: unknown;
  ts: number;
}

export function getAuthCache(): unknown | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const entry: AuthCacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      window.localStorage.removeItem(CACHE_KEY);
      return undefined;
    }
    return entry.data;
  } catch {
    return undefined;
  }
}

export function setAuthCache(data: unknown): void {
  try {
    const entry: AuthCacheEntry = { data, ts: Date.now() };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore quota errors
  }
}

export function clearAuthCache(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore
  }
}
