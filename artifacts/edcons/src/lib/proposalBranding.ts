export type ProposalBrandingSettings = {
  companyName?: string;
  publicBrandName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
  logoUrl?: string | null;
  logoSquareUrl?: string | null;
  pdfLogoUrl?: string | null;
};

export type ProposalAgencyProfile = {
  logoUrl?: string | null;
  companyName?: string;
  businessName?: string;
  email?: string | null;
  phone?: string | null;
  phoneE164?: string | null;
  website?: string | null;
};

export type ProposalBranding = {
  logoSrc: string | null;
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
};

/**
 * Keep proposal ownership explicit:
 * - tenant roles use tenant PDF branding;
 * - agent and sub-agent roles use their own /agents/me record;
 * - agent staff use the managing agency record returned by /agents/me.
 *
 * Tenant branding is only a safe fallback when an agency has not uploaded a
 * particular asset or contact value. A sub-agent never inherits the parent
 * agency's logo through this resolver.
 */
export function resolveProposalBranding(
  role: string | undefined,
  settings: ProposalBrandingSettings | undefined,
  agency: ProposalAgencyProfile | undefined,
): ProposalBranding {
  const agencySide = role === "agent" || role === "sub_agent" || role === "agent_staff";
  const tenantLogo = settings?.pdfLogoUrl || settings?.logoSquareUrl || settings?.logoUrl || null;

  if (!agencySide) {
    return {
      logoSrc: tenantLogo,
      companyName: settings?.publicBrandName || settings?.companyName || "Find And Study",
      companyEmail: settings?.companyEmail || undefined,
      companyPhone: settings?.companyPhone || undefined,
      companyWebsite: settings?.companyWebsite || undefined,
    };
  }

  return {
    logoSrc: agency?.logoUrl || tenantLogo,
    companyName:
      agency?.businessName ||
      agency?.companyName ||
      settings?.publicBrandName ||
      settings?.companyName ||
      "Find And Study",
    companyEmail: agency?.email || settings?.companyEmail || undefined,
    companyPhone: agency?.phoneE164 || agency?.phone || settings?.companyPhone || undefined,
    companyWebsite: agency?.website || settings?.companyWebsite || undefined,
  };
}
