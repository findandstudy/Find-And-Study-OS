import { useGetMe } from "@workspace/api-client-react";
import { useEffect, useMemo, startTransition } from "react";
import { useLocation } from "wouter";
import { getAuthCache, getStickyUser, setStickyUser } from "@/lib/auth-cache";

export function useAuth(requireAuth = false, allowedRoles?: readonly string[]) {
  const initialUser = useMemo(() => getStickyUser() ?? getAuthCache(), []);

  const { data: liveUser, isLoading, error } = useGetMe({
    query: {
      retry: false,
      staleTime: 30_000,
      ...(initialUser !== undefined
        ? {
            initialData: initialUser as any,
            // Mark initial data as fresh right now so TanStack Query doesn't
            // immediately schedule a background refetch on every component mount.
            // The data will be considered stale after staleTime (30s).
            initialDataUpdatedAt: Date.now(),
          }
        : {}),
    } as any,
  });

  // Keep sticky updated whenever live data is available
  if (liveUser) setStickyUser(liveUser);

  // Use live user first, then fall back to module-level sticky (survives
  // transient refetch errors and brief undefined states during transitions).
  const user = (liveUser ?? getStickyUser()) as typeof liveUser;

  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && requireAuth) {
      const status = (error as any)?.status as number | undefined;
      const isHardAuthError = status === 401 || status === 403;

      if (!user) {
        // Genuinely unauthenticated — redirect to login.
        const returnTo = encodeURIComponent(
          window.location.pathname + window.location.search
        );
        // Wrap in startTransition so any in-flight Suspense navigation
        // resolves before the login redirect replaces the tree.
        startTransition(() => setLocation(`/login?returnTo=${returnTo}`));
        return;
      }

      if (isHardAuthError && !getStickyUser()) {
        // Session expired AND sticky user is gone (cleared after confirmed 401
        // in AuthPrefetch) — redirect to login.
        const returnTo = encodeURIComponent(
          window.location.pathname + window.location.search
        );
        startTransition(() => setLocation(`/login?returnTo=${returnTo}`));
        return;
      }

      if (
        user.role !== "pending" &&
        allowedRoles &&
        !allowedRoles.includes(user.role)
      ) {
        startTransition(() => setLocation("/"));
      }
    }
  }, [user, isLoading, error, requireAuth, allowedRoles, setLocation]);

  return { user, isLoading, isAuthenticated: !!user };
}
