import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight, Building, Check, Loader2, Pencil, X,
  FileText, GraduationCap, ScrollText, Shield, Camera,
  CheckCircle2, Circle, MoreHorizontal, Eye, Download, Trash2, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { customFetch } from "@workspace/api-client-react";
import type { InboxConversationDetailResponse } from "@workspace/api-client-react";
import { PipelineStageBadge } from "./PipelineStageBadge";
import { AiSummaryCard } from "./AiSummaryCard";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface LeadDetailSidebarProps {
  detail: InboxConversationDetailResponse;
  conversationId?: number | null;
  docSummaryRefreshKey?: number;
  onOpenMatchDialog?: () => void;
  onSummarize: () => void;
  isSummarizing: boolean;
  onUpdated?: () => void;
}

type LinkedType = "lead" | "student" | "agent";

type DocSummary = {
  diploma: { exists: boolean; documentId: number | null };
  transcript: { exists: boolean; documentId: number | null };
  passport: { exists: boolean; documentId: number | null };
  photograph: { exists: boolean; documentId: number | null };
};

const DOC_TYPE_ICONS: Record<string, typeof FileText> = {
  diploma: GraduationCap,
  transcript: ScrollText,
  passport: Shield,
  photograph: Camera,
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm break-words">{value}</div>
    </div>
  );
}

