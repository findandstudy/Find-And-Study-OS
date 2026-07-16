import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FilePlus2, FileText, GraduationCap, ScrollText, Shield, Camera, Loader2, Eye, RefreshCw, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { customFetch } from "@workspace/api-client-react";

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
}: AddAsDocumentModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [step, setStep] = useState<"type-select" | "photo-confirm" | "conflict">("type-select");
  const [selectedType, setSelectedType] = useState<DocType | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflictDocId, setConflictDocId] = useState<number | null>(null);

  async function callSave(documentType: DocType, force = false): Promise<"ok" | "conflict"> {
    const res = await customFetch(
      `/api/inbox/conversations/${convId}/messages/${target.msgId}/attachments/${target.attachIdx}/save-as-document`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerType, ownerId, documentType, force }),
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

  async function doSave(type: DocType, force = false) {
    setSaving(true);
    try {
      const result = await callSave(type, force);
      if (result === "conflict") {
        setStep("conflict");
        return;
      }
      const typeName = t(`inbox.addAsDoc.${type}`);
      toast({ title: t("inbox.addAsDoc.added", { type: typeName, name: ownerName }) });
      onSaved();
      onClose();
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
      // ignore
    }
    await doSave(selectedType, false);
  }

  async function handleAddAsNew() {
    if (!selectedType) return;
    await doSave(selectedType, true);
  }

  const typeLabel = selectedType ? t(`inbox.addAsDoc.${selectedType}`) : "";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FilePlus2 className="w-4 h-4" />
            {step === "type-select" && t("inbox.addAsDoc.title")}
            {step === "photo-confirm" && t("inbox.addAsDoc.photoConfirm.title")}
            {step === "conflict" && t("inbox.addAsDoc.conflict.title")}
          </DialogTitle>
        </DialogHeader>

        {/* File preview */}
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

            <p className="text-xs text-muted-foreground">{t("inbox.addAsDoc.selectType")}</p>
            <div className="grid grid-cols-2 gap-2">
              {DOC_TYPES.map((type) => {
                const Icon = DOC_ICONS[type];
                return (
                  <Button
                    key={type}
                    variant="outline"
                    className="h-14 flex-col gap-1 text-xs"
                    disabled={saving}
                    onClick={() => void handleTypeSelect(type)}
                  >
                    <Icon className="w-4 h-4" />
                    {t(`inbox.addAsDoc.${type}`)}
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
                onClick={() => void doSave("photograph", false)}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Camera className="w-4 h-4 me-2" />}
                {t("inbox.addAsDoc.photoConfirm.setPhoto")}
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                className="w-full"
                onClick={() => void doSave("photograph", false)}
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
                onClick={() => {
                  if (conflictDocId) {
                    window.open(`/staff/students`, "_blank");
                  }
                  onClose();
                }}
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

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t("inbox.addAsDoc.conflict.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
