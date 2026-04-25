import { useGetMe } from "@workspace/api-client-react";
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { getAuthCache } from "@/lib/auth-cache";

export function useAuth(requireAuth = false, allowedRoles?: string[]) {
  const cachedUser = useMemo(() => getAuthCache(), []);
  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
      staleTime: 30_000,
      ...(cachedUser !== undefined
        ? { initialData: cachedUser as any, initialDataUpdatedAt: 0 }
        : {}),
    } as any,
  });

  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && requireAuth) {
      if (!user || error) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        setLocation(`/login?returnTo=${returnTo}`);
        return;
      }
      if (user.role !== "pending" && allowedRoles && !allowedRoles.includes(user.role)) {
        setLocation("/");
      }
    }
  }, [user, isLoading, error, requireAuth, allowedRoles, setLocation]);

  return { user, isLoading, isAuthenticated: !!user };
}
