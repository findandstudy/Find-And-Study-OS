import React, { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useGetLead,
  useUpdateLead,
  useConvertLead,
  useGetLeadNotes,
  useAddLeadNote,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, User, Mail, Phone, Globe, BookOpen, MapPin, MessageSquare, RefreshCw, DollarSign, CalendarClock, Clock, CheckCircle2, Plus, UserCheck2, UserPlus, Pencil, ChevronDown, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { QuickContactButtons } from "@/components/QuickContact";
import { CountryFlag } from "@/components/CountryFlag";
import { OriginBadge, OriginSection } from "@/components/OriginBadge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const PHONE_CODES = [
  { code: "+90", country: "TR" }, { code: "+1", country: "US" }, { code: "+44", country: "GB" },
  { code: "+49", country: "DE" }, { code: "+33", country: "FR" }, { code: "+39", country: "IT" },
  { code: "+34", country: "ES" }, { code: "+31", country: "NL" }, { code: "+46", country: "SE" },
  { code: "+47", country: "NO" }, { code: "+45", country: "DK" }, { code: "+41", country: "CH" },
  { code: "+43", country: "AT" }, { code: "+48", country: "PL" }, { code: "+7", country: "RU" },
  { code: "+380", country: "UA" }, { code: "+86", country: "CN" }, { code: "+81", country: "JP" },
  { code: "+82", country: "KR" }, { code: "+91", country: "IN" }, { code: "+92", country: "PK" },
  { code: "+93", country: "AF" }, { code: "+966", country: "SA" }, { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" }, { code: "+98", country: "IR" }, { code: "+962", country: "JO" },
  { code: "+961", country: "LB" }, { code: "+20", country: "EG" }, { code: "+212", country: "MA" },
  { code: "+234", country: "NG" }, { code: "+254", country: "KE" }, { code: "+55", country: "BR" },
  { code: "+52", country: "MX" }, { code: "+61", country: "AU" }, { code: "+64", country: "NZ" },
  { code: "+60", country: "MY" }, { code: "+65", country: "SG" }, { code: "+66", country: "TH" },
  { code: "+84", country: "VN" }, { code: "+62", country: "ID" }, { code: "+63", country: "PH" },
  { code: "+880", country: "BD" }, { code: "+94", country: "LK" }, { code: "+977", country: "NP" },
  { code: "+251", country: "ET" }, { code: "+255", country: "TZ" }, { code: "+233", country: "GH" },
];

const SOURCES = ["website", "referral", "social_media", "walk_in", "partner", "other"];

function parsePhoneCode(fullPhone: string): { phoneCode: string; phone: string } {
  if (!fullPhone) return { phoneCode: "+90", phone: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find(pc => fullPhone.startsWith(pc.code));
  if (matched) return { phoneCode: matched.code, phone: fullPhone.slice(matched.code.length).trim() };
  return { phoneCode: "+90", phone: fullPhone.replace(/^\+/, "").trim() };
}

type CountryRecord = { id: number; name: string; code: string; flagEmoji?: string; isActive: boolean };

function useCountries() {
  return useQuery<CountryRecord[]>({
    queryKey: ["countries-all"],
    queryFn: async () => {
      const res: any = await customFetch(`/api/countries?limit=500`);
      return res.data ?? res;
    },
    staleTime: 5 * 60_000,
  });
}

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
  basePath?: string;
}

export default function LeadDetail({ id, basePath = "/staff" }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth(true);
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [fuTitle, setFuTitle] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("10:00");
  const [fuNotes, setFuNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const isAdmin = user && ["super_admin", "admin", "manager"].includes(user.role);
  const isAgent = basePath === "/agent";

  const { data: lead, isLoading } = useGetLead(id) as { data: any; isLoading: boolean };
  const { data: notes = [] } = useGetLeadNotes(id);
  const updateLead = useUpdateLead();
  const convertLead = useConvertLead();
  const addNote = useAddLeadNote();

  const { data: staffUsersData } = useQuery<any>({
    queryKey: ["/api/users"],
    queryFn: () => customFetch("/api/users"),
    enabled: !!isAdmin,
    staleTime: 5 * 60_000,
  });

  function getAssignedUserName(assignedToId: number | null | undefined): string | null {
    if (!assignedToId) return null;
    if (user && assignedToId === user.id) return "You";
    if (staffUsersData) {
      const list = Array.isArray(staffUsersData) ? staffUsersData : staffUsersData?.data || [];
      const found = list.find((u: any) => u.id === assignedToId);
      if (found) return `${found.firstName || ''} ${found.lastName || ''}`.trim() || found.email;
    }
    return "Staff Member";
  }

  async function handleAssign(targetUserId: number | null) {
    setAssigning(true);
    try {
      await customFetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: targetUserId }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: targetUserId ? "Lead assigned" : "Lead unassigned" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAssigning(false);
    }
  }

  const { data: followUps = [] } = useQuery<any[]>({
    queryKey: [`/api/leads/${id}/follow-ups`],
    queryFn: () => fetch(`${BASE}/api/leads/${id}/follow-ups`, { credentials: "include" }).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
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
        onSuccess: (result: any) => {
          const studentData = result?.student || result;
          const studentName = `${studentData?.firstName || ""} ${studentData?.lastName || ""}`.trim();
          toast({
            title: "Lead converted to student",
            description: result?.merged ? `Merged with existing student: ${studentName}` : `New student created: ${studentName}`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          setLocation(`${basePath}/leads`);
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
          <Button variant="ghost" size="icon" onClick={() => setLocation(`${basePath}/leads`)}>
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
                hideEmail={isAgent}
                hideWhatsApp={isAgent}
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
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-foreground">Contact Information</h2>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowEditDialog(true)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
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

              <div className="pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">Origin</p>
                <OriginSection originType={lead?.originType || "direct"} originDisplayName={lead?.originDisplayName} />
              </div>

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

            {!isAgent && (
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4" />
                Assigned To
              </h2>
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : isAdmin ? (
                <Select
                  value={lead?.assignedToId ? String(lead.assignedToId) : "unassigned"}
                  onValueChange={(val) => handleAssign(val === "unassigned" ? null : Number(val))}
                  disabled={assigning}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {(() => {
                      const list = Array.isArray(staffUsersData) ? staffUsersData : staffUsersData?.data || [];
                      const staffRoles = ["super_admin", "admin", "manager", "staff", "consultant"];
                      return list
                        .filter((u: any) => staffRoles.includes(u.role))
                        .map((u: any) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.id === user?.id ? `${u.firstName || ''} ${u.lastName || ''} (You)`.trim() : `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email}
                          </SelectItem>
                        ));
                    })()}
                  </SelectContent>
                </Select>
              ) : lead?.assignedToId ? (
                <div className="flex items-center gap-2">
                  <UserCheck2 className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium">{getAssignedUserName(lead.assignedToId)}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Unassigned</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={() => handleAssign(user?.id ?? null)}
                    disabled={assigning}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                    {assigning ? "Assigning..." : "Assign to Me"}
                  </Button>
                </div>
              )}
            </div>
            )}

            {!isAgent && (
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Origin
              </h2>
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <div className="space-y-2">
                  <OriginBadge originType={lead?.originType || "direct"} originDisplayName={lead?.originDisplayName} className="text-xs" />
                  {isAdmin && (
                    <Select
                      value={lead?.originType || "direct"}
                      onValueChange={(val) => {
                        updateLead.mutate({
                          id: lead!.id,
                          data: {
                            originType: val,
                            originDisplayName: val === "direct" ? "Find And Study" : null,
                          },
                        } as any);
                      }}
                    >
                      <SelectTrigger className="w-full h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="agent">Agent</SelectItem>
                        <SelectItem value="sub_agent">Sub-Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
            )}

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
      {lead && (
        <EditLeadDetailDialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          lead={lead}
          leadId={id}
        />
      )}
    </DashboardLayout>
  );
}

function NationalityCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: allCountries = [] } = useCountries();
  const [searchVal, setSearchVal] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = searchVal
    ? allCountries.filter(c => c.name.toLowerCase().includes(searchVal.toLowerCase()))
    : allCountries;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearchVal("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={open ? searchVal : value}
        onChange={e => { setSearchVal(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setSearchVal(""); setOpen(true); }}
        placeholder={value || "Select or type..."}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-[9999] mt-1 w-full bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">{searchVal ? "No match — custom value OK" : "No countries loaded"}</div>}
          {filtered.map(c => (
            <button key={c.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/70 transition-colors flex items-center gap-2 ${c.name === value ? "bg-primary/10 font-medium" : ""}`}
              onMouseDown={e => { e.preventDefault(); onChange(c.name); setSearchVal(""); setOpen(false); }}>
              <CountryFlag code={c.code} size="sm" />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiCountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: cfFilters } = useQuery<{ countries: string[] }>({
    queryKey: ["course-finder-filters"],
    queryFn: () => customFetch("/api/course-finder/filters"),
    staleTime: 5 * 60_000,
  });
  const cfCountryNames = cfFilters?.countries ?? [];
  const { data: allCountries = [] } = useCountries();
  const activeDestinations = useMemo(() => {
    const nameSet = new Set(cfCountryNames);
    return allCountries.filter(c => nameSet.has(c.name));
  }, [allCountries, cfCountryNames]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [localSelected, setLocalSelected] = useState<string[]>(() =>
    value ? value.split(",").map(s => s.trim()).filter(Boolean) : []
  );

  useEffect(() => {
    const parsed = value ? value.split(",").map(s => s.trim()).filter(Boolean) : [];
    setLocalSelected(prev => {
      if (prev.join(",") === parsed.join(",")) return prev;
      return parsed;
    });
  }, [value]);

  function toggle(name: string) {
    setLocalSelected(prev => {
      const next = prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name];
      onChange(next.join(", "));
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener("click", handleClick); };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent/50 transition-colors"
      >
        <span className={`truncate ${localSelected.length === 0 ? "text-muted-foreground" : ""}`}>
          {localSelected.length === 0 ? "Select countries..." : localSelected.length === 1 ? localSelected[0] : `${localSelected.length} countries selected`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {localSelected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {localSelected.map(name => {
            const c = activeDestinations.find(d => d.name === name);
            return (
              <span key={name} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {c && <CountryFlag code={c.code} size="sm" />}
                {name}
                <button type="button" className="ml-0.5 hover:text-destructive" onClick={(e) => { e.stopPropagation(); toggle(name); }}><X className="w-3 h-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      {open && (
        <div className="absolute z-[9999] mt-1 w-full bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {activeDestinations.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">No active destinations</div>}
          {activeDestinations.map(c => (
            <button key={c.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/70 transition-colors flex items-center gap-2 ${localSelected.includes(c.name) ? "bg-primary/10 font-medium" : ""}`}
              onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(c.name); }}>
              <Checkbox checked={localSelected.includes(c.name)} className="pointer-events-none" />
              <CountryFlag code={c.code} size="sm" />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditLeadDetailDialog({ open, onClose, lead, leadId }: {
  open: boolean; onClose: () => void; lead: any; leadId: number;
}) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phoneCode: "+90", phone: "",
    source: "website", interestedProgram: "", interestedCountry: "", nationality: "", estimatedValue: "",
  });
  const updateLead = useUpdateLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && lead) {
      const parsed = parsePhoneCode(lead.phone || "");
      setForm({
        firstName: lead.firstName || "", lastName: lead.lastName || "",
        email: lead.email || "", phoneCode: parsed.phoneCode, phone: parsed.phone,
        source: lead.source || "website", interestedProgram: lead.interestedProgram || "",
        interestedCountry: lead.interestedCountry || "", nationality: lead.nationality || "",
        estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
      });
    }
  }, [open, lead]);

  function handleSave() {
    if (!form.firstName || !form.lastName) return;
    const { phoneCode, ...rest } = form;
    const payload: any = { ...rest, phone: form.phone ? `${phoneCode}${form.phone}` : "" };
    const parsedVal = parseFloat(form.estimatedValue);
    if (form.estimatedValue && !isNaN(parsedVal)) payload.estimatedValue = parsedVal;
    else delete payload.estimatedValue;

    updateLead.mutate(
      { id: leadId, data: payload },
      {
        onSuccess: () => {
          toast({ title: "Lead updated" });
          queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}`] });
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
          onClose();
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update lead", variant: "destructive" });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>First Name *</Label>
            <Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") })} className="uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name *</Label>
            <Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") })} className="uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <div className="flex gap-1">
              <Select value={form.phoneCode} onValueChange={v => setForm({ ...form, phoneCode: v })}>
                <SelectTrigger className="w-[90px] shrink-0 px-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PHONE_CODES.map(pc => (
                    <SelectItem key={`${pc.code}-${pc.country}`} value={pc.code}>
                      <span className="inline-flex items-center gap-1.5"><CountryFlag code={pc.country} size="sm" />{pc.code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="flex-1 min-w-0" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="555 000 0000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Nationality</Label>
            <NationalityCombobox value={form.nationality} onChange={v => setForm({ ...form, nationality: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCES.map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interested Program</Label>
            <Input value={form.interestedProgram} onChange={e => setForm({ ...form, interestedProgram: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Interested Country</Label>
            <MultiCountrySelect value={form.interestedCountry} onChange={v => setForm({ ...form, interestedCountry: v })} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label>Estimated Value (USD)</Label>
            <Input type="number" min="0" step="100" value={form.estimatedValue} onChange={e => setForm({ ...form, estimatedValue: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateLead.isPending || !form.firstName || !form.lastName}>
            {updateLead.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
