import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FilePlus2, FileText, GraduationCap, ScrollText, Shield, Camera,
  Loader2, Eye, RefreshCw, Copy, CheckCircle2, Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { customFetch } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface AddDocTarget {
  msgId: number;
  attachIdx: number;
  attachUrl: string;
  attachName: string;
  isImage: boolean;
}

interface AddAsDocumentModalProps {
  convId: number;
  target: AddDocTarget;
  ownerType: "lead" | "student";
  ownerId: number;
  ownerName: string;
  onClose: () => void;
  onSaved: () => void;
  onAnalyze?: () => void;
}

const DOC_TYPES = ["diploma", "transcript", "passport", "photograph"] as const;
type DocType = typeof DOC_TYPES[number];

const DOC_ICONS: Record<DocType, typeof GraduationCap> = {
  diploma: GraduationCap,
  transcript: ScrollText,
  passport: Shield,
  photograph: Camera,
};

export function AddAsDocumentModal({
  convId,
  target,
  ownerType,
  ownerId,
  ownerName,
  onClose,
  onSaved,
  onAnalyze,
}: AddAsDocumentModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [step, setStep] = useState<"type-select" | "photo-confirm" | "conflict">("type-select");
  const [selectedType, setSelectedType] = useState<DocType | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflictDocId, setConflictDocId] = useState<number | null>(null);
  // Track which document types have been successfully saved this session
  const [addedTypes, setAddedTypes] = useState<Set<DocType>>(new Set());

  async function callSave(documentType: DocType, force = false, setAsPhoto = true): Promise<"ok" | "conflict"> {
    const res = await customFetch(
      `/api/inbox/conversations/${convId}/messages/${target.msgId}/attachments/${target.attachIdx}/save-as-document`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerType, ownerId, documentType, force, setAsPhoto }),
      }
    ) as any;
    if (res?.conflict) {
      setConflictDocId(res.existingDocumentId ?? null);
      return "conflict";
    }
    return "ok";
  }

  async function handleTypeSelect(type: DocType) {
    setSelectedType(type);
    if (type === "photograph") {
      setStep("photo-confirm");
      return;
    }
    await doSave(type);
  }

  async function doSave(type: DocType, force = false, setAsPhoto = true) {
    setSaving(true);
    try {
      const result = await callSave(type, force, setAsPhoto);
      if (result === "conflict") {
        setStep("conflict");
        return;
      }
      const typeName = t(`inbox.addAsDoc.${type}`);
      toast({ title: t("inbox.addAsDoc.added", { type: typeName, name: ownerName }) });
      onSaved();
      // Mark type as added and return to type-select (keep modal open)
      setAddedTypes((prev) => new Set([...prev, type]));
      setStep("type-select");
      setSelectedType(null);
    } catch (err: any) {
      const msg = err?.data?.error || err?.body?.error || err?.message;
      toast({ title: t("inbox.addAsDoc.failed"), description: typeof msg === "string" ? msg : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReplace() {
    if (!conflictDocId || !selectedType) return;
    setSaving(true);
    try {
      await customFetch(`/api/documents/${conflictDocId}`, { method: "DELETE" });
    } catch {
      // ignore — proceed with save regardless
    }
    await doSave(selectedType, false);
  }

  async function handleAddAsNew() {
    if (!selectedType) return;
    await doSave(selectedType, true);
  }

  function handleViewExisting() {
    if (!conflictDocId) return;
    window.open(`${BASE_URL}/api/documents/${conflictDocId}/download?disposition=inline`, "_blank", "noopener,noreferrer");
  }

  function handleAnalyze() {
    onSaved();
    onAnalyze?.();
    onClose();
  }

  const typeLabel = selectedType ? t(`inbox.addAsDoc.${selectedType}`) : "";
  const hasAdded = addedTypes.size > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FilePlus2 className="w-4 h-4" />
            {step === "type-select" && t("inbox.addAsDoc.title")}
            {step === "photo-confirm" && t("inbox.addAsDoc.photoConfirm.title")}
            {step === "conflict" && t("inbox.addAsDoc.conflict.title")}
          </DialogTitle>
        </DialogHeader>

        {/* File preview + type select */}
        {step === "type-select" && (
          <div className="flex flex-col gap-3">
            {target.isImage && target.attachUrl ? (
              <div className="rounded-lg overflow-hidden border bg-muted max-h-40 flex items-center justify-center">
                <img
                  src={target.attachUrl}
                  alt={target.attachName}
                  className="max-h-40 max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{target.attachName}</span>
              </div>
            )}

            {/* Added types summary */}
            {hasAdded && (
              <div className="flex flex-wrap gap-1.5">
                {[...addedTypes].map((type) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] text-emerald-700"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {t(`inbox.addAsDoc.${type}`)}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">{t("inbox.addAsDoc.selectType")}</p>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map((type) => {
                const Icon = DOC_ICONS[type];
                const isAdded = addedTypes.has(type);
                return (
                  <Button
                    key={type}
                    variant={isAdded ? "secondary" : "outline"}
                    className="h-14 flex-col gap-1 text-xs relative"
                    disabled={saving}
                    onClick={() => void handleTypeSelect(type)}
                  >
                    {isAdded ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                    {t(`inbox.addAsDoc.${type}`)}
                    {isAdded && (
                      <span className="absolute top-1 right-1 text-[9px] text-emerald-600">
                        {t("inbox.addAsDoc.addedBadge")}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
            {saving && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("inbox.addAsDoc.adding")}
              </div>
            )}
          </div>
        )}

        {/* Photo confirmation */}
        {step === "photo-confirm" && (
          <div className="flex flex-col gap-3">
            {target.isImage && target.attachUrl && (
              <div className="rounded-lg overflow-hidden border bg-muted max-h-40 flex items-center justify-center">
                <img
                  src={target.attachUrl}
                  alt={target.attachName}
                  className="max-h-40 max-w-full object-contain"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button
                disabled={saving}
                className="w-full"
                onClick={() => void doSave("photograph", false, true)}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Camera className="w-4 h-4 me-2" />}
                {t("inbox.addAsDoc.photoConfirm.setPhoto")}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                className="w-full"
                onClick={() => void doSave("photograph", false, false)}
              >
                {t("inbox.addAsDoc.photoConfirm.docOnly")}
              </Button>
            </div>
          </div>
        )}

        {/* Conflict */}
        {step === "conflict" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t("inbox.addAsDoc.conflict.body", { type: typeLabel })}
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                disabled={saving}
                className="w-full justify-start gap-2"
                onClick={handleViewExisting}
              >
                <Eye className="w-4 h-4" />
                {t("inbox.addAsDoc.conflict.viewExisting")}
              </Button>
              <Button
                disabled={saving}
                className="w-full justify-start gap-2"
                onClick={() => void handleReplace()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {t("inbox.addAsDoc.conflict.replaceExisting")}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                className="w-full justify-start gap-2"
                onClick={() => void handleAddAsNew()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                {t("inbox.addAsDoc.conflict.addAsNew")}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {hasAdded ? t("inbox.addAsDoc.done") : t("inbox.addAsDoc.conflict.cancel")}
          </Button>
          {hasAdded && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAnalyze}
              disabled={saving}
              className="gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t("inbox.addAsDoc.analyze")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
