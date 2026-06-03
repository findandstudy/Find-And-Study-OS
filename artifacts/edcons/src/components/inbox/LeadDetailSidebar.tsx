import { useLocation } from "wouter";
import { ArrowRight, Mail, Phone, Building } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import type { InboxConversationDetailResponse } from "@workspace/api-client-react";
import { PipelineStageBadge } from "./PipelineStageBadge";
import { AiSummaryCard } from "./AiSummaryCard";

interface LeadDetailSidebarProps {
  detail: InboxConversationDetailResponse;
  onOpenMatchDialog?: () => void;
  onSummarize: () => void;
  isSummarizing: boolean;
}

type LinkedType = "lead" | "student" | "agent";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm break-words">{value}</div>
    </div>
  );
}

export function LeadDetailSidebar({
  detail,
  onOpenMatchDialog,
  onSummarize,
  isSummarizing,
}: LeadDetailSidebarProps) {
  const { t } = useI18n();
  const [, navigate] = useLocation();

  const linkedType: LinkedType | null = detail.lead
    ? "lead"
    : detail.student
      ? "student"
      : detail.agent
        ? "agent"
        : null;

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

  const estimatedValueText = (() => {
    if (linkedType !== "lead" || !lead?.estimatedValue) return null;
    const n = Number(lead.estimatedValue);
    if (!Number.isFinite(n)) return lead.estimatedValue;
    return n.toLocaleString();
  })();

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

      {/* Contact info */}
      {(entity.email || entity.phone) && (
        <div className="space-y-2 text-sm">
          {entity.email && (
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{entity.email}</span>
            </div>
          )}
          {entity.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span>{entity.phone}</span>
            </div>
          )}
        </div>
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
