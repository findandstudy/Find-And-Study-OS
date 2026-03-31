import { useAuth } from "@/hooks/use-auth";
import { useSeo } from "@/hooks/use-seo";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { ShieldX, Clock } from "lucide-react";

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
  requiredPermission?: string;
}

function PendingScreen() {
  useSeo({ title: "Account Pending", noindex: true });
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-background">
      <div className="text-center max-w-md p-8">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Account Pending Activation</h1>
        <p className="text-muted-foreground mb-6">
          Your account has been registered and is awaiting approval from an administrator.
          Please contact your team to get your account activated.
        </p>
        <Button variant="outline" onClick={() => window.location.href = "/"}>
          Back to Home
        </Button>
      </div>
    </div>
  );
}

function AccessDeniedScreen() {
  useSeo({ title: "Access Denied", noindex: true });
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-background">
      <div className="text-center max-w-md p-8">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <ShieldX className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-6">
          You do not have permission to view this page. Contact your administrator if you believe this is an error.
        </p>
        <Button variant="outline" onClick={() => window.history.back()}>
          Go Back
        </Button>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, allowedRoles, requiredPermission }: Props) {
  const { user, isLoading } = useAuth(true, allowedRoles);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (!user) return null;

  if (user.role === "pending") {
    return <PendingScreen />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <AccessDeniedScreen />;
  }

  if (requiredPermission && user.role === "agent_staff") {
    const perms = (user as unknown as Record<string, unknown>).agentStaffPermissions as string[] | undefined;
    if (!perms || !perms.includes(requiredPermission)) {
      return <AccessDeniedScreen />;
    }
  }

  return <>{children}</>;
}
