import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { workPipelineHistory } from "@/lib/workPipelineI18n";
import { useI18n } from "@/hooks/use-i18n";
import { useState } from "react";
import {
  CalendarClock,
  Check,
  MessageSquare,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Card, FollowUp, Row } from "./useWorkPipelines";

export function WorkPipelineActivity({
  row,
  lang,
  people,
  person,
  busy,
  disabled,
  save,
}: {
  row: Row<Card>;
  lang: string;
  people: { id: number; name: string }[];
  person: (id: number | null) => string;
  busy: boolean;
  disabled: boolean;
  save: (activity: unknown) => Promise<boolean>;
}) {
  const { lang: uiLanguage } = useUiLanguage();
  const { t, isRTL } = useI18n();
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Partial<FollowUp> | null>(null);
  const [when, setWhen] = useState("");
  const edit = (f?: FollowUp) => {
    setEditing(
      f
        ? { ...f }
        : {
            title: "",
            notes: "",
            assigneeId: row.document.assigneeId ?? people[0]?.id,
          },
    );
    if (!f) setWhen("");
    else {
      const d = new Date(f.scheduledAt);
      setWhen(
        new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16),
      );
    }
  };
  const followUps = row.document.followUps ?? [];
  return (
    <Tabs
      dir={isRTL ? "rtl" : "ltr"}
      defaultValue="followups"
      className="border-t pt-4"
    >
      <TabsList className="w-full justify-start">
        <TabsTrigger value="followups">
          <CalendarClock className="w-4 h-4 me-2" />
          {t("workPipelines.followups")} (
          {followUps.filter((f) => !f.completed).length})
        </TabsTrigger>
        <TabsTrigger value="notes">
          <MessageSquare className="w-4 h-4 me-2" />
          {t("workPipelines.notes")} ({row.document.notes.length})
        </TabsTrigger>
        <TabsTrigger value="history">
          {t("workPipelines.historyText")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="followups" className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={disabled || busy}
          onClick={() => edit()}
        >
          <Plus className="w-3 h-3 me-1" />
          {t("workPipelines.addFollowup")}
        </Button>
        {editing && (
          <div className="rounded-xl border bg-secondary/30 p-4 space-y-3">
            <Label htmlFor="pipeline-followup-title">
              {t("workPipelines.followupTitle")}
            </Label>
            <Input
              id="pipeline-followup-title"
              value={editing.title ?? ""}
              maxLength={200}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
            />
            <Label htmlFor="pipeline-followup-when">
              {t("workPipelines.dateAndTime")}
            </Label>
            <Input
              id="pipeline-followup-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <Label htmlFor="pipeline-followup-assignee">
              {t("workPipelines.assignedTo")}
            </Label>
            <select
              id="pipeline-followup-assignee"
              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={editing.assigneeId ?? ""}
              onChange={(e) =>
                setEditing({ ...editing, assigneeId: Number(e.target.value) })
              }
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Label htmlFor="pipeline-followup-notes">
              {t("workPipelines.notesOptional")}
            </Label>
            <Textarea
              id="pipeline-followup-notes"
              value={editing.notes ?? ""}
              maxLength={5000}
              onChange={(e) =>
                setEditing({ ...editing, notes: e.target.value })
              }
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                {t("workPipelines.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  busy ||
                  disabled ||
                  !editing.title?.trim() ||
                  !when ||
                  !editing.assigneeId
                }
                onClick={async () => {
                  if (
                    await save({
                      action: "followup",
                      ...(editing.id ? { id: editing.id } : {}),
                      title: editing.title,
                      notes: editing.notes ?? "",
                      assigneeId: editing.assigneeId,
                      scheduledAt: new Date(when).toISOString(),
                    })
                  )
                    setEditing(null);
                }}
              >
                {t("workPipelines.save")}
              </Button>
            </div>
          </div>
        )}
        {!followUps.length && (
          <p className="text-sm text-muted-foreground">
            {t("workPipelines.noFollowupsScheduled")}
          </p>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {[...followUps]
            .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
            .map((f) => {
              const overdue =
                !f.completed && Date.parse(f.scheduledAt) < Date.now();
              return (
                <div
                  key={f.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${f.completed ? "bg-green-500/5 border-green-500/25" : overdue ? "bg-red-500/5 border-red-500/25" : "bg-secondary/30"}`}
                >
                  <button
                    type="button"
                    aria-label={
                      f.completed
                        ? t("workPipelines.reopenFollowup")
                        : t("workPipelines.completeFollowup")
                    }
                    disabled={busy || disabled}
                    onClick={() =>
                      void save({
                        action: "complete",
                        id: f.id,
                        completed: !f.completed,
                      })
                    }
                    className="mt-1 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center"
                  >
                    {f.completed && <Check className="w-3 h-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium ${f.completed ? "line-through text-muted-foreground" : ""}`}
                    >
                      {f.title}
                    </p>
                    <p
                      className={`text-xs mt-1 ${overdue ? "text-red-600" : "text-muted-foreground"}`}
                    >
                      {new Date(f.scheduledAt).toLocaleString(lang)}{" "}
                      {overdue && " · " + t("workPipelines.overdue")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {person(f.assigneeId)}
                    </p>
                    {f.notes && (
                      <p className="text-sm whitespace-pre-wrap mt-2">
                        {f.notes}
                      </p>
                    )}
                  </div>
                  {!f.completed && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("workPipelines.editFollowup")}
                      disabled={busy || disabled}
                      onClick={() => edit(f)}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              );
            })}
        </div>
      </TabsContent>
      <TabsContent value="notes" className="space-y-3">
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {!row.document.notes.length && (
            <p className="text-sm text-muted-foreground">
              {t("workPipelines.noNotesYet")}
            </p>
          )}
          {[...row.document.notes].reverse().map((n) => (
            <div key={n.id} className="rounded-xl border bg-secondary/20 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                {person(n.by)} · {new Date(n.at).toLocaleString(lang)}
              </p>
              <p className="text-sm whitespace-pre-wrap break-words">
                {n.text}
              </p>
            </div>
          ))}
        </div>
        <Label htmlFor="pipeline-new-note">
          {t("workPipelines.newNoteText")}
        </Label>
        <Textarea
          id="pipeline-new-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          rows={3}
          disabled={disabled || busy}
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || disabled || !note.trim()}
          onClick={async () => {
            if (await save({ action: "note", text: note })) setNote("");
          }}
        >
          {t("workPipelines.addNote")}
        </Button>
      </TabsContent>
      <TabsContent
        value="history"
        className="max-h-64 overflow-y-auto space-y-3"
      >
        {[...row.document.history].reverse().map((h) => (
          <div key={h.id} className="border-s-2 ps-3 text-xs">
            <p className="text-muted-foreground">
              {person(h.by)} · {new Date(h.at).toLocaleString(lang)}
            </p>
            <p>
              {h.action === "note-added"
                ? t("workPipelines.notifyNote")
                : h.action === "followup-updated"
                  ? t("workPipelines.followupUpdated")
                  : h.text
                    ? workPipelineHistory(h.text, t)
                    : t("workPipelines.recordUpdated")}
            </p>
          </div>
        ))}
      </TabsContent>
    </Tabs>
  );
}
