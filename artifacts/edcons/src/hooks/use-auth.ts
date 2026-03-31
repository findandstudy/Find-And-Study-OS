import { useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

export function useAuth(requireAuth = false, allowedRoles?: string[]) {
  const { data: user, isLoading, error } = useGetMe({
    query: { retry: false, staleTime: 30_000 } as any,
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
