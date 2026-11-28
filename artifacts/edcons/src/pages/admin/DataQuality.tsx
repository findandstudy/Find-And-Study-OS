import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, DatabaseZap, ExternalLink, Link2, RefreshCw, ShieldCheck } from "lucide-react";

type Candidate = {
  entity: "student" | "lead";
  matchKey: "email" | "phone";
  normalizedValue: string;
  recordIds: number[];
  recordCount: number;
};

type Response = {
  data: Candidate[];
  summary: { groups: number; affectedRecords: number };
  mergeAvailable: boolean;
  mergePolicy: string;
};

type ApplicationLeadCandidate = {
  applicationId: number;
  studentId: number;
  candidateLeadIds: number[];
  activeApplicationCount: number;
  classification: "safe_candidate" | "review_unique_identity" | "ambiguous" | "no_candidate";
  evidence: string[];
};

type ApplicationLeadResponse = {
  data: ApplicationLeadCandidate[];
  summary: {
    unlinkedApplications: number;
    safeCandidates: number;
    uniqueIdentityReview: number;
    ambiguous: number;
    noCandidate: number;
  };
  writeEnabled: false;
  policy: string;
};

type CatalogConfidenceResponse = {
  generatedAt: string;
  mode: "read_only";
  data: Array<{
    programId: number;
    programName: string;
    universityId: number;
    universityName: string;
    country: string;
    city: string | null;
    confidence: "verified" | "partial" | "missing";
    missingFields: Array<"tuition" | "intake" | "deadline">;
    sourceName: string | null;
    sourceUrl: string | null;
    lastVerifiedAt: string | null;
    sourceExpiresAt: string | null;
    publicPagesAffected: number;
    activeApplicationsAffected: number;
  }>;
  summary: {
    activePrograms: number;
    verifiedPrograms: number;
    partialPrograms: number;
    missingPrograms: number;
    missingTuition: number;
    missingIntake: number;
    missingDeadline: number;
    rowsReturned: number;
    truncated: boolean;
  };
  policy: string;
};

