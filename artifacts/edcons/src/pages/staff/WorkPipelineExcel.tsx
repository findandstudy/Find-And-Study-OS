import { workPipelineError } from "@/lib/workPipelineI18n";
import { useI18n } from "@/hooks/use-i18n";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
} from "@/components/ui/table";
import { request } from "./useWorkPipelines";

type Preview = {
  boardId: string;
  boardName: string;
  previewHash: string;
  counts: Record<string, number>;
  rows: { row: number; action: string; title: string; error: string }[];
  committed: boolean;
};
type ExportData = {
  boardId: string;
  boardName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
  stages: { id: string; name: string }[];
  assignees: { id: number; name: string }[];
};
const filename = (name: string) =>
  name.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80);

export function WorkPipelineExcel({
  id,
  name,
  lang,
  archived,
  query,
  stage,
  assignee,
  refresh,
}: {
  id: string;
  name: string;
  lang: string;
  archived: boolean;
  query: string;
  stage: string;
  assignee: string;
  refresh: () => Promise<void>;
}) {
  const { t, isRTL } = useI18n();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [payload, setPayload] = useState<{
      sourceBoardId?: string;
      rows: Record<string, string | number | null>[];
    } | null>(null);
  const [fileName, setFileName] = useState("");
  const label = (a: string) =>
    ({
      create: t("workPipelines.createText"),
      update: t("workPipelines.update"),
      unchanged: t("workPipelines.unchanged"),
      error: t("workPipelines.errorText"),
    })[a] || a;
  const saveFile = async (data: ExportData, template = false) => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      data.columns,
      ...(template
        ? []
        : data.rows.map((r) => data.columns.map((c) => r[c] ?? ""))),
    ]);
    sheet["!cols"] = data.columns.map((c) => ({
      wch: c === "Description" ? 55 : c.includes("Id") ? 38 : 25,
    }));
    XLSX.utils.book_append_sheet(wb, sheet, "Records");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["PipelineId", id],
        ["PipelineName", name],
        ["MaximumRows", data.limit],
        ["Guide", t("workPipelines.titleIsRequiredRecordIdUpdates")],
        ["Stages", t("workPipelines.useThisPipelinesStageNames")],
        ["Priority", "low | normal | high"],
        ["Status", "active | waiting | done | cancelled"],
      ]),
      "Pipeline",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.stages, { header: ["id", "name"] }),
      "Stages",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.assignees, { header: ["id", "name"] }),
      "Assignees",
    );
    // aoa_to_sheet writes user text as string cells, never formula cells.
    XLSX.writeFile(
      wb,
      `${filename(name)}_${template ? "template" : new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };
  const exporting = async (template = false) => {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: template ? "" : query,
        stage: template ? "all" : stage,
        assignee: template ? "all" : assignee,
        template: String(template),
      });
      const data = await request<ExportData>(
        `/${id}/transfer/export?${params}`,
      );
      await saveFile(data, template);
    } catch (e: any) {
      setError(workPipelineError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const parse = async (file: File) => {
    setBusy(true);
    setError("");
    setPreview(null);
    setPayload(null);
    setFileName(file.name);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error(t("workPipelines.maximumFileSizeIs5"));
      if (!/\.(xlsx|xls|csv)$/i.test(file.name))
        throw Error(t("workPipelines.chooseAnExcelOrCSV"));
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellFormula: true,
        raw: true,
        sheetRows: 2002,
      });
      const records = wb.Sheets.Records ?? wb.Sheets[wb.SheetNames[0]];
      if (!records) throw Error(t("workPipelines.dataSheetNotFound"));
      for (const [cell, value] of Object.entries(records))
        if (!cell.startsWith("!") && (value as any)?.f)
          throw Error(t("workPipelines.useFixedValuesInsteadOf"));
      const rows = XLSX.utils.sheet_to_json<
        Record<string, string | number | null>
      >(records, { defval: "", raw: false });
      if (!rows.length || rows.length > 2000)
        throw Error(t("workPipelines.fileMustContain12000Records"));
      let sourceBoardId: string | undefined;
      if (wb.Sheets.Pipeline) {
        const meta = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Pipeline, {
          header: 1,
          raw: false,
        });
        sourceBoardId =
          String(meta.find((r) => r[0] === "PipelineId")?.[1] ?? "") ||
          undefined;
      }
      const input = { ...(sourceBoardId ? { sourceBoardId } : {}), rows };
      const result = await request<Preview>(
        `/${id}/transfer/preview`,
        "POST",
        input,
      );
      setPayload(input);
      setPreview(result);
    } catch (e: any) {
      setError(workPipelineError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview || !payload) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<Preview>(`/${id}/transfer/import`, "POST", {
        ...payload,
        previewHash: preview.previewHash,
      });
      setPreview(result);
      await refresh();
    } catch (e: any) {
      setError(workPipelineError(e, t));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="outline"
        className="rounded-full gap-2"
        disabled={busy}
        onClick={() => void exporting()}
        title={t("workPipelines.onlyThisPipelineAllResults")}
      >
        <Download className="w-4 h-4" />
        {t("workPipelines.exportExcel")}
      </Button>
      <Button
        variant="outline"
        className="rounded-full gap-2"
        disabled={archived || busy}
        onClick={() => {
          setOpen(true);
          setError("");
          setPreview(null);
          setPayload(null);
          setFileName("");
        }}
      >
        <Upload className="w-4 h-4" />
        {t("workPipelines.importExcel")}
      </Button>
      {error && !open && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent
          closeLabel={t("common.close")}
          dir={isRTL ? "rtl" : "ltr"}
          className="sm:max-w-3xl max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle>
              {t("workPipelines.importExcel")} · {name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("workPipelines.appliesOnlyToTheSelected")}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void exporting(true)}
          >
            {t("workPipelines.downloadThisPipelinesTemplate")}
          </Button>
          <Label htmlFor="pipeline-import-file">
            {t("workPipelines.excelCSVFile")}
          </Label>
          <input
            id="pipeline-import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void parse(f);
              e.target.value = "";
            }}
          />
          {fileName && (
            <p className="text-xs text-muted-foreground">{fileName}</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {busy && <p role="status">{t("workPipelines.processing")}</p>}
          {preview && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                {Object.entries(preview.counts).map(([a, n]) => (
                  <span key={a}>
                    {label(a)}: <strong>{n}</strong>
                  </span>
                ))}
              </div>
              <div className="max-h-72 overflow-auto border rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("workPipelines.row")}</TableHead>
                      <TableHead>{t("workPipelines.titleText")}</TableHead>
                      <TableHead>{t("workPipelines.result")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => (
                      <TableRow key={r.row}>
                        <TableCell>{r.row}</TableCell>
                        <TableCell>{r.title}</TableCell>
                        <TableCell
                          className={r.error ? "text-destructive" : ""}
                        >
                          {r.error
                            ? t("workPipelines.invalidRow")
                            : label(r.action)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.committed ? (
                <p role="status" className="text-green-700">
                  {t("workPipelines.importCompleted")}
                </p>
              ) : (
                <Button
                  disabled={busy || Boolean(preview.counts.error)}
                  onClick={() => void commit()}
                >
                  {t("workPipelines.importPreviewedRecords")}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
