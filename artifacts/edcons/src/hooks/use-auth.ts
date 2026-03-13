import { useGetMe } from "@workspace/api-client-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

export function useAuth(requireAuth = false, allowedRoles?: string[]) {
  const { data: user, isLoading, error } = useGetMe({
    query: { retry: false }
  });
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && requireAuth) {
      if (!user || error) {
        window.location.href = "/api/auth/login";
        return;
      }
      // Pending users are handled by ProtectedRoute — don't redirect them
      if (user.role !== "pending" && allowedRoles && !allowedRoles.includes(user.role)) {
        setLocation("/");
      }
    }
  }, [user, isLoading, error, requireAuth, allowedRoles, setLocation]);

  return { user, isLoading, isAuthenticated: !!user };
}