export default function DataQualityPage() {
  const { lang: uiLanguage } = useUiLanguage();
  const [result, setResult] = useState<Response | null>(null);
  const [applicationLinks, setApplicationLinks] = useState<ApplicationLeadResponse | null>(null);
  const [catalogConfidence, setCatalogConfidence] = useState<CatalogConfidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [duplicates, links, confidence] = await Promise.all([
        customFetch<Response>("/api/admin/data-quality/duplicates"),
        customFetch<ApplicationLeadResponse>("/api/admin/data-quality/application-lead-links"),
        customFetch<CatalogConfidenceResponse>("/api/admin/data-quality/catalog-confidence"),
      ]);
      setResult(duplicates);
      setApplicationLinks(links);
      setCatalogConfidence(confidence);
    }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{translateUi(uiLanguage, "Data Quality")}</h1>
          <p className="text-sm text-muted-foreground">{translateUi(uiLanguage, "Read-only duplicate candidates based on normalized email and phone.")}</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> {translateUi(uiLanguage, "Refresh")} </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{translateUi(uiLanguage, "Candidate groups")}</p><p className="text-3xl font-bold">{result?.summary.groups ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{translateUi(uiLanguage, "Affected records")}</p><p className="text-3xl font-bold">{result?.summary.affectedRecords ?? "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseZap className="w-4 h-4 text-indigo-500" /> {translateUi(uiLanguage, "Catalogue confidence and change impact")} </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Active programs", catalogConfidence?.summary.activePrograms],
              ["Verified facts", catalogConfidence?.summary.verifiedPrograms],
              ["Partial facts", catalogConfidence?.summary.partialPrograms],
              ["Missing facts", catalogConfidence?.summary.missingPrograms],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value ?? "—"}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{translateUi(uiLanguage, "Missing tuition:")} {catalogConfidence?.summary.missingTuition ?? "—"}</Badge>
            <Badge variant="outline">{translateUi(uiLanguage, "Missing intake:")} {catalogConfidence?.summary.missingIntake ?? "—"}</Badge>
            <Badge variant="outline">{translateUi(uiLanguage, "Missing deadline:")} {catalogConfidence?.summary.missingDeadline ?? "—"}</Badge>
          </div>
          <div className="max-h-[36rem] overflow-auto rounded-lg border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="sticky top-0 bg-muted/95 text-left text-xs">
                <tr><th className="p-3">{translateUi(uiLanguage, "Program")}</th><th className="p-3">{translateUi(uiLanguage, "Confidence")}</th><th className="p-3">{translateUi(uiLanguage, "Missing")}</th><th className="p-3">{translateUi(uiLanguage, "Source / verified")}</th><th className="p-3">{translateUi(uiLanguage, "Read-only impact")}</th></tr>
              </thead>
              <tbody className="divide-y">
                {(catalogConfidence?.data ?? []).map((row) => (
                  <tr key={row.programId} className="align-top">
                    <td className="p-3">
                      <a href={`/admin/catalog?tab=programs&programId=${row.programId}`} className="font-medium text-primary hover:underline">{row.programName}</a>
                      <p className="text-xs text-muted-foreground">{row.universityName} · {[row.city, row.country].filter(Boolean).join(", ")}</p>
                    </td>
                    <td className="p-3"><Badge variant={row.confidence === "verified" ? "default" : row.confidence === "missing" ? "destructive" : "secondary"}>{row.confidence}</Badge></td>
                    <td className="p-3 text-xs">{row.missingFields.join(", ") || translateUi(uiLanguage, "None")}</td>
                    <td className="p-3 text-xs">
                      <div className="flex items-center gap-1">
                        <span>{row.sourceName || translateUi(uiLanguage, "No verified source")}</span>
                        {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" aria-label={translateUi(uiLanguage, "Open evidence source")}><ExternalLink className="size-3.5" /></a>}
                      </div>
                      <p className="text-muted-foreground">{row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : translateUi(uiLanguage, "Not verified")}</p>
                    </td>
                    <td className="p-3 text-xs">
                      <p>{row.publicPagesAffected} {translateUi(uiLanguage, "public page(s)")}</p>
                      <p className="text-muted-foreground">{row.activeApplicationsAffected} {translateUi(uiLanguage, "active application(s)")}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && (catalogConfidence?.data.length ?? 0) === 0 && <div className="py-8 text-center text-muted-foreground">{translateUi(uiLanguage, "No active catalogue programs found.")}</div>}
          <p className="text-xs text-muted-foreground">{translateUi(uiLanguage, "Read-only preview. Nothing is published or changed from this panel.")}{catalogConfidence?.summary.truncated ? translateUi(uiLanguage, " Showing the first {value0} highest-risk programs.", undefined, { value0: String(catalogConfidence.summary.rowsReturned) }) : ""}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-amber-500" /> {translateUi(uiLanguage, "Review queue")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(result?.data ?? []).map((row) => (
            <div key={`${row.entity}-${row.matchKey}-${row.normalizedValue}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Badge variant="outline">{row.entity}</Badge><Badge variant="secondary">{row.matchKey}</Badge><span className="font-medium">{row.recordCount} {translateUi(uiLanguage, "records")}</span></div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{translateUi(uiLanguage, "IDs:")} {row.recordIds.join(", ")}</p>
              </div>
              <span className="max-w-xs truncate text-sm" title={row.normalizedValue}>{row.normalizedValue}</span>
            </div>
          ))}
          {!loading && (result?.data.length ?? 0) === 0 && <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground"><ShieldCheck className="w-5 h-5" /> {translateUi(uiLanguage, "No duplicate candidates found.")}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="w-4 h-4 text-blue-500" /> {translateUi(uiLanguage, "Legacy application–lead links")} </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Unlinked", applicationLinks?.summary.unlinkedApplications],
              ["Safe candidates", applicationLinks?.summary.safeCandidates],
              ["Identity review", applicationLinks?.summary.uniqueIdentityReview],
              ["Ambiguous", applicationLinks?.summary.ambiguous],
              ["No candidate", applicationLinks?.summary.noCandidate],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value ?? "—"}</p>
              </div>
            ))}
          </div>

          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {(applicationLinks?.data ?? []).map((row) => (
              <div key={row.applicationId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="font-medium text-primary hover:underline" href={`/staff/applications/${row.applicationId}`} target="_blank" rel="noreferrer"> {translateUi(uiLanguage, "Application #")}{row.applicationId}
                    </a>
                    <a className="text-sm text-primary hover:underline" href={`/staff/students/${row.studentId}`} target="_blank" rel="noreferrer"> {translateUi(uiLanguage, "Student #")}{row.studentId}
                    </a>
                    <Badge variant={row.classification === "safe_candidate" ? "default" : row.classification === "ambiguous" ? "destructive" : "secondary"}>
                      {row.classification.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.activeApplicationCount} {translateUi(uiLanguage, "active application(s) · Evidence:")} {row.evidence.join(", ") || translateUi(uiLanguage, "none")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.candidateLeadIds.map((leadId) => (
                    <a key={leadId} className="text-sm text-primary hover:underline" href={`/staff/leads/${leadId}`} target="_blank" rel="noreferrer"> {translateUi(uiLanguage, "Lead #")}{leadId}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {!loading && (applicationLinks?.data.length ?? 0) === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <ShieldCheck className="w-5 h-5" /> {translateUi(uiLanguage, "Every active application has an explicit lead link.")} </div>
          )}
          <p className="text-xs text-muted-foreground">{translateUi(uiLanguage, "Analysis only. No application or lead record is modified from this screen.")}</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{translateUi(uiLanguage, "Merge is intentionally disabled until application, document, finance, conversation and audit ownership can be moved atomically.")}</p>
    </div>
  );
}
