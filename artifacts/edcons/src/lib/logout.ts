import { customFetch } from "@workspace/api-client-react";
import { clearAuthCache } from "@/lib/auth-cache";

/**
 * End the authenticated session through the CSRF-protected POST endpoint.
 * Client-side credentials are cleared even when the network request fails so
 * stale user data cannot remain visible on a shared device.
 */
export async function performLogout(redirectTo = "/login"): Promise<void> {
  try {
    await customFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Continue with local cleanup. The server-side session will still expire
    // according to its absolute TTL if the request could not be delivered.
  } finally {
    clearAuthCache();
    try {
      window.sessionStorage.clear();
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
    window.location.assign(redirectTo);
  }
}
