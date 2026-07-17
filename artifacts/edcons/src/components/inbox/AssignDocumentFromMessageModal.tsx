import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  FileText,
  GraduationCap,
  ScrollText,
  Shield,
  Camera,
  Loader2,
  CheckCircle2,
  Briefcase,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { customFetch } from "@workspace/api-client-react";
import { useStudyLevels } from "@/hooks/useStudyLevels";
import type { AddDocTarget } from "./AddAsDocumentModal";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface DocReq {
  documentType: string;
  mandatory: boolean;
  sortOrder: number;
}

const DOC_ICONS: Record<string, typeof FileText> = {
  diploma: GraduationCap,
  diploma_certificate: GraduationCap,
  transcript: ScrollText,
  diploma_transcript: ScrollText,
  passport: Shield,
  photograph: Camera,
  photo: Camera,
  cv: Briefcase,
};

function getDocIcon(key: string): typeof FileText {
  return DOC_ICONS[key.toLowerCase()] ?? FileText;
}

interface AssignDocumentFromMessageModalProps {
  convId: number;
  target: AddDocTarget;
  ownerType?: "lead" | "student" | "unmatched";
  owner: { id: number; interestedLevel?: string | null };
  onClose: () => void;
  onSaved: () => void;
}

export function AssignDocumentFromMessageModal({
  convId,
  target,
  ownerType = "student",
  owner,
  onClose,
  onSaved,
}: AssignDocumentFromMessageModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [localLevel, setLocalLevel] = useState<string>("");

  const { levels } = useStudyLevels({ onlyEnabled: true });

  const level = owner.interestedLevel ?? localLevel;

  const docLabel = (docType: string) => {
    const k = `docTypes.${docType.toLowerCase()}`;
    const v = t(k);
    return v !== k ? v : docType;
  };

  const { data: docReqs = [], isLoading } = useQuery<DocReq[]>({
    queryKey: ["degree-doc-reqs-assign-msg", level],
    queryFn: () =>
      fetch(
        `${BASE_URL}/api/degrees/by-value/${encodeURIComponent(level)}/document-requirements`,
        { credentials: "include" }
      ).then((r) => (r.ok ? r.json() : [])),
    enabled: !!level,
    staleTime: 30_000,
  });

  const isUnmatched = ownerType === "unmatched";

  const existingDocsKey = ["existing-doc-types-assign", ownerType, owner.id];
  const { data: existingDocs = [] } = useQuery<Array<{ type: string }>>({
    queryKey: existingDocsKey,
    queryFn: () =>
      fetch(
        `${BASE_URL}/api/${ownerType === "student" ? "students" : "leads"}/${owner.id}/documents`,
        { credentials: "include" }
      ).then((r) => (r.ok ? r.json() : [])),
    enabled: !isUnmatched && owner.id > 0,
    staleTime: 10_000,
  });

  const filledTypes = new Set(existingDocs.map((d: any) => d.type));

  const sortedReqs = [...docReqs].sort((a, b) => a.sortOrder - b.sortOrder);

  async function handlePick(docType: string) {
    if (!isUnmatched && filledTypes.has(docType)) return;
    setSaving(docType);
    try {
      let resolvedOwnerType: "lead" | "student" = ownerType === "student" ? "student" : "lead";
      let resolvedOwnerId = owner.id;

      if (isUnmatched) {
        const matchRes = (await customFetch(
          `/api/inbox/conversations/${convId}/match/new-lead`,
          { method: "POST", headers: { "Content-Type": "application/json" } }
        )) as any;
        resolvedOwnerId = matchRes?.leadId ?? matchRes?.id;
        if (!resolvedOwnerId) throw new Error("lead_create_failed");
        resolvedOwnerType = "lead";
      }

      const result = (await customFetch(
        `/api/inbox/conversations/${convId}/messages/${target.msgId}/attachments/${target.attachIdx}/save-as-document`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerType: resolvedOwnerType,
            ownerId: resolvedOwnerId,
            documentType: docType,
            setAsPhoto: docType === "photo" || docType === "photograph",
          }),
        }
      )) as any;

      void queryClient.invalidateQueries({ queryKey: existingDocsKey });
      if (result?.conflict) {
        onSaved();
        return;
      }
      setSaved((prev) => new Set([...prev, docType]));
      onSaved();
    } catch (err: any) {
      const msg = err?.data?.error || err?.body?.error || err?.message;
      toast({
        title: t("inbox.addAsDoc.failed"),
        description: typeof msg === "string" ? msg : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  }

  const displayName = target.attachName && target.attachName !== "file"
    ? target.attachName
    : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {t("inbox.studentTab.selectDocType")}
          </DialogTitle>
        </DialogHeader>

        <div className="py-1 space-y-3">
          {displayName && (
            <p className="text-xs text-muted-foreground truncate" title={displayName}>
              {displayName}
            </p>
          )}

          {!level && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t("inbox.studentTab.selectLevelFirst")}
              </p>
              <Select value={localLevel} onValueChange={setLocalLevel}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("inbox.studentTab.selectLevel")} />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((l) => (
                    <SelectItem key={l.key} value={l.key} className="text-xs">
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {level && (
            isLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>…</span>
              </div>
            ) : sortedReqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("inbox.studentTab.noDocReqs")}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sortedReqs.map((req) => {
                  const Icon = getDocIcon(req.documentType);
                  const isSaved = saved.has(req.documentType);
                  const isSaving = saving === req.documentType;
                  const isFilled = !isUnmatched && filledTypes.has(req.documentType);
                  const isDisabled = !!saving || isFilled;
                  return (
                    <button
                      key={req.documentType}
                      type="button"
                      onClick={() => void handlePick(req.documentType)}
                      disabled={isDisabled}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center cursor-pointer transition-colors ${
                        isFilled
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 cursor-default opacity-80"
                          : isSaved
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-border hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                      }`}
                    >
                      {isSaving ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (isSaved || isFilled) ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                      <span className="text-xs font-medium leading-tight">
                        {docLabel(req.documentType)}
                      </span>
                      {(isSaved || isFilled) && (
                        <span className="text-[10px] text-emerald-600">
                          {t("inbox.studentTab.filled")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={!!saving}
          >
            {t("inbox.studentTab.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
