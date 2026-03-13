import { useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useGetLead,
  useUpdateLead,
  useConvertLead,
  useGetLeadNotes,
  useAddLeadNote,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, User, Mail, Phone, Globe, BookOpen, MapPin, MessageSquare, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_OPTIONS = ["new", "contacted", "interested", "qualified", "converted", "lost"];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-purple-100 text-purple-700",
  interested: "bg-amber-100 text-amber-700",
  qualified: "bg-green-100 text-green-700",
  converted: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-700",
};

interface Props {
  id: number;
}

export default function LeadDetail({ id }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");

  const { data: lead, isLoading } = useGetLead(id);
  const { data: notes = [] } = useGetLeadNotes(id);
  const updateLead = useUpdateLead();
  const convertLead = useConvertLead();
  const addNote = useAddLeadNote();

  function handleStatusChange(status: string) {
    updateLead.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}`] });
          toast({ title: "Status updated" });
        },
      }
    );
  }

  function handleConvert() {
    if (!confirm("Convert this lead to a student? This cannot be undone.")) return;
    convertLead.mutate(
      { id },
      {
        onSuccess: (student: any) => {
          toast({ title: "Lead converted to student" });
          setLocation(`/staff/students/${student.id}`);
        },
        onError: () => {
          toast({ title: "Conversion failed", variant: "destructive" });
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
          queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}/notes`] });
        },
      }
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Back + header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/staff/leads")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1">
            {isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : (
              <h1 className="text-2xl font-display font-bold text-foreground">
                {lead?.firstName} {lead?.lastName}
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">Lead Detail</p>
          </div>
          {!isLoading && lead?.status !== "converted" && (
            <Button
              onClick={handleConvert}
              disabled={convertLead.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-md"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Convert to Student
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: lead info */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Contact Information</h2>
                <Select
                  value={lead?.status}
                  onValueChange={handleStatusChange}
                  disabled={updateLead.isPending || isLoading}
                >
                  <SelectTrigger className="w-36 rounded-full border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className={`capitalize px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[s]}`}>
                          {s}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={lead?.email} />
                  <InfoRow icon={<Phone className="w-4 h-4" />} label="Phone" value={lead?.phone} />
                  <InfoRow icon={<Globe className="w-4 h-4" />} label="Nationality" value={lead?.nationality} />
                  <InfoRow icon={<MapPin className="w-4 h-4" />} label="Country" value={lead?.country} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Interested Program" value={lead?.interestedProgram} />
                  <InfoRow icon={<Globe className="w-4 h-4" />} label="Interested Country" value={lead?.interestedCountry} />
                  <InfoRow icon={<User className="w-4 h-4" />} label="Source" value={lead?.source} />
                </div>
              )}

              {lead?.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Initial Notes</p>
                  <p className="text-sm text-foreground">{lead.notes}</p>
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

          {/* Right: status card */}
          <div className="space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground">Status</h2>
              {isLoading ? (
                <Skeleton className="h-8 w-24 rounded-full" />
              ) : (
                <Badge
                  className={`capitalize px-3 py-1 rounded-full text-sm font-medium border-0 ${STATUS_COLORS[lead?.status ?? "new"]}`}
                >
                  {lead?.status}
                </Badge>
              )}
              <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
                <p>Created: {lead ? new Date(lead.createdAt).toLocaleDateString() : "—"}</p>
                <p>Updated: {lead ? new Date(lead.updatedAt).toLocaleDateString() : "—"}</p>
              </div>
            </div>
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
