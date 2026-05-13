import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import VerifyEmail from "@/pages/agent/VerifyEmail";
import SignContract from "@/pages/agent/SignContract";
import ContractExpired from "@/pages/agent/ContractExpired";

import { AGENT_ROLES as _AGENT_ROLES_ARR } from "@workspace/roles";
const AGENT_ROLES = new Set<string>(_AGENT_ROLES_ARR);

type Status = {
  requiresOnboarding: boolean;
  emailVerified: boolean;
  email: string | null;
  contractStatus: "none" | "pending" | "signed" | "expired" | "revoked" | "n/a";
  sessionId: number | null;
  expiresAt: string | null;
  isPrimaryOnboarding: boolean;
};

interface Props { children: React.ReactNode }

/**
 * Gate every Agent route. Hits /api/agents/me/onboarding-status once per
 * mount, then renders the appropriate lock screen — VerifyEmail, SignContract
 * or ContractExpired — until the agent has completed both steps.
 */
export function AgentOnboardingGuard({ children }: Props) {
  const { user } = useAuth(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  async function reload() {
    setLoading(true);
    try {
      const r: any = await customFetch("/api/agents/me/onboarding-status");
      setStatus(r);
    } catch (err) {
      console.warn("[AgentOnboardingGuard] status fetch failed", err);
      setStatus(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!user || !AGENT_ROLES.has(user.role)) { setLoading(false); return; }
    if (fetched.current) return;
    fetched.current = true;
    void reload();
  }, [user?.id, user?.role]);

  if (!user || !AGENT_ROLES.has(user.role)) return <>{children}</>;
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!status || !status.requiresOnboarding) return <>{children}</>;
  if (!status.emailVerified) {
    return <VerifyEmail email={status.email || user.email || ""} onVerified={() => { fetched.current = false; void reload(); }} />;
  }
  if (status.contractStatus === "pending") {
    // Render the dashboard underneath but overlay a non-dismissible signing
    // dialog so the agent must sign before doing anything else.
    return (
      <>
        {children}
        <SignContract asModal onSigned={() => { fetched.current = false; void reload(); }} />
      </>
    );
  }
  if (status.contractStatus === "expired" || status.contractStatus === "revoked") {
    return <ContractExpired />;
  }
  return <>{children}</>;
}
