import { useGetMe } from "@workspace/api-client-react";
import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { getAuthCache, getStickyUser, setStickyUser } from "@/lib/auth-cache";

export function useAuth(requireAuth = false, allowedRoles?: string[]) {
  const initialUser = useMemo(() => getStickyUser() ?? getAuthCache(), []);

  const { data: user, isLoading, error } = useGetMe({
    query: {
      retry: false,
      staleTime: 30_000,
      ...(initialUser !== undefined
        ? { initialData: initialUser as any, initialDataUpdatedAt: 0 }
        : {}),
    } as any,
  });

  if (user) setStickyUser(user);

  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && requireAuth) {
      const isAuthError = (error as any)?.status === 401 || (error as any)?.status === 403;
      if (!user || isAuthError) {
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
