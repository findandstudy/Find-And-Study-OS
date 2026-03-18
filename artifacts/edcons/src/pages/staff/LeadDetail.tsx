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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, User, Mail, Phone, Globe, BookOpen, MapPin, MessageSquare, RefreshCw, DollarSign, CalendarClock, Clock, CheckCircle2, Plus } from "lucide-react";
import { QuickContactButtons } from "@/components/QuickContact";
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

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Props {
  id: number;
}

export default function LeadDetail({ id }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [fuTitle, setFuTitle] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("10:00");
  const [fuNotes, setFuNotes] = useState("");

  const { data: lead, isLoading } = useGetLead(id);
  const { data: notes = [] } = useGetLeadNotes(id);
  const updateLead = useUpdateLead();
  const convertLead = useConvertLead();
  const addNote = useAddLeadNote();

  const { data: followUps = [] } = useQuery<any[]>({
    queryKey: [`/api/leads/${id}/follow-ups`],
    queryFn: () => fetch(`${BASE}/api/leads/${id}/follow-ups`, { credentials: "include" }).then(r => r.json()),
  });

  const createFollowUp = useMutation({
    mutationFn: (body: any) =>
      fetch(`${BASE}/api/leads/${id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}/follow-ups`] });
      setShowFollowUpForm(false);
      setFuTitle("");
      setFuDate("");
      setFuTime("10:00");
      setFuNotes("");
      toast({ title: "Follow-up scheduled" });
    },
  });

  const toggleFollowUp = useMutation({
    mutationFn: ({ fuId, completed }: { fuId: number; completed: boolean }) =>
      fetch(`${BASE}/api/follow-ups/${fuId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completed }),
      }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}/follow-ups`] });
      toast({ title: "Follow-up updated" });
    },
  });

  function handleStatusChange(status: string) {
    updateLead.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}`] });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
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

  function handleCreateFollowUp() {
    if (!fuTitle.trim() || !fuDate) return;
    createFollowUp.mutate({
      title: fuTitle,
      scheduledAt: new Date(`${fuDate}T${fuTime}`).toISOString(),
      notes: fuNotes || undefined,
    });
  }

  function isOverdue(scheduledAt: string) {
    return new Date(scheduledAt) < new Date();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
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
          {!isLoading && lead && (
            <div className="flex items-center gap-2">
              <QuickContactButtons
                name={`${lead.firstName} ${lead.lastName}`}
                email={lead.email}
                phone={lead.phone}
                entityType="lead"
                entityId={id}
              />
              {lead.status !== "converted" && (
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
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                  <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Estimated Budget" value={lead?.estimatedValue ? `$${Number(lead.estimatedValue).toLocaleString()}` : undefined} />
                </div>
              )}

              {lead?.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Initial Notes</p>
                  <p className="text-sm text-foreground">{lead.notes}</p>
                </div>
              )}
            </div>

            {/* Follow-ups */}
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-semibold text-foreground">Follow-ups</h2>
                  <span className="text-xs text-muted-foreground">({(followUps as any[]).length})</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setShowFollowUpForm(!showFollowUpForm)}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>

              {showFollowUpForm && (
                <div className="bg-secondary/30 rounded-xl p-4 space-y-3 border">
                  <Input
                    placeholder="Follow-up title (e.g. Call about admission)"
                    value={fuTitle}
                    onChange={e => setFuTitle(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      type="date"
                      value={fuDate}
                      onChange={e => setFuDate(e.target.value)}
                    />
                    <Input
                      type="time"
                      value={fuTime}
                      onChange={e => setFuTime(e.target.value)}
                    />
                  </div>
                  <Textarea
                    placeholder="Notes (optional)"
                    value={fuNotes}
                    onChange={e => setFuNotes(e.target.value)}
                    className="resize-none min-h-[60px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setShowFollowUpForm(false)}>Cancel</Button>
                    <Button
                      size="sm"
                      onClick={handleCreateFollowUp}
                      disabled={createFollowUp.isPending || !fuTitle.trim() || !fuDate}
                    >
                      Schedule
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {(followUps as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>
                ) : (
                  (followUps as any[]).map((fu: any) => (
                    <div
                      key={fu.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                        fu.completed
                          ? "bg-green-50/50 border-green-200"
                          : isOverdue(fu.scheduledAt)
                          ? "bg-red-50/50 border-red-200"
                          : "bg-secondary/30 border-border"
                      }`}
                    >
                      <button
                        onClick={() => toggleFollowUp.mutate({ fuId: fu.id, completed: !fu.completed })}
                        className={`mt-0.5 shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          fu.completed
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-muted-foreground/40 hover:border-primary"
                        }`}
                      >
                        {fu.completed && <CheckCircle2 className="w-3 h-3" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${fu.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {fu.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className={`text-xs ${
                            fu.completed ? "text-muted-foreground" : isOverdue(fu.scheduledAt) ? "text-red-600 font-semibold" : "text-muted-foreground"
                          }`}>
                            {new Date(fu.scheduledAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            {" "}
                            {new Date(fu.scheduledAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                            {!fu.completed && isOverdue(fu.scheduledAt) && " — Overdue"}
                          </span>
                        </div>
                        {fu.notes && <p className="text-xs text-muted-foreground mt-1">{fu.notes}</p>}
                        {fu.createdByName && (
                          <p className="text-xs text-muted-foreground/60 mt-1">by {fu.createdByName}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
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

            {/* Upcoming Follow-ups summary in sidebar */}
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <CalendarClock className="w-4 h-4" />
                Next Follow-up
              </h2>
              {(() => {
                const upcoming = (followUps as any[]).filter((f: any) => !f.completed).sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
                if (upcoming.length === 0) return <p className="text-sm text-muted-foreground">None scheduled</p>;
                const next = upcoming[0];
                return (
                  <div>
                    <p className="text-sm font-medium">{next.title}</p>
                    <p className={`text-xs mt-1 ${isOverdue(next.scheduledAt) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                      {new Date(next.scheduledAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      {" "}
                      {new Date(next.scheduledAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                      {isOverdue(next.scheduledAt) && " — Overdue!"}
                    </p>
                  </div>
                );
              })()}
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
