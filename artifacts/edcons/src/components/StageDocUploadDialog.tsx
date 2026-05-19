import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Upload, FileCheck, Loader2, AlertTriangle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages } from "@/hooks/use-pipeline-stages";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function getCsrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

interface StageDocUploadDialogProps {
  open: boolean;
  onClose: () => void;
  applicationId: number;
  targetStage: string;
  targetStageLabel: string;
  onUploaded: () => void;
  /**
   * Task #167 — stage the document is stored against (the "from" stage in
   * a stage-action button flow). When omitted, defaults to targetStage,
   * preserving the original DOCS_REQUIRED behavior used by drag-and-drop.
   */
  uploadStage?: string;
  /**
   * Task #167 — when set, uploaded files are renamed to this document name
   * (extension preserved). Used by stage-action buttons so the saved file
   * matches the admin-configured Document Name.
   */
  documentNameOverride?: string | null;
  /**
   * Task #167 — when false, skip the stage PATCH after upload ("Don't
   * change" target). Defaults to true to preserve drag-and-drop behavior.
   */
  moveAfterUpload?: boolean;
  /**
   * Task #167 — quick-button mode. When true, the dialog acts as a
   * standalone "upload a specific document and (optionally) move stage"
   * flow. It bypasses the stage's tracksOfferExpiry / requiresValidUntil
   * checks (those belong to the stage-entry flow, not to ad-hoc admin
   * actions configured via Quick Button) and uses neutral wording instead
   * of the "stage requires a document" message.
   */
  quickMode?: boolean;
}

export function StageDocUploadDialog({ open, onClose, applicationId, targetStage, targetStageLabel, onUploaded, uploadStage, documentNameOverride, moveAfterUpload = true, quickMode = false }: StageDocUploadDialogProps) {
  const docStage = uploadStage || targetStage;
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { stages: pipelineStages } = usePipelineStages("application");
  const targetStageMeta = pipelineStages.find(s => s.key === docStage);
  // In quick-button mode the validity-date field is intentionally hidden:
  // the admin's button is meant to be a discrete action, not the formal
  // stage-entry that records offer expiry.
  const supportsValidUntil = !quickMode && targetStageMeta?.tracksOfferExpiry === true;
  const requiresValidUntil = !quickMode && targetStageMeta?.requiresValidUntil === true;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleUploadAndMove() {
    if (files.length === 0) {
      toast({ title: "Please select at least one document to upload", variant: "destructive" });
      return;
    }
    if (requiresValidUntil && !validUntil) {
      toast({ title: "Son geçerlilik tarihi zorunlu", description: "Offer letter için lütfen geçerlilik tarihi seçin.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // When admin configured a Document Name, send it as
        // documentNameOverride so backend persists it as the canonical
        // filename (priority over descriptive student name). Multi-upload
        // gets a numeric suffix appended to the override.
        const suffix = documentNameOverride && files.length > 1 ? ` (${idx + 1})` : "";
        const overrideForRequest = documentNameOverride
          ? `${documentNameOverride}${suffix}`
          : undefined;

        const res = await fetch(`${BASE_URL}/api/applications/${applicationId}/stage-documents`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          credentials: "include",
          body: JSON.stringify({
            stage: docStage,
            fileName: file.name,
            fileData: base64,
            mimeType: file.type,
            sizeBytes: file.size,
            ...(overrideForRequest ? { documentNameOverride: overrideForRequest } : {}),
            ...(supportsValidUntil && validUntil ? { validUntil } : {}),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error || "Upload failed");
        }
      }

      if (moveAfterUpload) {
        const stageRes = await fetch(`${BASE_URL}/api/applications/${applicationId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": getCsrfToken(),
          },
          credentials: "include",
          body: JSON.stringify({ stage: targetStage }),
        });

        if (!stageRes.ok) {
          const err = await stageRes.json().catch(() => ({ error: "Stage update failed" }));
          throw new Error(err.error || "Stage update failed");
        }
        toast({ title: `Documents uploaded and moved to ${targetStageLabel}` });
      } else {
        toast({ title: "Belge yüklendi" });
      }
      setFiles([]);
      setValidUntil("");
      onUploaded();
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    if (!uploading) {
      setFiles([]);
      setValidUntil("");
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {quickMode ? (
              <Upload className="w-5 h-5 text-primary" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
            {quickMode
              ? (documentNameOverride ? `${documentNameOverride} Yükle` : "Belge Yükle")
              : "Document Required"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {quickMode ? (
            <p className="text-sm text-muted-foreground">
              {documentNameOverride
                ? <>Bu başvuru için <strong>{documentNameOverride}</strong> belgesini yükleyin.</>
                : "Bu başvuru için belge yükleyin."}
              {moveAfterUpload && <> Yükleme tamamlandığında başvuru <strong>{targetStageLabel}</strong> aşamasına geçecek.</>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The <strong>{targetStageLabel}</strong> stage requires at least one document to be uploaded before the application can be moved.
            </p>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Upload Documents</Label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Click to select files</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, Images, Documents</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {supportsValidUntil && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Son Geçerlilik Tarihi {requiresValidUntil && <span className="text-destructive">*</span>}
              </Label>
              <Input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                disabled={uploading}
              />
              <p className="text-xs text-muted-foreground">
                Offer letter'ın geçerli olduğu son tarih. Yaklaştığında bildirim gönderilir.
              </p>
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Selected Files ({files.length})</Label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-secondary/50 rounded-lg text-xs">
                    <FileCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => removeFile(i)} className="p-0.5 hover:bg-destructive/10 rounded" disabled={uploading}>
                      <X className="w-3 h-3 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={uploading}>Cancel</Button>
          <Button onClick={handleUploadAndMove} disabled={uploading || files.length === 0}>
            {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : `Upload & Move to ${targetStageLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