function EditableField({
  label,
  value,
  fieldKey,
  editingKey,
  setEditingKey,
  onSave,
  saving,
  type = "text",
}: {
  label: string;
  value: string | null | undefined;
  fieldKey: string;
  editingKey: string | null;
  setEditingKey: (k: string | null) => void;
  onSave: (fieldKey: string, newValue: string) => Promise<void>;
  saving: boolean;
  type?: string;
}) {
  const [draft, setDraft] = useState("");
  const isEditing = editingKey === fieldKey;

  return (
    <div className="group" data-testid={`sidebar-field-${fieldKey}`}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      {isEditing ? (
        <div className="flex items-center gap-1 mt-0.5">
          <Input
            autoFocus
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSave(fieldKey, draft);
              if (e.key === "Escape") setEditingKey(null);
            }}
            className="h-7 text-sm"
            data-testid={`sidebar-input-${fieldKey}`}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            disabled={saving}
            onClick={() => void onSave(fieldKey, draft)}
            data-testid={`sidebar-save-${fieldKey}`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-emerald-600" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            disabled={saving}
            onClick={() => setEditingKey(null)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-sm break-words min-w-0">{value?.trim() ? value : "—"}</span>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDraft(value ?? "");
              setEditingKey(fieldKey);
            }}
            data-testid={`sidebar-edit-${fieldKey}`}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export function LeadDetailSidebar({
  detail,
  conversationId,
  docSummaryRefreshKey = 0,
  onOpenMatchDialog,
  onSummarize,
  isSummarizing,
  onUpdated,
}: LeadDetailSidebarProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [docSummary, setDocSummary] = useState<DocSummary | null>(null);
  const [docSummaryLoading, setDocSummaryLoading] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [removingDocId, setRemovingDocId] = useState<number | null>(null);

  const linkedType: LinkedType | null = detail.lead
    ? "lead"
    : detail.student
      ? "student"
      : detail.agent
        ? "agent"
        : null;

  const canShowDocs = (linkedType === "lead" || linkedType === "student") && conversationId;

  useEffect(() => {
    if (!canShowDocs) { setDocSummary(null); return; }
    let cancelled = false;
    setDocSummaryLoading(true);
    customFetch(`/api/inbox/conversations/${conversationId}/document-summary`)
      .then((res) => {
        if (!cancelled) setDocSummary(res as DocSummary);
      })
      .catch(() => {
        if (!cancelled) setDocSummary(null);
      })
      .finally(() => {
        if (!cancelled) setDocSummaryLoading(false);
      });
    return () => { cancelled = true; };
  }, [conversationId, canShowDocs, docSummaryRefreshKey, localRefreshKey]);

  const removeDoc = useCallback(async (documentId: number, typeLabel: string) => {
    setRemovingDocId(documentId);
    try {
      await customFetch(`/api/documents/${documentId}`, { method: "DELETE" });
      toast({ title: t("inbox.sidebar.documents.removed", { type: typeLabel }) });
      setLocalRefreshKey((k) => k + 1);
      onUpdated?.();
    } catch (err: any) {
      const msg = err?.data?.error || err?.body?.error || err?.message;
      toast({ title: t("inbox.sidebar.documents.removeFailed"), description: typeof msg === "string" ? msg : undefined, variant: "destructive" });
    } finally {
      setRemovingDocId(null);
    }
  }, [t, toast, onUpdated]);

  if (!linkedType) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
        <div className="text-muted-foreground text-sm">{t("inbox.sidebar.noLink")}</div>
        {detail.conversation.unmatched && onOpenMatchDialog && (
          <Button size="sm" variant="outline" onClick={onOpenMatchDialog} data-testid="sidebar-match-button">
            {t("inbox.sidebar.matchButton")}
          </Button>
        )}
      </div>
    );
  }

  const lead = detail.lead;
  const student = detail.student;
  const agent = detail.agent;
  const entity = lead ?? student ?? agent;
  if (!entity) return null;

  const editable = linkedType === "lead" || linkedType === "student";
  const patchUrl =
    linkedType === "lead" && lead
      ? `/api/leads/${lead.id}`
      : linkedType === "student" && student
        ? `/api/students/${student.id}`
        : null;

  async function saveField(fieldKey: string, newValue: string) {
    if (!patchUrl) return;
    setSaving(true);
    try {
      await customFetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: newValue.trim() === "" ? null : newValue.trim() }),
      });
      setEditingKey(null);
      toast({ title: t("inbox.sidebar.updateSaved") });
      onUpdated?.();
    } catch (err: any) {
      const msg = err?.data?.error || err?.body?.error || err?.message;
      toast({ title: t("inbox.sidebar.updateFailed"), description: typeof msg === "string" ? msg : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const typeLabel =
    linkedType === "lead"
      ? t("inbox.sidebar.typeLead")
      : linkedType === "student"
        ? t("inbox.sidebar.typeStudent")
        : t("inbox.sidebar.typeAgent");

  const onViewFullDetail = () => {
    if (linkedType === "lead" && lead) navigate(`/staff/leads/${lead.id}`);
    else if (linkedType === "student" && student) navigate(`/staff/students/${student.id}`);
    else if (linkedType === "agent" && agent) navigate(`/staff/agents/${agent.id}`);
  };

  const entityProfileUrl = linkedType === "lead" && lead
    ? `/staff/leads/${lead.id}`
    : linkedType === "student" && student
      ? `/staff/students/${student.id}`
      : null;

  const estimatedValueText = (() => {
    if (linkedType !== "lead" || !lead?.estimatedValue) return null;
    const n = Number(lead.estimatedValue);
    if (!Number.isFinite(n)) return lead.estimatedValue;
    return n.toLocaleString();
  })();

  const editProps = { editingKey, setEditingKey, onSave: saveField, saving };

  const DOC_TYPE_KEYS = ["diploma", "transcript", "passport", "photograph"] as const;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="lead-detail-sidebar">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-base leading-tight break-words">
            {entity.firstName} {entity.lastName}
          </h3>
          <PipelineStageBadge stage={detail.stage} size="md" />
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {typeLabel}
        </Badge>
      </div>

      {/* AI Summary */}
      <AiSummaryCard
        summary={detail.aiSummary ?? null}
        hasLink={true}
        hasMessages={(detail.messages?.length ?? 0) > 0}
        isSummarizing={isSummarizing}
        onSummarize={onSummarize}
      />

      {/* Contact / identity info */}
      {editable ? (
        <div className="space-y-2.5 border-t pt-3">
          <EditableField label={t("inbox.sidebar.firstName")} value={entity.firstName} fieldKey="firstName" {...editProps} />
          <EditableField label={t("inbox.sidebar.lastName")} value={entity.lastName} fieldKey="lastName" {...editProps} />
          <EditableField label={t("inbox.sidebar.email")} value={entity.email} fieldKey="email" type="email" {...editProps} />
          <EditableField label={t("inbox.sidebar.phone")} value={entity.phone} fieldKey="phone" {...editProps} />
          <EditableField
            label={t("inbox.sidebar.motherName")}
            value={(lead ?? student)?.motherName}
            fieldKey="motherName"
            {...editProps}
          />
          <EditableField
            label={t("inbox.sidebar.fatherName")}
            value={(lead ?? student)?.fatherName}
            fieldKey="fatherName"
            {...editProps}
          />
        </div>
      ) : (
        (entity.email || entity.phone) && (
          <div className="space-y-2 text-sm border-t pt-3">
            {entity.email && <Field label={t("inbox.sidebar.email")} value={entity.email} />}
            {entity.phone && <Field label={t("inbox.sidebar.phone")} value={entity.phone ?? ""} />}
          </div>
        )
      )}

      {/* Lead-specific */}
      {linkedType === "lead" && lead && (
        <div className="space-y-3 border-t pt-3">
          {lead.interestedProgram && <Field label={t("inbox.sidebar.interestedProgram")} value={lead.interestedProgram} />}
          {lead.interestedUniversity && <Field label={t("inbox.sidebar.interestedUniversity")} value={lead.interestedUniversity} />}
          {lead.interestedCountry && <Field label={t("inbox.sidebar.interestedCountry")} value={lead.interestedCountry} />}
          {estimatedValueText && <Field label={t("inbox.sidebar.estimatedValue")} value={estimatedValueText} />}
          {lead.source && <Field label={t("inbox.sidebar.source")} value={lead.source} />}
          {lead.originDisplayName && <Field label={t("inbox.sidebar.origin")} value={lead.originDisplayName} />}
        </div>
      )}

      {/* Student-specific */}
      {linkedType === "student" && student && (
        <div className="space-y-3 border-t pt-3">
          {student.interestedLevel && <Field label={t("inbox.sidebar.interestedLevel")} value={student.interestedLevel} />}
          {student.originDisplayName && <Field label={t("inbox.sidebar.origin")} value={student.originDisplayName} />}
        </div>
      )}

      {/* Agent-specific */}
      {linkedType === "agent" && agent && (
        <div className="space-y-3 border-t pt-3">
          {agent.companyName && (
            <div className="flex items-start gap-2 text-sm">
              <Building className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="break-words">{agent.companyName}</span>
            </div>
          )}
          {agent.entityType && <Field label={t("inbox.sidebar.entityType")} value={agent.entityType} />}
        </div>
      )}

      {/* Documents section — lead or student only */}
      {canShowDocs && (
        <div className="border-t pt-3 space-y-1.5">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">
            {t("inbox.sidebar.documents.title")}
          </div>
          {docSummaryLoading ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>…</span>
            </div>
          ) : (
            DOC_TYPE_KEYS.map((type) => {
              const Icon = DOC_TYPE_ICONS[type] ?? FileText;
              const entry = docSummary?.[type];
              const exists = entry?.exists ?? false;
              const documentId = entry?.documentId ?? null;
              const docTypeLabel = t(`inbox.sidebar.documents.${type}`);
              const isRemoving = documentId !== null && removingDocId === documentId;
              return (
                <div key={type} className="flex items-center gap-2 py-0.5">
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${exists ? "text-emerald-600" : "text-muted-foreground/50"}`} />
                  <span className={`text-xs flex-1 ${exists ? "text-foreground" : "text-muted-foreground"}`}>
                    {docTypeLabel}
                  </span>
                  {exists && documentId ? (
                    isRemoving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted transition-colors shrink-0"
                            aria-label={t("inbox.sidebar.documents.actions")}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <a
                              href={`${BASE_URL}/api/documents/${documentId}/download?disposition=inline`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {t("inbox.sidebar.documents.preview")}
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={`${BASE_URL}/api/documents/${documentId}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t("inbox.sidebar.documents.download")}
                            </a>
                          </DropdownMenuItem>
                          {entityProfileUrl && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <a
                                  href={entityProfileUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  {t("inbox.sidebar.documents.useInApplication")}
                                </a>
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive flex items-center gap-2"
                            onClick={() => void removeDoc(documentId, docTypeLabel)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t("inbox.sidebar.documents.removeFromProfile")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* CTA */}
      <div className="pt-3 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onViewFullDetail}
          data-testid="sidebar-view-full-detail"
        >
          {t("inbox.sidebar.viewFullDetail")}
          <ArrowRight className="w-3.5 h-3.5 ms-1.5 rtl:rotate-180" />
        </Button>
      </div>

    </div>
  );
}
