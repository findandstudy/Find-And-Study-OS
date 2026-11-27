import { workPipelineError } from "@/lib/workPipelineI18n";
import { useState } from "react";
import { Link } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { request } from "@/pages/staff/useWorkPipelines";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export type WorkConversationState = {
  linked: boolean;
  items: {
    boardId: string;
    boardName: string;
    revision: number;
    stages: { id: string; name: string }[];
    people: { id: number; name: string }[];
    card: {
      id: string;
      title: string;
      contactName: string;
      email: string;
      phone: string;
      stageId: string;
      assigneeId: number | null;
    };
  }[];
};

export function WorkPipelineInboxSidebar({
  state,
  onUpdated,
}: {
  state: WorkConversationState;
  onUpdated: () => void;
}) {
  const { lang, t, isRTL } = useI18n();

  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = async (
    item: WorkConversationState["items"][number],
    patch: unknown,
  ) => {
    setBusy(true);
    setError("");
    try {
      await request(`/${item.boardId}/cards/${item.card.id}`, "PATCH", {
        revision: item.revision,
        patch,
      });
    } catch (e: any) {
      setError(workPipelineError(e, t));
    } finally {
      setBusy(false);
      onUpdated();
    }
  };
  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="overflow-y-auto p-3 space-y-4"
      aria-label={t("workPipelines.pipelineInformation")}
    >
      {state.items.map((item) => (
        <section key={item.card.id} className="space-y-3">
          <h3 className="font-semibold break-words">
            {item.card.contactName || item.card.title}
          </h3>
          <Link
            className="block text-xs text-primary hover:underline"
            href={`/staff/pipelines?pipeline=${item.boardId}&card=${item.card.id}`}
          >
            {item.boardName}
          </Link>
          <div className="space-y-1 border-t pt-3">
            <label className="text-[11px] text-muted-foreground uppercase">
              {t("workPipelines.pipelineStage")}
            </label>
            <Select
              value={item.card.stageId}
              disabled={busy}
              onValueChange={(stageId) => void update(item, { stageId })}
            >
              <SelectTrigger
                aria-label={t("workPipelines.pipelineStageText")}
                className="h-8 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {item.stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase">
              {t("workPipelines.assignee")}
            </label>
            <Select
              value={String(item.card.assigneeId ?? "none")}
              disabled={busy}
              onValueChange={(id) =>
                void update(item, {
                  assigneeId: id === "none" ? null : Number(id),
                })
              }
            >
              <SelectTrigger
                aria-label={t("workPipelines.pipelineAssignee")}
                className="h-8 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("workPipelines.none")}</SelectItem>
                {item.people.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {item.card.email && (
            <p className="text-sm break-words">{item.card.email}</p>
          )}
          {item.card.phone && (
            <p className="text-sm break-words">{item.card.phone}</p>
          )}
        </section>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
