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
  const tr = lang === "tr";
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
      create: tr ? "Eklenecek" : "Create",
      update: tr ? "Güncellenecek" : "Update",
      unchanged: tr ? "Değişiklik yok" : "Unchanged",
      error: tr ? "Hatalı" : "Error",
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
        [
          "Guide",
          tr
            ? "Title zorunludur. RecordId varsa sadece bu pipeline içindeki kayıt güncellenir. StageId/Stage ve AssigneeId/Assignee bu pipeline’a ait olmalıdır. DueDate: YYYY-MM-DD. Notlar ve takipler bu dosyayla değiştirilmez."
            : "Title is required. RecordId updates only an existing record in this pipeline. Stage/assignee must belong to this pipeline. DueDate: YYYY-MM-DD. Notes and follow-ups are preserved.",
        ],
        [
          "Stages",
          tr
            ? "Aşama adlarını mevcut pipeline’dan alın. Boş aşama yeni kayıtta ilk aşamayı kullanır."
            : "Use this pipeline’s stage names. Blank stage uses the first stage for a new record.",
        ],
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
      setError(e.message);
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
        throw Error(
          tr ? "Dosya en fazla 5 MB olabilir." : "Maximum file size is 5 MB.",
        );
      if (!/\.(xlsx|xls|csv)$/i.test(file.name))
        throw Error(
          tr ? "Excel veya CSV seçin." : "Choose an Excel or CSV file.",
        );
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellFormula: true,
        raw: true,
        sheetRows: 2002,
      });
      const records = wb.Sheets.Records ?? wb.Sheets[wb.SheetNames[0]];
      if (!records)
        throw Error(tr ? "Veri sayfası bulunamadı." : "Data sheet not found.");
      for (const [cell, value] of Object.entries(records))
        if (!cell.startsWith("!") && (value as any)?.f)
          throw Error(
            tr
              ? "Formül yerine sabit değerler kullanın."
              : "Use fixed values instead of formulas.",
          );
      const rows = XLSX.utils.sheet_to_json<
        Record<string, string | number | null>
      >(records, { defval: "", raw: false });
      if (!rows.length || rows.length > 2000)
        throw Error(
          tr
            ? "Dosya 1–2000 kayıt içermeli."
            : "File must contain 1–2000 records.",
        );
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
      setError(e.message);
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
      setError(e.message);
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
        title={
          tr
            ? "Yalnız bu pipeline ve etkin filtrelerin tüm sonuçları"
            : "Only this pipeline, all results matching active filters"
        }
      >
        <Download className="w-4 h-4" />
        {tr ? "Excel dışa aktar" : "Export Excel"}
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
        {tr ? "Excel içe aktar" : "Import Excel"}
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tr ? "Excel içe aktar" : "Import Excel"} · {name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tr
              ? "Bu işlem yalnız seçili pipeline’a uygulanır. Önce şablonu indirin, kayıtları doldurun ve önizleyin. Diğer pipeline’lar etkilenmez."
              : "Applies only to the selected pipeline. Download its template, fill in records and preview before importing. Other pipelines are unaffected."}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void exporting(true)}
          >
            {tr
              ? "Bu pipeline’ın şablonunu indir"
              : "Download this pipeline’s template"}
          </Button>
          <Label htmlFor="pipeline-import-file">
            {tr ? "Excel / CSV dosyası" : "Excel / CSV file"}
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
          {busy && <p role="status">{tr ? "İşleniyor…" : "Processing…"}</p>}
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
                      <TableHead>{tr ? "Satır" : "Row"}</TableHead>
                      <TableHead>{tr ? "Başlık" : "Title"}</TableHead>
                      <TableHead>{tr ? "Sonuç" : "Result"}</TableHead>
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
                          {r.error || label(r.action)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {preview.committed ? (
                <p role="status" className="text-green-700">
                  {tr ? "İçe aktarma tamamlandı." : "Import completed."}
                </p>
              ) : (
                <Button
                  disabled={busy || Boolean(preview.counts.error)}
                  onClick={() => void commit()}
                >
                  {tr
                    ? "Önizlenen kayıtları içe aktar"
                    : "Import previewed records"}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
