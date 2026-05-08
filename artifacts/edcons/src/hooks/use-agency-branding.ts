import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { setActiveAgencyBusinessName } from "@/lib/agency-branding-store";

const AGENT_ROLES = new Set(["agent", "sub_agent", "agent_staff"]);

function setIcon(href: string) {
  document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  ).forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = href;
  document.head.appendChild(link);
  const apple = document.createElement("link");
  apple.rel = "apple-touch-icon";
  apple.href = href;
  document.head.appendChild(apple);
}

function restoreDefaultIcon(href: string) {
  document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  ).forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = href;
  document.head.appendChild(link);
  const apple = document.createElement("link");
  apple.rel = "apple-touch-icon";
  apple.setAttribute("sizes", "180x180");
  apple.href = "/apple-touch-icon.png";
  document.head.appendChild(apple);
}

/**
 * When an agent / sub_agent / agent_staff is logged in, override the browser
 * tab title with their configured business name and the favicon with their
 * uploaded logo. Reverts to the default app branding for everyone else.
 */
export function useAgencyBranding() {
  const { user } = useAuth();
  const role = (user as any)?.role as string | undefined;
  const isAgent = !!role && AGENT_ROLES.has(role);

  const defaultsRef = useRef<{ title: string; favicon: string } | null>(null);
  if (defaultsRef.current === null && typeof document !== "undefined") {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    defaultsRef.current = {
      title: document.title || "Find And Study",
      favicon: existing?.href || "/favicon.svg",
    };
  }

  const { data: agentProfile } = useQuery({
    queryKey: ["agent-me", "branding"],
    queryFn: () => customFetch<any>("/api/agents/me"),
    enabled: isAgent,
    staleTime: 30_000,
  });

  useEffect(() => {
    const defaults = defaultsRef.current;
    if (!defaults) return;
    if (!isAgent) {
      setActiveAgencyBusinessName(null);
      document.title = defaults.title;
      restoreDefaultIcon(defaults.favicon);
      return;
    }
    if (!agentProfile) return;
    const businessName = (agentProfile.businessName || "").trim();
    if (businessName) {
      setActiveAgencyBusinessName(businessName);
      document.title = businessName;
    } else {
      setActiveAgencyBusinessName(null);
      document.title = defaults.title;
    }
    if (agentProfile.logoUrl) setIcon(agentProfile.logoUrl);
    else restoreDefaultIcon(defaults.favicon);
  }, [isAgent, agentProfile?.businessName, agentProfile?.logoUrl]);

  // On unmount (full app teardown), restore defaults.
  useEffect(() => {
    return () => {
      const defaults = defaultsRef.current;
      if (!defaults) return;
      setActiveAgencyBusinessName(null);
      document.title = defaults.title;
      restoreDefaultIcon(defaults.favicon);
    };
  }, []);
}
