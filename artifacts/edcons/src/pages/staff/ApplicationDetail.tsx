import { useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useGetApplication,
  useUpdateApplication,
  useGetApplicationNotes,
  useAddApplicationNote,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, MessageSquare, User, BookOpen, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STAGES = [
  "inquiry",
  "documents_collected",
  "submitted",
  "offer_received",
  "visa_applied",
  "visa_approved",
  "enrolled",
  "rejected",
];

const STAGE_COLORS: Record<string, string> = {
  inquiry: "bg-gray-100 text-gray-600",
  documents_collected: "bg-blue-100 text-blue-700",
  submitted: "bg-purple-100 text-purple-700",
  offer_received: "bg-amber-100 text-amber-700",
  visa_applied: "bg-orange-100 text-orange-700",
  visa_approved: "bg-teal-100 text-teal-700",
  enrolled: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

interface Props {
  id: number;
}

export default function ApplicationDetail({ id }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");

  const { data: app, isLoading } = useGetApplication(id);
  const { data: notes = [] } = useGetApplicationNotes(id);
  const updateApp = useUpdateApplication();
  const addNote = useAddApplicationNote();

  function handleStageChange(stage: string) {
    updateApp.mutate(
      { id, data: { stage } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/applications/${id}`] });
          toast({ title: "Stage updated" });
        },
      }
    );
  }

  function handleAddNote() {
    if (!noteText.trim()) return;
    addNote.mutate(
      { id, data: { content: noteText } },
      {
        onSuccess: () => {
          setNoteText("");
          queryClient.invalidateQueries({ queryKey: [`/api/applications/${id}/notes`] });
        },
      }
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/staff/applications")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : (
              <h1 className="text-2xl font-display font-bold text-foreground">
                Application #{app?.id}
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">Application Detail</p>
          </div>
          {!isLoading && (
            <Badge
              className={`capitalize px-3 py-1 rounded-full text-sm font-medium border-0 ${STAGE_COLORS[app?.stage ?? "inquiry"]}`}
            >
              {app?.stage?.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: details */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Application Details</h2>
                <Select
                  value={app?.stage}
                  onValueChange={handleStageChange}
                  disabled={updateApp.isPending || isLoading}
                >
                  <SelectTrigger className="w-44 rounded-full border-border">
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className={`capitalize px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[s]}`}>
                          {s.replace(/_/g, " ")}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <InfoRow icon={<User className="w-4 h-4" />} label="Student ID" value={app?.studentId?.toString()} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="University ID" value={app?.universityId?.toString()} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Program ID" value={app?.programId?.toString()} />
                  <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Tuition" value={app?.tuitionAmount ? `${app.currency ?? "USD"} ${app.tuitionAmount}` : undefined} />
                  <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Scholarship" value={app?.scholarshipAmount ? `${app.currency ?? "USD"} ${app.scholarshipAmount}` : undefined} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Intake" value={app?.intakeDate} />
                </div>
              )}

              {app?.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground">{app.notes}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-semibold text-foreground">Notes</h2>
                <span className="text-xs text-muted-foreground">({(notes as any[]).length})</span>
              </div>

              <div className="space-y-3 max-h-60 overflow-y-auto">
                {(notes as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  (notes as any[]).map((note: any) => (
                    <div key={note.id} className="bg-secondary/50 rounded-xl p-3">
                      <p className="text-sm text-foreground">{note.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {note.authorName || "Team"} · {new Date(note.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <Textarea
                  placeholder="Add a note..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="resize-none min-h-[72px]"
                />
                <Button
                  onClick={handleAddNote}
                  disabled={addNote.isPending || !noteText.trim()}
                  className="self-end"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* Right: stage card */}
          <div className="space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground">Stage</h2>
              {isLoading ? (
                <Skeleton className="h-8 w-28 rounded-full" />
              ) : (
                <div className="space-y-2">
                  {STAGES.map((stage) => (
                    <div
                      key={stage}
                      className={`flex items-center gap-2 text-xs py-1 ${app?.stage === stage ? "font-bold text-foreground" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${app?.stage === stage ? "bg-primary" : "bg-border"}`}
                      />
                      <span className="capitalize">{stage.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
                <p>Created: {app ? new Date(app.createdAt).toLocaleDateString() : "—"}</p>
              </div>
            </div>

            {app?.studentId && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation(`/staff/students/${app.studentId}`)}
              >
                <User className="w-4 h-4 mr-2" />
                View Student
              </Button>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value || "—"}</p>
      </div>
    </div>
  );
}
