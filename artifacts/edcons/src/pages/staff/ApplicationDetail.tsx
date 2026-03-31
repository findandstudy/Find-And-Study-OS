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
import { usePipelineStages } from "@/hooks/use-pipeline-stages";
import { StageDocUploadDialog } from "@/components/StageDocUploadDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, MessageSquare, User, BookOpen, DollarSign,
  MapPin, GraduationCap, Globe, Calendar, Pencil, TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QuickContactButtons } from "@/components/QuickContact";
import { StageDocumentsPanel } from "@/components/StageDocumentsPanel";
import { ApplicationDocumentsPanel, APPLICATION_DOC_STAGES } from "@/components/ApplicationDocumentsPanel";
import { useAuth } from "@/hooks/use-auth";
import OriginBadge from "@/components/OriginBadge";

const STUDY_LEVELS = [
  { value: "associate", label: "Associate" },
  { value: "bachelors", label: "Bachelor's" },
  { value: "masters", label: "Master's" },
  { value: "doctorate", label: "Doctorate" },
  { value: "language", label: "Language" },
  { value: "foundation", label: "Foundation" },
];

function formatCurrency(v: number | string | null | undefined) {
  if (!v) return "—";
  const num = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
}

function getStageColor(stageKey: string) {
  const colors: Record<string, string> = {
    inquiry: "bg-gray-100 text-gray-700",
    documents_collected: "bg-blue-100 text-blue-700",
    submitted: "bg-purple-100 text-purple-700",
    offer_received: "bg-amber-100 text-amber-700",
    visa_applied: "bg-orange-100 text-orange-700",
    visa_approved: "bg-teal-100 text-teal-700",
    enrolled: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  return colors[stageKey] || "bg-gray-100 text-gray-700";
}

interface Props {
  id: number;
  basePath?: string;
}

export default function ApplicationDetail({ id, basePath = "/staff" }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAgent = basePath === "/agent";
  const [noteText, setNoteText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [stageDocUpload, setStageDocUpload] = useState<{ targetStage: string; targetStageLabel: string } | null>(null);
  const { user: authUser } = useAuth();
  const isAdmin = authUser && ["super_admin", "admin", "manager"].includes(authUser.role);

  const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const { data: app, isLoading } = useGetApplication(id);
  const { data: notes = [] } = useGetApplicationNotes(id);
  const { stages: pipelineStages } = usePipelineStages("application");
  const updateApp = useUpdateApplication();
  const addNote = useAddApplicationNote();

  async function handleStageChange(stage: string) {
    try {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)![1]) : "";
      const res = await fetch(`${BASE_URL}/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: [`/api/applications/${id}`] });
        toast({ title: "Stage updated" });
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body.code === "DOCS_REQUIRED") {
        const stageLabel = pipelineStages.find(s => s.key === stage)?.label ?? stage;
        setStageDocUpload({ targetStage: stage, targetStageLabel: stageLabel });
      } else {
        toast({ title: "Error", description: body.error || "Could not update stage", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not update stage", variant: "destructive" });
    }
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

  const stageLabel = pipelineStages.find(s => s.key === app?.stage)?.label || app?.stage?.replace(/_/g, " ") || "—";
  const levelLabel = STUDY_LEVELS.find(l => l.value === app?.level)?.label || app?.level || "—";

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`${basePath}/applications`)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : (
              <h1 className="text-2xl font-display font-bold text-foreground truncate">
                {app?.studentFirstName} {app?.studentLastName}
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">Application #{id}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isLoading && (
              <Badge className={`capitalize px-3 py-1 rounded-full text-sm font-medium border-0 ${getStageColor(app?.stage ?? "inquiry")}`}>
                {stageLabel}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Application Details</h2>
                <Select
                  value={app?.stage}
                  onValueChange={handleStageChange}
                  disabled={updateApp.isPending || isLoading}
                >
                  <SelectTrigger className="w-48 rounded-full border-border">
                    <SelectValue placeholder="Change stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        <span className="capitalize">{s.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <InfoRow icon={<User className="w-4 h-4" />} label="Student" value={app?.studentFirstName && app?.studentLastName ? `${app.studentFirstName} ${app.studentLastName}` : undefined} />
                  <InfoRow icon={<Globe className="w-4 h-4" />} label="Country" value={app?.country} />
                  <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="University" value={app?.universityName} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Program" value={app?.programName} />
                  <InfoRow icon={<BookOpen className="w-4 h-4" />} label="Level" value={levelLabel} />
                  <InfoRow icon={<Globe className="w-4 h-4" />} label="Language" value={app?.instructionLanguage} />
                  <InfoRow icon={<Calendar className="w-4 h-4" />} label="Intake" value={app?.intake} />
                  <InfoRow icon={<Calendar className="w-4 h-4" />} label="Deadline" value={app?.deadline} />
                  <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Tuition Fee" value={formatCurrency(app?.tuitionFee)} />
                  <InfoRow icon={<DollarSign className="w-4 h-4" />} label="Scholarship" value={formatCurrency(app?.scholarship)} />
                  {app?.commissionAmount && parseFloat(app.commissionAmount) > 0 && (
                    <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Commission" value={formatCurrency(app.commissionAmount)} />
                  )}
                  {app?.commissionStatus && (
                    <InfoRow icon={<TrendingUp className="w-4 h-4" />} label="Commission Status" value={app.commissionStatus.replace(/_/g, " ")} />
                  )}
                </div>
              )}

              {app?.notes && (
                <div className="pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{app.notes}</p>
                </div>
              )}
            </div>

            {app && authUser && (
              <>
                <ApplicationDocumentsPanel
                  applicationId={id}
                  userRole={authUser.role}
                  userId={authUser.id}
                />
                <StageDocumentsPanel
                  applicationId={id}
                  currentStage={app.stage}
                  userRole={authUser.role}
                  userId={authUser.id}
                  excludeStages={APPLICATION_DOC_STAGES}
                />
              </>
            )}

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

          <div className="space-y-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
              <h2 className="font-semibold text-foreground">Stage Progress</h2>
              {isLoading ? (
                <Skeleton className="h-8 w-28 rounded-full" />
              ) : (
                <div className="space-y-2">
                  {pipelineStages.map((stage) => (
                    <div
                      key={stage.key}
                      className={`flex items-center gap-2 text-xs py-1 ${app?.stage === stage.key ? "font-bold text-foreground" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${app?.stage === stage.key ? "bg-primary" : "bg-border"}`}
                      />
                      <span className="capitalize">{stage.label}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
                <p>Created: {app ? new Date(app.createdAt).toLocaleDateString() : "—"}</p>
                {app?.updatedAt && <p>Updated: {new Date(app.updatedAt).toLocaleDateString()}</p>}
                {app?.season && <p>Season: {app.season}</p>}
              </div>
            </div>

            {app?.studentEmail && (
              <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-3">
                <h2 className="font-semibold text-foreground text-sm">Student Contact</h2>
                <div className="text-sm space-y-1.5">
                  <p className="text-foreground">{app.studentFirstName} {app.studentLastName}</p>
                  <p className="text-muted-foreground text-xs">{app.studentEmail}</p>
                  {app.studentPhone && <p className="text-muted-foreground text-xs">{app.studentPhone}</p>}
                </div>
                <QuickContactButtons
                  name={`${app.studentFirstName} ${app.studentLastName}`}
                  email={app.studentEmail}
                  phone={app.studentPhone}
                  entityType="application"
                  entityId={id}
                  hideEmail={isAgent}
                  hideWhatsApp={isAgent}
                />
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
                  <OriginBadge originType={app?.originType || "direct"} originDisplayName={app?.originDisplayName} className="text-xs" />
                  {isAdmin && (
                    <Select
                      value={app?.originType || "direct"}
                      onValueChange={(val) => {
                        updateApp.mutate({
                          id: app!.id,
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

            {app?.studentId && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocation(`${basePath}/students/${app.studentId}`)}
              >
                <User className="w-4 h-4 mr-2" />
                View Student Profile
              </Button>
            )}
          </div>
        </div>
      </div>

      {app && (
        <EditApplicationInlineDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          app={app}
          stages={pipelineStages}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/applications/${id}`] });
            toast({ title: "Application updated" });
          }}
        />
      )}
      {stageDocUpload && (
        <StageDocUploadDialog
          open={!!stageDocUpload}
          onClose={() => setStageDocUpload(null)}
          applicationId={id}
          targetStage={stageDocUpload.targetStage}
          targetStageLabel={stageDocUpload.targetStageLabel}
          onUploaded={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/applications/${id}`] });
          }}
        />
      )}
    </DashboardLayout>
  );
}

function EditApplicationInlineDialog({ open, onClose, app, stages, onSaved }: {
  open: boolean; onClose: () => void; app: any; stages: any[]; onSaved: () => void;
}) {
  const updateApp = useUpdateApplication();
  const [form, setForm] = useState({
    stage: app?.stage || "",
    country: app?.country || "",
    universityName: app?.universityName || "",
    programName: app?.programName || "",
    level: app?.level || "",
    instructionLanguage: app?.instructionLanguage || "",
    intake: app?.intake || "",
    deadline: app?.deadline || "",
    tuitionFee: app?.tuitionFee || "",
    scholarship: app?.scholarship || "",
    notes: app?.notes || "",
  });
  const [docUploadDialog, setDocUploadDialog] = useState<{ targetStage: string; targetStageLabel: string } | null>(null);
  const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  async function handleSave() {
    const data: Record<string, any> = {};
    for (const [key, val] of Object.entries(form)) {
      if (val !== (app?.[key] || "")) data[key] = val || null;
    }
    if (Object.keys(data).length === 0) { onClose(); return; }

    try {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)![1]) : "";
      const res = await fetch(`${BASE_URL}/api/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (res.ok) {
        onSaved();
        onClose();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body.code === "DOCS_REQUIRED") {
        const stageLabel = stages.find((s: any) => s.key === data.stage)?.label ?? data.stage;
        setDocUploadDialog({ targetStage: data.stage, targetStageLabel: stageLabel });
      }
    } catch {
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Application</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Stage</Label>
            <Select value={form.stage} onValueChange={v => setForm({ ...form, stage: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Country</Label>
            <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">University</Label>
            <Input value={form.universityName} onChange={e => setForm({ ...form, universityName: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Program</Label>
            <Input value={form.programName} onChange={e => setForm({ ...form, programName: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Level</Label>
            <Select value={form.level} onValueChange={v => setForm({ ...form, level: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {STUDY_LEVELS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Language</Label>
            <Input value={form.instructionLanguage} onChange={e => setForm({ ...form, instructionLanguage: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Intake</Label>
            <Input value={form.intake} onChange={e => setForm({ ...form, intake: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Deadline</Label>
            <Input value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Tuition Fee</Label>
            <Input type="number" value={form.tuitionFee} onChange={e => setForm({ ...form, tuitionFee: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Scholarship</Label>
            <Input type="number" value={form.scholarship} onChange={e => setForm({ ...form, scholarship: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none min-h-[60px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateApp.isPending}>
            {updateApp.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {docUploadDialog && (
      <StageDocUploadDialog
        open={!!docUploadDialog}
        onClose={() => setDocUploadDialog(null)}
        applicationId={app.id}
        targetStage={docUploadDialog.targetStage}
        targetStageLabel={docUploadDialog.targetStageLabel}
        onUploaded={() => { onSaved(); onClose(); }}
      />
    )}
    </>
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
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground truncate">{value || "—"}</p>
      </div>
    </div>
  );
}
