import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";

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

export default function DataQualityPage() {
  const [result, setResult] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setResult(await customFetch<Response>("/api/admin/data-quality/duplicates")); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Data Quality</h1>
          <p className="text-sm text-muted-foreground">Read-only duplicate candidates based on normalized email and phone.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Candidate groups</p><p className="text-3xl font-bold">{result?.summary.groups ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Affected records</p><p className="text-3xl font-bold">{result?.summary.affectedRecords ?? "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-amber-500" /> Review queue</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(result?.data ?? []).map((row) => (
            <div key={`${row.entity}-${row.matchKey}-${row.normalizedValue}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Badge variant="outline">{row.entity}</Badge><Badge variant="secondary">{row.matchKey}</Badge><span className="font-medium">{row.recordCount} records</span></div>
                <p className="mt-1 truncate text-sm text-muted-foreground">IDs: {row.recordIds.join(", ")}</p>
              </div>
              <span className="max-w-xs truncate text-sm" title={row.normalizedValue}>{row.normalizedValue}</span>
            </div>
          ))}
          {!loading && (result?.data.length ?? 0) === 0 && <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground"><ShieldCheck className="w-5 h-5" /> No duplicate candidates found.</div>}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">Merge is intentionally disabled until application, document, finance, conversation and audit ownership can be moved atomically.</p>
    </div>
  );
}
