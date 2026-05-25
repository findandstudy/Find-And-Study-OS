import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { Download, Upload, Loader2 } from "lucide-react";

type ImportItemResult = {
  index: number;
  slug: string | null;
  status: "created" | "updated" | "renamed" | "skipped" | "error";
  finalSlug?: string;
  error?: string;
};

type ImportSummary = {
  total: number;
  created: number;
  updated: number;
  renamed: number;
  skipped: number;
  errors: number;
  results: ImportItemResult[];
};

export interface ExportImportToolbarProps {
  exportPath: string;     // e.g. "/api/embed/widgets/export"
  importPath: string;     // e.g. "/api/embed/widgets/import"
  downloadName: string;   // base filename, ".json" appended
  selectedIds?: number[];
  onImported?: () => void;
}

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function ExportImportToolbar({
  exportPath,
  importPath,
  downloadName,
  selectedIds = [],
  onImported,
}: ExportImportToolbarProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [conflict, setConflict] = useState<"skip" | "overwrite" | "rename">("skip");
  const [parsedEnvelope, setParsedEnvelope] = useState<unknown>(null);
  const [parsedCount, setParsedCount] = useState(0);
  const [parsedError, setParsedError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const env = await customFetch<unknown>(exportPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds.length > 0 ? selectedIds : undefined }),
      });
      const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${downloadName}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: t("exportImport.exportSuccess") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t("exportImport.exportFailed"), description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  function resetImport() {
    setParsedEnvelope(null);
    setParsedCount(0);
    setParsedError(null);
    setSummary(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParsedEnvelope(null);
    setParsedError(null);
    setParsedCount(0);
    setSummary(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setParsedError(t("exportImport.errorTooLarge"));
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { kind?: unknown; version?: unknown; items?: unknown };
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
        setParsedError(t("exportImport.errorInvalidFile"));
        return;
      }
      setParsedEnvelope(parsed);
      setParsedCount(parsed.items.length);
    } catch {
      setParsedError(t("exportImport.errorInvalidJson"));
    }
  }

  async function handleImport() {
    if (!parsedEnvelope) return;
    setImporting(true);
    setSummary(null);
    try {
      const result = await customFetch<ImportSummary>(importPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope: parsedEnvelope, conflict }),
      });
      setSummary(result);
      onImported?.();
      toast({
        title: t("exportImport.importSuccess"),
        description: t("exportImport.importSummary", {
          created: String(result.created),
          updated: String(result.updated),
          renamed: String(result.renamed),
          skipped: String(result.skipped),
          errors: String(result.errors),
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: t("exportImport.importFailed"), description: msg, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} data-testid="button-export">
          {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {selectedIds.length > 0
            ? t("exportImport.exportSelected", { count: String(selectedIds.length) })
            : t("exportImport.exportAll")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => { resetImport(); setImportDialog(true); }} data-testid="button-import">
          <Upload className="w-4 h-4 mr-2" />
          {t("exportImport.import")}
        </Button>
      </div>

      <Dialog open={importDialog} onOpenChange={(o) => { setImportDialog(o); if (!o) resetImport(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("exportImport.importTitle")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">{t("exportImport.selectFile")}</Label>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFile}
                className="block w-full mt-1 text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-muted file:text-sm file:cursor-pointer"
                data-testid="input-import-file"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{t("exportImport.fileHint")}</p>
            </div>

            {parsedError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {parsedError}
              </div>
            )}

            {parsedEnvelope && !parsedError && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
                <div><strong>{parsedCount}</strong> {t("exportImport.itemsDetected")}</div>
              </div>
            )}

            <div>
              <Label className="text-xs">{t("exportImport.conflictStrategy")}</Label>
              <div className="mt-2 space-y-1.5">
                {(["skip", "overwrite", "rename"] as const).map((v) => (
                  <label key={v} className="flex items-start gap-2 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name="conflict"
                      value={v}
                      checked={conflict === v}
                      onChange={() => setConflict(v)}
                      className="mt-0.5"
                      data-testid={`radio-conflict-${v}`}
                    />
                    <span>
                      <strong>{t(`exportImport.conflict_${v}`)}</strong>
                      <span className="text-muted-foreground"> — {t(`exportImport.conflict_${v}_desc`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {summary && (
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1" data-testid="import-summary">
                <div className="font-semibold">{t("exportImport.resultsTitle")}</div>
                <div>{t("exportImport.summaryCreated", { n: String(summary.created) })}</div>
                <div>{t("exportImport.summaryUpdated", { n: String(summary.updated) })}</div>
                <div>{t("exportImport.summaryRenamed", { n: String(summary.renamed) })}</div>
                <div>{t("exportImport.summarySkipped", { n: String(summary.skipped) })}</div>
                <div>{t("exportImport.summaryErrors", { n: String(summary.errors) })}</div>
                {summary.results.some((r) => r.status === "error") && (
                  <ul className="mt-2 list-disc list-inside text-destructive max-h-32 overflow-y-auto">
                    {summary.results.filter((r) => r.status === "error").map((r) => (
                      <li key={r.index}>{r.slug || `#${r.index}`}: {r.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportDialog(false); resetImport(); }}>
              {t("exportImport.close")}
            </Button>
            <Button onClick={handleImport} disabled={!parsedEnvelope || !!parsedError || importing} data-testid="button-import-confirm">
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {t("exportImport.runImport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
