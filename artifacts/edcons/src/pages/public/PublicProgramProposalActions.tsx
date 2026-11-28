import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import type { ProposalProgramData } from "@/lib/generateProposalPdf";
import { resolveProposalBranding, type ProposalBrandingSettings } from "@/lib/proposalBranding";
import type { PublicProgramCardData } from "./PublicProgramCard";

type PdfSettings = ProposalBrandingSettings & {
  pdfPrimaryColor?: string | null;
  pdfAccentColor?: string | null;
  themePrimary?: string | null;
  themeSecondary?: string | null;
  themeAccent?: string | null;
  themeSuccess?: string | null;
};

function proposalProgram(program: PublicProgramCardData): ProposalProgramData {
  return {
    id: program.id, name: program.name, degree: program.degree, field: program.field,
    language: program.language, duration: program.duration, tuitionFee: program.tuitionFee,
    discountedFee: program.discountedFee, currency: program.currency, scholarship: program.scholarship,
    intakes: program.intakes, enrollmentFee: program.enrollmentFee, feeType: program.feeType,
    universityName: program.universityName, universityLogoUrl: program.universityLogoUrl,
    universityCountry: program.universityCountry, universityCity: program.universityCity,
    universityType: program.universityType, universityStatus: "Open",
  };
}

export function PublicProgramProposalActions({ results, selected }: {
  results: readonly PublicProgramCardData[];
  selected: ReadonlyMap<number, PublicProgramCardData>;
}) {
  const { lang: uiLanguage } = useUiLanguage();
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"results" | "selected" | null>(null);

  async function download(mode: "results" | "selected") {
    const rows = mode === "selected" ? [...selected.values()] : [...results];
    if (!rows.length) return;
    setBusy(mode);
    try {
      const [{ generateProposalPdf }, settings] = await Promise.all([
        import("@/lib/generateProposalPdf"),
        customFetch<PdfSettings>("/api/settings/branding", { method: "GET" }),
      ]);
      const branding = resolveProposalBranding(undefined, settings, undefined);
      await generateProposalPdf({
        programs: rows.map(proposalProgram),
        logoDataUrl: "/api/settings/branding/logo?variant=pdf",
        companyName: branding.companyName,
        companyEmail: branding.companyEmail,
        companyPhone: branding.companyPhone,
        companyWebsite: branding.companyWebsite || window.location.origin,
        showCommission: false,
        primaryColor: settings.pdfPrimaryColor || settings.themePrimary || undefined,
        secondaryColor: settings.themeSecondary || settings.themePrimary || undefined,
        accentColor: settings.pdfAccentColor || settings.themeAccent || undefined,
        successColor: settings.themeSuccess || undefined,
      });
      toast({ title: t("courseFinderPage.pdfGenerated"), description: t("courseFinderPage.proposalDownloaded", { n: rows.length }) });
    } catch (error) {
      toast({ title: t("courseFinderPage.pdfGenerationFailed"), description: error instanceof Error ? error.message : t("courseFinderPage.unknownError"), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return <div className="flex flex-wrap items-center gap-2" aria-label={t("catalogDetail.availablePrograms")}>
    <Button type="button" variant="outline" className="rounded-xl" disabled={!results.length || busy !== null} onClick={() => download("results")}>
      {busy === "results" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {t("catalogPage.downloadResultsProposalPdf", { n: results.length })}
    </Button>
    <Button type="button" className="rounded-xl" disabled={!selected.size || busy !== null} onClick={() => download("selected")}>
      {busy === "selected" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {t("catalogPage.downloadSelectedProposalPdf", { n: selected.size })}
    </Button>
  </div>;
}
