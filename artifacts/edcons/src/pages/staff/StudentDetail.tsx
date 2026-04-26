import { useState, useRef, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetStudent,
  useListApplications,
  useListDocuments,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail, Phone, Globe, GraduationCap, FileText, User, Home, Calendar, Upload, X, CheckCircle2, Camera, Download, Trash2, Plus, Loader2, Pencil, Clock, CalendarClock, Copy, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/apiFetch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CountryFlag } from "@/components/CountryFlag";
import { QuickContactButtons } from "@/components/QuickContact";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { OriginBadge, OriginSection } from "@/components/OriginBadge";
import { AllMessagingHistory } from "@/components/inbox/AllMessagingHistory";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const DOC_TYPES = [
  { key: "passport", label: "Passport" },
  { key: "diploma", label: "Diploma" },
  { key: "transcript", label: "Transcript" },
  { key: "photo", label: "Photo" },
  { key: "other", label: "Other" },
];

const DEGREE_REQUIRED_DOCS: Record<string, string[]> = {
  associate: ["hs_diploma", "hs_transcript", "passport", "photo"],
  bachelors: ["hs_diploma", "hs_transcript", "passport", "photo"],
  masters: ["bachelor_diploma", "bachelor_transcript", "passport", "photo"],
  doctorate: ["bachelor_diploma", "bachelor_transcript", "master_diploma", "master_transcript", "passport", "photo"],
  language: ["passport"],
  foundation: ["passport"],
};

function getRequiredDocsForDegree(degree: string | null | undefined): { keys: string[]; labels: Record<string, string> } {
  const labelMap: Record<string, string> = {
    passport: "Passport", photo: "Photo", photograph: "Photo",
    hs_diploma: "HS Diploma", hs_transcript: "HS Transcript",
    bachelor_diploma: "Bachelor Diploma", bachelor_transcript: "Bachelor Transcript",
    master_diploma: "Master Diploma", master_transcript: "Master Transcript",
  };
  if (!degree) return { keys: ["passport"], labels: labelMap };
  const normalized = degree.toLowerCase().replace(/['''`\s.]/g, "");
  if (normalized.includes("associate")) return { keys: DEGREE_REQUIRED_DOCS.associate, labels: labelMap };
  if (normalized.includes("bachelor")) return { keys: DEGREE_REQUIRED_DOCS.bachelors, labels: labelMap };
  if (normalized.includes("master")) return { keys: DEGREE_REQUIRED_DOCS.masters, labels: labelMap };
  if (normalized.includes("doctor") || normalized.includes("phd") || normalized.includes("doctorate")) return { keys: DEGREE_REQUIRED_DOCS.doctorate, labels: labelMap };
  if (normalized.includes("language")) return { keys: DEGREE_REQUIRED_DOCS.language, labels: labelMap };
  if (normalized.includes("foundation")) return { keys: DEGREE_REQUIRED_DOCS.foundation, labels: labelMap };
  return { keys: ["passport"], labels: labelMap };
}

interface Props {
  id: number;
  basePath?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-600",
  graduated: "bg-blue-100 text-blue-700",
  suspended: "bg-red-100 text-red-700",
};

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

function buildDownloadFilename(docType: string, firstName: string, lastName: string, mimeType: string): string {
  const MIME_EXT: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  const ext = MIME_EXT[mimeType] || (mimeType.startsWith("image/") ? mimeType.split("/")[1].split("+")[0] : "bin");
  const sanitize = (s: string) => (s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${sanitize(docType || "document")}-${sanitize(firstName)}-${sanitize(lastName)}.${ext}`;
}

export default function StudentDetail({ id, basePath = "/staff" }: Props) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const isAgent = basePath === "/agent";

  const { data: student, isLoading } = useGetStudent(id) as { data: any; isLoading: boolean };
  const { data: applicationsResp } = useListApplications({ studentId: id });
  const { data: documentsResp } = useListDocuments({ studentId: id });

  const applications: any[] = (applicationsResp as any)?.data || applicationsResp || [];
  const documents: any[] = Array.isArray(documentsResp) ? documentsResp : (documentsResp as any)?.data || [];

  const photoDoc = useMemo(() => {
    const photoDocs = documents.filter((d: any) => (d.type === "photo" || d.type === "photograph") && d.fileData);
    if (photoDocs.length === 0) return null;
    return photoDocs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [documents]);

  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user && ["super_admin", "admin", "manager"].includes(user.role);
  const isStaffUser = user && ["super_admin", "admin", "manager", "staff"].includes(user.role);
  const isStudent = user?.role === "student";

  const [noteTab, setNoteTab] = useState<"general" | "internal">("general");
  const [noteText, setNoteText] = useState("");
  const { data: generalNotes = [] } = useQuery<any[]>({
    queryKey: [`/api/students/${id}/notes`, "general"],
    queryFn: () => fetch(`${BASE_URL}/api/students/${id}/notes?internal=false`, { credentials: "include" }).then(r => r.json()),
    enabled: !!id,
  });
  const { data: internalNotes = [] } = useQuery<any[]>({
    queryKey: [`/api/students/${id}/notes`, "internal"],
    queryFn: () => fetch(`${BASE_URL}/api/students/${id}/notes?internal=true`, { credentials: "include" }).then(r => r.json()),
    enabled: !!id && !!isStaffUser,
  });
  const activeNotes = noteTab === "internal" ? internalNotes : generalNotes;

  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)?.[1] ? decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)![1]) : "";
      const resp = await fetch(`${BASE_URL}/api/students/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ content: noteText, isInternal: noteTab === "internal" }),
      });
      if (resp.ok) {
        setNoteText("");
        qc.invalidateQueries({ queryKey: [`/api/students/${id}/notes`, noteTab] });
      }
    } catch {}
  }

  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [fuTitle, setFuTitle] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("10:00");
  const [fuNotes, setFuNotes] = useState("");
  const [editingFuId, setEditingFuId] = useState<number | null>(null);

  const { data: followUps = [] } = useQuery<any[]>({
    queryKey: [`/api/students/${id}/follow-ups`],
    queryFn: () => fetch(`${BASE_URL}/api/students/${id}/follow-ups`, { credentials: "include" }).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
    enabled: !!id && !!isStaffUser,
  });

  const createFollowUp = useMutation({
    mutationFn: (body: any) =>
      fetch(`${BASE_URL}/api/students/${id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || "Failed"); }); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/students/${id}/follow-ups`] });
      resetFollowUpForm();
      toast({ title: "Follow-up scheduled" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleFollowUp = useMutation({
    mutationFn: ({ fuId, completed }: { fuId: number; completed: boolean }) =>
      fetch(`${BASE_URL}/api/follow-ups/${fuId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ completed }),
      }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/students/${id}/follow-ups`] });
      toast({ title: "Follow-up updated" });
    },
  });

  const editFollowUp = useMutation({
    mutationFn: ({ fuId, body }: { fuId: number; body: any }) =>
      fetch(`${BASE_URL}/api/follow-ups/${fuId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || "Failed"); }); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/students/${id}/follow-ups`] });
      resetFollowUpForm();
      toast({ title: "Follow-up updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetFollowUpForm() {
    setShowFollowUpForm(false);
    setEditingFuId(null);
    setFuTitle("");
    setFuDate("");
    setFuTime("10:00");
    setFuNotes("");
  }

  function handleCreateFollowUp() {
    if (!fuTitle.trim() || !fuDate) return;
    const scheduledAt = new Date(`${fuDate}T${fuTime}`).toISOString();
    if (editingFuId) {
      editFollowUp.mutate({ fuId: editingFuId, body: { title: fuTitle, scheduledAt, notes: fuNotes || null } });
    } else {
      createFollowUp.mutate({ title: fuTitle, scheduledAt, notes: fuNotes || undefined });
    }
  }

  function startEditFollowUp(fu: any) {
    setEditingFuId(fu.id);
    setFuTitle(fu.title);
    const d = new Date(fu.scheduledAt);
    setFuDate(d.toISOString().slice(0, 10));
    setFuTime(d.toTimeString().slice(0, 5));
    setFuNotes(fu.notes || "");
    setShowFollowUpForm(true);
  }

  function isOverdue(scheduledAt: string) {
    return new Date(scheduledAt) < new Date();
  }

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState("passport");
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showNewApp, setShowNewApp] = useState(false);
  const [appCountry, setAppCountry] = useState("");
  const [appUniversityId, setAppUniversityId] = useState("");
  const [appProgramId, setAppProgramId] = useState("");
  const [appIntake, setAppIntake] = useState("");
  const [appSubmitting, setAppSubmitting] = useState(false);

  const { data: countriesList } = useQuery({
    queryKey: ["app-countries"],
    queryFn: () => customFetch("/api/universities/countries") as Promise<string[]>,
    staleTime: 10 * 60 * 1000,
    enabled: showNewApp,
  });

  const { data: universitiesData } = useQuery({
    queryKey: ["app-universities", appCountry],
    queryFn: () => customFetch(`/api/universities?country=${encodeURIComponent(appCountry)}&limit=100`) as Promise<any>,
    staleTime: 5 * 60 * 1000,
    enabled: showNewApp && !!appCountry,
  });

  const { data: programsData } = useQuery({
    queryKey: ["app-programs", appUniversityId],
    queryFn: () => customFetch(`/api/course-finder?universityId=${appUniversityId}&limit=500`) as Promise<any>,
    staleTime: 60_000,
    enabled: showNewApp && !!appUniversityId,
  });

  const filteredUniversities: any[] = useMemo(() => {
    return universitiesData?.data || [];
  }, [universitiesData]);

  const filteredPrograms: any[] = useMemo(() => {
    return programsData?.data || [];
  }, [programsData]);

  const availableIntakes = useMemo(() => {
    if (!appProgramId) return [];
    const prog = filteredPrograms.find((p: any) => String(p.id) === appProgramId);
    if (!prog?.intakes) return [];
    const raw = typeof prog.intakes === "string" ? prog.intakes : "";
    return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
  }, [appProgramId, filteredPrograms]);

  const hasExistingAppAtSameLevel = useMemo(() => {
    if (!appProgramId) return false;
    const prog = filteredPrograms.find((p: any) => String(p.id) === appProgramId);
    if (!prog?.degree) return false;

    function toCanonicalLevel(raw: string): string | null {
      const s = raw.toLowerCase().replace(/['''`\s._-]/g, "");
      if (s.includes("prebachelor")) return "pre_bachelors";
      if (s.includes("premaster")) return "pre_masters";
      if (s.includes("associate")) return "associate";
      if (s.includes("bachelor") || s === "undergraduate") return "bachelors";
      if (s.includes("master") || s === "postgraduate") return "masters";
      if (s.includes("doctor") || s.includes("phd") || s.includes("doctorate")) return "phd";
      if (s.includes("language")) return "language";
      if (s.includes("foundation")) return "foundation";
      return null;
    }

    const selectedLevel = toCanonicalLevel(prog.degree);
    if (!selectedLevel) return false;

    return applications.some((app: any) => {
      const appLevel = toCanonicalLevel(app.level || app.degree || "");
      return appLevel === selectedLevel;
    });
  }, [appProgramId, filteredPrograms, applications]);

  const missingDocs = useMemo(() => {
    if (!appProgramId) return [];
    if (hasExistingAppAtSameLevel) return [];
    const prog = filteredPrograms.find((p: any) => String(p.id) === appProgramId);
    const { keys, labels } = getRequiredDocsForDegree(prog?.degree);
    const rawTypes = documents.map((d: any) => (d.type || "").toLowerCase());
    const studentDocTypes = new Set(rawTypes);
    rawTypes.forEach(t => {
      if (t === "photograph") studentDocTypes.add("photo");
      if (t === "diploma") { studentDocTypes.add("hs_diploma"); studentDocTypes.add("bachelor_diploma"); studentDocTypes.add("master_diploma"); }
      if (t === "transcript") { studentDocTypes.add("hs_transcript"); studentDocTypes.add("bachelor_transcript"); studentDocTypes.add("master_transcript"); }
    });
    return keys
      .filter(k => !studentDocTypes.has(k))
      .map(k => labels[k] || k);
  }, [appProgramId, filteredPrograms, documents, hasExistingAppAtSameLevel]);

  useEffect(() => { setAppUniversityId(""); setAppProgramId(""); setAppIntake(""); }, [appCountry]);
  useEffect(() => { setAppProgramId(""); setAppIntake(""); }, [appUniversityId]);
  useEffect(() => { setAppIntake(""); }, [appProgramId]);

  async function handleQuickApply() {
    if (!appProgramId) return;
    setAppSubmitting(true);
    try {
      const prog = filteredPrograms.find((p: any) => String(p.id) === appProgramId);
      await customFetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: id,
          programId: Number(appProgramId),
          universityId: prog?.universityId ?? null,
          universityName: prog?.universityName ?? null,
          programName: prog?.name ?? null,
          country: prog?.universityCountry ?? appCountry,
          intake: appIntake || null,
          level: prog?.degree ?? null,
          instructionLanguage: prog?.language ?? null,
          tuitionFee: prog?.tuitionFee ?? null,
          stage: "inquiry",
        }),
      });
      toast({ title: "Application created", description: `${prog?.universityName} – ${prog?.name}` });
      await qc.refetchQueries({ queryKey: ["/api/applications"] });
      setShowNewApp(false);
      setAppCountry(""); setAppUniversityId(""); setAppProgramId(""); setAppIntake("");
    } catch (err: any) {
      let desc = err.message || "Could not create application";
      const errData = err?.data;
      if (errData?.code === "QUOTA_FULL") {
        toast({
          title: errData.error || "Program quota is full for this year",
          variant: "destructive",
          duration: 10000,
        });
      } else if (errData?.code === "ELIGIBILITY_FAILED" && errData?.eligibilityErrors) {
        desc = errData.eligibilityErrors.join("\n");
        toast({
          title: "Eligibility Requirements Not Met",
          description: desc,
          variant: "destructive",
          duration: 10000,
        });
      } else if (errData?.missingFields) {
        desc = `Student is missing required fields: ${errData.missingFields.join(", ")}. Please complete the student profile first.`;
        toast({ title: "Failed", description: desc, variant: "destructive" });
      } else if (errData?.error) {
        desc = errData.error;
        toast({ title: "Failed", description: desc, variant: "destructive" });
      } else {
        toast({ title: "Failed", description: desc, variant: "destructive" });
      }
    } finally {
      setAppSubmitting(false);
    }
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function openUpload() {
    setUploadType("passport");
    setUploadName("");
    setUploadFile(null);
    setUploadOpen(true);
  }

  function getAcceptForType(t: string) {
    return t === "photo" ? ".jpg,.jpeg,.png" : ".jpg,.jpeg,.png,.pdf";
  }

  function handleFileSelect(file: File) {
    const allowed = uploadType === "photo"
      ? ["image/jpeg", "image/png"]
      : ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      const exts = uploadType === "photo" ? "JPG, JPEG, PNG" : "JPG, JPEG, PNG, PDF";
      toast({ title: "Invalid file type", description: `Only ${exts} files are allowed.`, variant: "destructive" });
      return;
    }
    setUploadFile(file);
    if (!uploadName) {
      const type = (DOC_TYPES.find(d => d.key === uploadType)?.label ?? "document").toLowerCase();
      const first = (student?.firstName ?? "").toLowerCase();
      const last = (student?.lastName ?? "").toLowerCase();
      setUploadName(`${type}-${first}-${last}`);
    }
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const base64 = await fileToBase64(uploadFile);
      const type = (DOC_TYPES.find(d => d.key === uploadType)?.label ?? "document").toLowerCase();
      const first = (student?.firstName ?? "").toLowerCase();
      const last = (student?.lastName ?? "").toLowerCase();
      const docName = uploadName.trim() || `${type}-${first}-${last}`;

      const resp = await apiFetch(`${BASE_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: docName,
          type: uploadType,
          status: "pending",
          studentId: id,
          fileData: base64,
          mimeType: uploadFile.type,
          sizeBytes: uploadFile.size,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "Upload failed");
        alert(err);
        return;
      }

      await qc.invalidateQueries({ predicate: q => q.queryKey.some(k => typeof k === "string" && (k.includes("document") || k.includes("student") || k.includes(`/api/students`))) });
      setUploadOpen(false);
    } finally {
      setUploading(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    if (!file.type.startsWith("image/")) return;
    setPhotoUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const first = (student?.firstName ?? "").toLowerCase();
      const last = (student?.lastName ?? "").toLowerCase();

      const resp = await apiFetch(`${BASE_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `photo-${first}-${last}`,
          type: "photo",
          status: "approved",
          studentId: id,
          fileData: base64,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text().catch(() => "Photo upload failed");
        alert(err);
        return;
      }

      await qc.invalidateQueries({ predicate: q => q.queryKey.some(k => typeof k === "string" && (k.includes("document") || k.includes("student") || k.includes(`/api/students`))) });
    } finally {
      setPhotoUploading(false);
    }
  }

  function downloadPhoto() {
    if (!photoDoc) return;
    const mime = photoDoc.mimeType || "image/jpeg";
    const filename = buildDownloadFilename("photo", student?.firstName ?? "", student?.lastName ?? "", mime);
    const link = document.createElement("a");
    link.href = `data:${mime};base64,${photoDoc.fileData}`;
    link.download = filename;
    link.click();
  }

  return (
    <>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`${basePath}/students`)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="relative group shrink-0">
            {isLoading ? (
              <Skeleton className="w-20 h-20 rounded-full" />
            ) : photoDoc ? (
              <img
                src={`data:${photoDoc.mimeType || "image/jpeg"};base64,${photoDoc.fileData}`}
                alt={`${student?.firstName} ${student?.lastName}`}
                className="w-20 h-20 rounded-full object-cover border-2 border-primary/20"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold border-2 border-primary/20">
                {(student?.firstName?.[0] ?? "").toUpperCase()}{(student?.lastName?.[0] ?? "").toUpperCase()}
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
              <button
                className="p-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                title="Upload photo"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
              >
                <Camera className="w-4 h-4" />
              </button>
              {photoDoc && (
                <button
                  className="p-1.5 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
                  title="Download photo"
                  onClick={downloadPhoto}
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
            {photoUploading && (
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handlePhotoUpload(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex-1">
            {isLoading ? (
              <Skeleton className="h-8 w-48" />
            ) : (
              <h1 className="text-2xl font-display font-bold text-foreground">
                {student?.firstName} {student?.lastName}
              </h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">Student Profile</p>
          </div>
          {!isLoading && student && (
            <div className="flex items-center gap-2">
              <QuickContactButtons
                name={`${student.firstName} ${student.lastName}`}
                email={student.email}
                phone={student.phone}
                entityType="student"
                entityId={id}
                hideEmail={isAgent}
                hideWhatsApp={isAgent}
              />
              <Badge
                className={`capitalize px-3 py-1 rounded-full text-sm font-medium border-0 ${STATUS_COLORS[student.status ?? "active"]}`}
              >
                {student.status}
              </Badge>
            </div>
          )}
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/60">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="documents">
              Documents {documents.length > 0 && `(${documents.length})`}
            </TabsTrigger>
            <TabsTrigger value="notes">
              Notes ({generalNotes.length + internalNotes.length})
            </TabsTrigger>
            <TabsTrigger value="applications">
              Applications {applications.length > 0 && `(${applications.length})`}
            </TabsTrigger>
            {isStaffUser && (
              <TabsTrigger value="followups">
                Follow-ups {(followUps as any[]).length > 0 && `(${(followUps as any[]).length})`}
              </TabsTrigger>
            )}
            <TabsTrigger value="messaging">All Messaging</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4">
            <div className="flex justify-end mb-2">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setShowEditDialog(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                Edit Profile
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                <h2 className="font-semibold text-foreground">Personal Information</h2>
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <InfoRow icon={<Calendar className="w-4 h-4" />} label="Date of Birth" value={student?.dateOfBirth} />
                    <InfoRow icon={<Globe className="w-4 h-4" />} label="Nationality" value={student?.nationality} />
                    <InfoRow icon={<Mail className="w-4 h-4" />} label="Email" value={student?.email} />
                    <InfoRow icon={<Phone className="w-4 h-4" />} label="Phone" value={student?.phone} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="Mother's Name" value={student?.motherName} />
                    <InfoRow icon={<User className="w-4 h-4" />} label="Father's Name" value={student?.fatherName} />
                    <InfoRow icon={<Home className="w-4 h-4" />} label="Address" value={student?.address} />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-foreground">Passport / ID</h2>
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <InfoRow icon={<FileText className="w-4 h-4" />} label="Passport No" value={student?.passportNumber} />
                      <InfoRow icon={<Calendar className="w-4 h-4" />} label="Issue Date" value={student?.passportIssueDate} />
                      <InfoRow icon={<Calendar className="w-4 h-4" />} label="Expiry Date" value={student?.passportExpiry} />
                    </div>
                  )}
                </div>

                <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                  <h2 className="font-semibold text-foreground">Academic Information</h2>
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm">
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="High School" value={student?.highSchool} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Graduation Year" value={student?.graduationYear?.toString()} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="GPA" value={student?.gpa} />
                      <InfoRow icon={<GraduationCap className="w-4 h-4" />} label="Language Score" value={student?.languageScore} />
                    </div>
                  )}
                </div>

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
                      <OriginBadge originType={student?.originType || "direct"} originDisplayName={student?.originDisplayName} className="text-xs" />
                      {isAdmin && (
                        <Select
                          value={student?.originType || "direct"}
                          onValueChange={(val) => {
                            customFetch(`/api/students/${id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                originType: val,
                                originDisplayName: val === "direct" ? "Find And Study" : null,
                              }),
                            }).then(() => {
                              qc.invalidateQueries({ queryKey: ["getStudent"] });
                              toast({ title: "Origin updated" });
                            });
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
              </div>
            </div>

            {student?.notes && (
              <div className="mt-4 bg-card rounded-2xl border shadow-sm p-6">
                <h2 className="font-semibold text-foreground mb-2">Notes</h2>
                <p className="text-sm text-foreground">{student.notes}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-semibold text-foreground">Notes</h2>
              </div>

              <div className="flex gap-1 border-b">
                <button
                  onClick={() => setNoteTab("general")}
                  className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${noteTab === "general" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  General ({generalNotes.length})
                </button>
                {isStaffUser && (
                  <button
                    onClick={() => setNoteTab("internal")}
                    className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${noteTab === "internal" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    🔒 Private ({internalNotes.length})
                  </button>
                )}
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto">
                {activeNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes yet.</p>
                ) : (
                  activeNotes.map((note: any) => (
                    <div key={note.id} className={`rounded-xl p-3 ${noteTab === "internal" ? "bg-orange-50 border border-orange-200" : "bg-secondary/50"}`}>
                      <p className="text-sm text-foreground">{note.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {note.authorName || "Team"} · {new Date(note.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {!isStudent && (noteTab === "general" || isStaffUser) && (
                <div className="flex gap-2 pt-2 border-t">
                  <textarea
                    placeholder={noteTab === "internal" ? "Add a private note (only visible to staff)..." : "Add a note..."}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className={`flex-1 resize-none min-h-[72px] rounded-md border px-3 py-2 text-sm ${noteTab === "internal" ? "border-orange-300 focus:ring-orange-400" : "border-input"}`}
                  />
                  <Button
                    onClick={handleAddNote}
                    disabled={!noteText.trim()}
                    className={`self-end ${noteTab === "internal" ? "bg-orange-500 hover:bg-orange-600" : ""}`}
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">{applications.length} application{applications.length !== 1 ? "s" : ""}</p>
              <Button size="sm" onClick={() => setShowNewApp(!showNewApp)}>
                <Plus className="w-4 h-4 mr-1" />
                New Application
              </Button>
            </div>

            {showNewApp && (
              <div className="bg-card rounded-2xl border shadow-sm p-4 mb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs font-medium mb-1 block">Country</Label>
                    <SearchableSelect
                      value={appCountry}
                      onValueChange={setAppCountry}
                      options={(countriesList || []).map((c: string) => ({ value: c, label: c }))}
                      placeholder="Select Country"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium mb-1 block">University</Label>
                    <SearchableSelect
                      value={appUniversityId}
                      onValueChange={setAppUniversityId}
                      options={filteredUniversities.map((u: any) => ({ value: String(u.id), label: u.name }))}
                      placeholder={!appCountry ? "Select country first" : "Select University"}
                      disabled={!appCountry}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium mb-1 block">Course</Label>
                    <SearchableSelect
                      value={appProgramId}
                      onValueChange={setAppProgramId}
                      options={filteredPrograms.map((p: any) => ({ value: String(p.id), label: p.name }))}
                      placeholder={!appUniversityId ? "Select university first" : "Select Course"}
                      disabled={!appUniversityId}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium mb-1 block">Intake</Label>
                    <SearchableSelect
                      value={appIntake}
                      onValueChange={setAppIntake}
                      options={availableIntakes.map((i: string) => ({ value: i, label: i }))}
                      placeholder={availableIntakes.length === 0 ? "Select course first" : "Select Intake"}
                      disabled={availableIntakes.length === 0}
                    />
                  </div>
                </div>
                {hasExistingAppAtSameLevel && appProgramId && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-700">Documents already on file from a previous application at the same level.</p>
                  </div>
                )}
                {missingDocs.length > 0 && appProgramId && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-medium text-red-700 mb-1">Missing required documents:</p>
                    <p className="text-xs text-red-600">{missingDocs.join(", ")}</p>
                    <p className="text-xs text-muted-foreground mt-1">Please upload these documents in the Documents tab before creating an application.</p>
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => { setShowNewApp(false); setAppCountry(""); setAppUniversityId(""); setAppProgramId(""); setAppIntake(""); }}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!appProgramId || appSubmitting || missingDocs.length > 0} onClick={handleQuickApply}>
                    {appSubmitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Create Application
                  </Button>
                </div>
              </div>
            )}

            <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
              {applications.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No applications yet.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">University</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Program</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Stage</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Created</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((app: any) => (
                      <tr key={app.id} className="border-t hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-medium">{app.universityName ?? app.universityId ?? "\u2014"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{app.programName ?? app.programId ?? "\u2014"}</td>
                        <td className="px-4 py-3">
                          <Badge
                            className={`capitalize text-xs px-2 py-0.5 border-0 rounded-full ${STAGE_COLORS[app.stage] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {app.stage?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(app.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocation(`${basePath}/applications/${app.id}`)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <StudentDocumentsSection
              studentId={id}
              student={student}
              documents={documents}
              openUpload={openUpload}
              qc={qc}
            />
          </TabsContent>

          {isStaffUser && (
            <TabsContent value="followups" className="mt-4">
              <div className="bg-card rounded-2xl border shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-primary" />
                    <h2 className="font-semibold text-foreground">Follow-ups</h2>
                    <span className="text-xs text-muted-foreground">({(followUps as any[]).length})</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => { resetFollowUpForm(); setShowFollowUpForm(!showFollowUpForm); }}
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
                        min={new Date().toISOString().slice(0, 10)}
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
                      <Button variant="ghost" size="sm" onClick={resetFollowUpForm}>Cancel</Button>
                      <Button
                        size="sm"
                        onClick={handleCreateFollowUp}
                        disabled={(editingFuId ? editFollowUp.isPending : createFollowUp.isPending) || !fuTitle.trim() || !fuDate}
                      >
                        {editingFuId ? "Save" : "Schedule"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2 max-h-[400px] overflow-y-auto">
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
                          <div className="flex items-center justify-between">
                            <p className={`text-sm font-medium ${fu.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {fu.title}
                            </p>
                            {!fu.completed && (
                              <button
                                onClick={() => startEditFollowUp(fu)}
                                className="shrink-0 p-1 rounded hover:bg-secondary transition-colors"
                              >
                                <Pencil className="w-3 h-3 text-muted-foreground" />
                              </button>
                            )}
                          </div>
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
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {fu.createdByName && (
                              <span className="text-xs text-muted-foreground/60">by {fu.createdByName}</span>
                            )}
                            {fu.createdAt && (
                              <span className="text-xs text-muted-foreground/50">
                                {new Date(fu.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                {" "}
                                {new Date(fu.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            )}
                            {fu.updatedAt && fu.createdAt && new Date(fu.updatedAt).getTime() - new Date(fu.createdAt).getTime() > 2000 && (
                              <span className="text-xs text-amber-500/70">
                                (edited {new Date(fu.updatedAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                {" "}
                                {new Date(fu.updatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          )}

          <TabsContent value="messaging" className="mt-4">
            <AllMessagingHistory type="student" id={Number(id)} />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={uploadOpen} onOpenChange={o => { if (!uploading) setUploadOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Document Type</Label>
              <Select value={uploadType} onValueChange={v => {
                setUploadType(v);
                setUploadFile(null);
                const type = (DOC_TYPES.find(d => d.key === v)?.label ?? "document").toLowerCase();
                const first = (student?.firstName ?? "").toLowerCase();
                const last = (student?.lastName ?? "").toLowerCase();
                setUploadName(`${type}-${first}-${last}`);
              }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map(d => (
                    <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Document Name</Label>
              <Input
                className="mt-1"
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder={`passport-${(student?.firstName ?? "").toLowerCase()}-${(student?.lastName ?? "").toLowerCase()}`}
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">File</Label>
              <div
                className={`mt-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragging ? "border-primary bg-primary/5" : uploadFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-secondary/40"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileSelect(file);
                }}
              >
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-foreground truncate max-w-[240px]">{uploadFile.name}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(uploadFile.size / 1024)} KB</p>
                    </div>
                    <button
                      type="button"
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      onClick={e => { e.stopPropagation(); setUploadFile(null); }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                    <p className="text-sm font-medium text-muted-foreground">Drag & drop or click</p>
                    <p className="text-xs text-muted-foreground mt-1">{uploadType === "photo" ? "JPG, PNG — max 10 MB" : "PDF, JPG, PNG — max 10 MB"}</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptForType(uploadType)}
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading ? "Uploading\u2026" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {student && (
        <EditStudentDetailDialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          student={student}
          studentId={id}
        />
      )}
    </>
  );
}

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

const GRADING_SYSTEMS = [
  { value: "4", label: "/ 4", max: 4, placeholder: "e.g. 3.8" },
  { value: "5", label: "/ 5", max: 5, placeholder: "e.g. 4.5" },
  { value: "10", label: "/ 10", max: 10, placeholder: "e.g. 8.5" },
  { value: "100", label: "/ 100", max: 100, placeholder: "e.g. 85" },
];

function parsePhoneCode(fullPhone: string): { phoneCode: string; phone: string } {
  if (!fullPhone) return { phoneCode: "+90", phone: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find(pc => fullPhone.startsWith(pc.code));
  if (matched) return { phoneCode: matched.code, phone: fullPhone.slice(matched.code.length).trim() };
  return { phoneCode: "+90", phone: fullPhone.replace(/^\+/, "").trim() };
}

function NationalityCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [searchVal, setSearchVal] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: countriesResp } = useQuery({
    queryKey: ["all-countries-nationality"],
    queryFn: () => fetch(`${BASE_URL}/api/countries?limit=500`, { credentials: "include" }).then(r => r.json()),
    staleTime: 5 * 60_000,
  });
  const allCountries: Array<{ id: number; name: string; code?: string }> = countriesResp?.data ?? [];

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
    <>
    <div className="relative" ref={containerRef}>
      <Input
        value={open ? searchVal : value}
        onChange={e => { setSearchVal(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setSearchVal(""); setOpen(true); }}
        placeholder={value || "Select or type..."}
        autoComplete="off"
        className="rounded-xl h-9"
      />
      {open && (
        <div className="absolute z-[9999] mt-1 w-full bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 && <div className="p-3 text-sm text-muted-foreground text-center">{searchVal ? "No match — custom value OK" : "No countries loaded"}</div>}
          {filtered.map(c => (
            <button key={c.id} type="button" className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/70 transition-colors flex items-center gap-2 ${c.name === value ? "bg-primary/10 font-medium" : ""}`}
              onMouseDown={e => { e.preventDefault(); onChange(c.name); setSearchVal(""); setOpen(false); }}>
              {c.code && <CountryFlag code={c.code} size="sm" />}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

function EditStudentDetailDialog({ open, onClose, student, studentId }: {
  open: boolean; onClose: () => void; student: any; studentId: number;
}) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "", phoneCode: "+90",
    nationality: "", dateOfBirth: "",
    passportNumber: "", passportIssueDate: "", passportExpiry: "",
    motherName: "", fatherName: "", address: "",
    highSchool: "", graduationYear: "", gpa: "", gradingSystem: "4",
    universityBachelor: "", universityMaster: "",
    languageScore: "", notes: "", interestedLevel: "",
  });
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && student) {
      const parsed = parsePhoneCode(student.phone || "");
      const gpaRaw = student.gpa || "";
      let gpaVal = gpaRaw;
      let gradingSys = "4";
      const gpaMatch = gpaRaw.match(/^([\d.]+)\s*\/\s*(\d+)$/);
      if (gpaMatch) {
        gpaVal = gpaMatch[1];
        const ms = GRADING_SYSTEMS.find(g => g.value === gpaMatch[2]);
        if (ms) gradingSys = ms.value;
      }
      setForm({
        firstName: student.firstName || "", lastName: student.lastName || "",
        email: student.email || "", phone: parsed.phone, phoneCode: parsed.phoneCode,
        nationality: student.nationality || "", dateOfBirth: student.dateOfBirth || "",
        passportNumber: student.passportNumber || "",
        passportIssueDate: student.passportIssueDate || "",
        passportExpiry: student.passportExpiry || "",
        motherName: student.motherName || "", fatherName: student.fatherName || "",
        address: student.address || "",
        highSchool: student.highSchool || "",
        graduationYear: student.graduationYear?.toString() || "",
        gpa: gpaVal, gradingSystem: gradingSys,
        universityBachelor: student.universityBachelor || "",
        universityMaster: student.universityMaster || "",
        languageScore: student.languageScore || "",
        notes: student.notes || "",
        interestedLevel: student.interestedLevel || "",
      });
    }
  }, [open, student]);

  function field(name: string) {
    return (val: string) => setForm(f => ({ ...f, [name]: val }));
  }

  async function handleSave() {
    if (!form.firstName || !form.lastName) return;
    setSaving(true);
    try {
      const phone = form.phone ? `${form.phoneCode}${form.phone.replace(/^\s+/, "")}` : "";
      const gpa = form.gpa ? (form.gradingSystem !== "4" ? `${form.gpa}/${form.gradingSystem}` : form.gpa) : "";
      const res = await fetch(`${BASE_URL}/api/students/${studentId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName,
          email: form.email, phone,
          nationality: form.nationality,
          dateOfBirth: form.dateOfBirth,
          passportNumber: form.passportNumber,
          passportIssueDate: form.passportIssueDate,
          passportExpiry: form.passportExpiry,
          motherName: form.motherName, fatherName: form.fatherName,
          address: form.address, highSchool: form.highSchool,
          graduationYear: form.graduationYear ? parseInt(form.graduationYear) : null,
          gpa, universityBachelor: form.universityBachelor,
          universityMaster: form.universityMaster,
          languageScore: form.languageScore, notes: form.notes,
          interestedLevel: form.interestedLevel || null,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Student updated" });
      qc.invalidateQueries({ queryKey: [`/api/students/${studentId}`] });
      qc.invalidateQueries({ queryKey: ["/api/students"] });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    } finally { setSaving(false); }
  }

  const F = ({ label, value, onChange, type = "text", placeholder = "", required = false, className = "", latinUppercase = false }: {
    label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; className?: string; latinUppercase?: boolean;
  }) => (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="font-semibold text-sm">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      <Input type={type} value={value} onChange={e => { let v = e.target.value; if (latinUppercase) v = v.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, ""); onChange(v); }} placeholder={placeholder} className={`rounded-xl h-9 ${latinUppercase ? "uppercase" : ""}`} />
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>Edit Student</DialogTitle></DialogHeader>
        <div className="overflow-y-auto flex-1 space-y-6 pr-1 py-2">
          <section className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2">
              <User className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Personal Information</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F required label="First Name" value={form.firstName} onChange={field("firstName")} placeholder="First name" latinUppercase />
              <F required label="Last Name" value={form.lastName} onChange={field("lastName")} placeholder="Last name" latinUppercase />
              <F label="Email" value={form.email} onChange={field("email")} type="email" placeholder="email@example.com" />
              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">Phone</Label>
                <div className="flex gap-1.5">
                  <Select value={form.phoneCode} onValueChange={field("phoneCode")}>
                    <SelectTrigger className="w-[100px] h-9 text-sm rounded-xl shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PHONE_CODES.map(pc => (
                        <SelectItem key={`${pc.code}-${pc.country}`} value={pc.code}>
                          <span className="inline-flex items-center gap-1.5"><CountryFlag code={pc.country} size="sm" />{pc.code}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="555 000 0000" className="rounded-xl flex-1 h-9" />
                </div>
              </div>
              <F label="Date of Birth" value={form.dateOfBirth} onChange={field("dateOfBirth")} type="date" />
              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">Nationality</Label>
                <NationalityCombobox value={form.nationality} onChange={field("nationality")} />
              </div>
              <F label="Mother's Name" value={form.motherName} onChange={field("motherName")} placeholder="Mother's name" latinUppercase />
              <F label="Father's Name" value={form.fatherName} onChange={field("fatherName")} placeholder="Father's name" latinUppercase />
              <F label="Address" value={form.address} onChange={field("address")} placeholder="Full home address" className="col-span-2" />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Passport / Identity</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Passport Number" value={form.passportNumber} onChange={field("passportNumber")} placeholder="e.g. AB1234567" className="col-span-2" />
              <F label="Issue Date" value={form.passportIssueDate} onChange={field("passportIssueDate")} type="date" />
              <F label="Expiry Date" value={form.passportExpiry} onChange={field("passportExpiry")} type="date" />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2">
              <GraduationCap className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Education</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label className="font-semibold text-sm">Interested Level</Label>
                <Select value={form.interestedLevel} onValueChange={field("interestedLevel")}>
                  <SelectTrigger className="rounded-xl h-9">
                    <SelectValue placeholder="Select level..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_bachelors">Associate</SelectItem>
                    <SelectItem value="bachelors">Bachelors</SelectItem>
                    <SelectItem value="pre_masters">Pre-Masters</SelectItem>
                    <SelectItem value="masters">Masters</SelectItem>
                    <SelectItem value="phd">Ph.D</SelectItem>
                    <SelectItem value="others">Others</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <F label="High School" value={form.highSchool} onChange={field("highSchool")} placeholder="e.g. Ankara Fen Lisesi" className="col-span-2" />
              <F label="University (Bachelor)" value={form.universityBachelor} onChange={field("universityBachelor")} placeholder="e.g. Istanbul University" className="col-span-2" />
              <F label="University (Master)" value={form.universityMaster} onChange={field("universityMaster")} placeholder="e.g. Bogazici University" className="col-span-2" />
              <F label="Graduation Year" value={form.graduationYear} onChange={field("graduationYear")} placeholder="e.g. 2022" />
              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">GPA</Label>
                <div className="flex gap-1.5">
                  <Input
                    type="number" step="0.01" min="0"
                    max={GRADING_SYSTEMS.find(g => g.value === form.gradingSystem)?.max ?? 4}
                    value={form.gpa}
                    onChange={e => setForm(f => ({ ...f, gpa: e.target.value }))}
                    placeholder={GRADING_SYSTEMS.find(g => g.value === form.gradingSystem)?.placeholder ?? "e.g. 3.8"}
                    className="rounded-xl flex-1 h-9"
                  />
                  <Select value={form.gradingSystem} onValueChange={v => setForm(f => ({ ...f, gradingSystem: v, gpa: "" }))}>
                    <SelectTrigger className="w-[110px] h-9 text-sm rounded-xl shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADING_SYSTEMS.map(gs => (
                        <SelectItem key={gs.value} value={gs.value}>/ {gs.value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <F label="Language Score" value={form.languageScore} onChange={field("languageScore")} placeholder="e.g. IELTS 7.0, TOEFL 100" className="col-span-2" />
            </div>
          </section>

          <div className="space-y-1.5">
            <Label className="font-semibold text-sm">Notes</Label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes about this student..."
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>
        </div>
        <DialogFooter className="pt-3 border-t border-border/50">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={!form.firstName || !form.lastName || saving} className="rounded-xl">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const hasValue = !!(value && value.trim());

  const handleCopy = async () => {
    if (!hasValue) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value!);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value!;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast({ title: `${label} kopyalandı`, description: value! });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Kopyalanamadı", variant: "destructive" });
    }
  };

  return (
    <>
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {hasValue ? (
          <button
            type="button"
            onClick={handleCopy}
            title={`Kopyala: ${value}`}
            className="group inline-flex items-center gap-1.5 max-w-full text-left font-medium text-foreground rounded px-1 -mx-1 py-0.5 hover:bg-muted/60 active:bg-muted transition-colors cursor-pointer"
            data-testid={`copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <span className="truncate">{value}</span>
            {copied ? (
              <Check className="w-3 h-3 shrink-0 text-green-600" />
            ) : (
              <Copy className="w-3 h-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
            )}
          </button>
        ) : (
          <p className="font-medium text-foreground">{"\u2014"}</p>
        )}
      </div>
    </div>
    </>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const DETAIL_DOC_TYPE_LABELS: Record<string, string> = {
  high_school_diploma_translation: "High School Diploma (Translation)",
  class_10th_ssc_marks_sheet: "Class 10th/SSC Marks Sheet",
  class_12th_hsc_certificate: "Class 12th/+2/HSC Certificate",
  class_12th_hsc_marks_sheet: "Class 12th/+2/HSC Marks Sheet",
  diploma_certificate: "Diploma Certificate",
  diploma_transcript: "Diploma Transcript",
  bachelors_certificate: "Bachelors Certificate",
  bachelors_transcript: "Bachelors Transcript",
  bachelors_provisional_certificate: "Bachelors Provisional Certificate",
  bachelors_transcript_all_semesters: "Bachelors Transcript (All Semesters)",
  masters_certificate: "Masters Certificate",
  masters_transcript: "Masters Transcript",
  masters_provisional_certificate: "Masters Provisional Certificate",
  masters_transcript_all_semesters: "Masters Transcript (All Semesters)",
  passport: "Passport",
  cv: "CV",
  lor: "LOR",
  sop: "SOP",
  essay: "Essay",
  experience_letters: "Experience Letters",
  other_certificates_documents: "Other Certificates/Documents",
  ielts_pte_gre_gmat_toefl_duolingo: "IELTS/PTE/GRE/GMAT/TOEFL/Duolingo",
  photo: "Photo",
  diploma_recognition: "Diploma Recognition",
};

function StudentDocumentsSection({ studentId, student, documents, openUpload, qc }: {
  studentId: number;
  student: any;
  documents: any[];
  openUpload: () => void;
  qc: any;
}) {
  const { toast } = useToast();
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [mergingPdf, setMergingPdf] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]);

  const { data: docRequirements } = useQuery({
    queryKey: ["document-requirements"],
    queryFn: async () => {
      const res: any = await customFetch(`/api/document-requirements`);
      return res as any[];
    },
  });

  const level = student?.interestedLevel;
  const requiredDocs = useMemo(() => {
    if (!docRequirements || !level) return [];
    return docRequirements
      .filter((r: any) => r.level === level && r.enabled)
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }, [docRequirements, level]);

  const mandatoryMissing = useMemo(() => {
    if (!requiredDocs.length) return [];
    const uploadedTypes = new Set(documents.map((d: any) => (d.type || "").toLowerCase()));
    return requiredDocs
      .filter((r: any) => r.mandatory && !uploadedTypes.has(r.documentType))
      .map((r: any) => DETAIL_DOC_TYPE_LABELS[r.documentType] || r.documentType);
  }, [requiredDocs, documents]);

  const handleZipDownload = async () => {
    setDownloadingZip(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/documents/download-zip/${studentId}`, { credentials: "include" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Download failed" }));
        toast({ title: "Error", description: err.error || "Download failed", variant: "destructive" });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${student?.firstName || "student"}_${student?.lastName || "docs"}_documents.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "Failed to download ZIP", variant: "destructive" });
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleMergePdf = async () => {
    if (selectedForMerge.length < 2) {
      toast({ title: "Select PDFs", description: "Select at least 2 PDF documents to merge.", variant: "destructive" });
      return;
    }
    setMergingPdf(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/documents/merge-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documentIds: selectedForMerge, studentId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Merge failed" }));
        toast({ title: "Error", description: err.error || "Merge failed", variant: "destructive" });
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "merged_documents.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Success", description: "PDFs merged and downloaded." });
      setSelectedForMerge([]);
    } catch {
      toast({ title: "Error", description: "Failed to merge PDFs", variant: "destructive" });
    } finally {
      setMergingPdf(false);
    }
  };

  const toggleMergeSelection = (docId: number) => {
    setSelectedForMerge(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const pdfDocs = documents.filter((d: any) => d.mimeType === "application/pdf" && (d.fileData || d.fileUrl));

  return (
    <>
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">{documents.length} documents</p>
        <div className="flex items-center gap-2 flex-wrap">
          {documents.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleZipDownload} disabled={downloadingZip}>
              {downloadingZip ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download ZIP
            </Button>
          )}
          {pdfDocs.length >= 2 && (
            <Button size="sm" variant="outline" onClick={handleMergePdf} disabled={mergingPdf || selectedForMerge.length < 2}>
              {mergingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Merge PDFs ({selectedForMerge.length})
            </Button>
          )}
          <Button size="sm" onClick={openUpload}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Docs
          </Button>
        </div>
      </div>

      {level && requiredDocs.length > 0 && (
        <div className="mb-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-4 h-4 text-blue-600" />
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              Required Documents for {level.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {requiredDocs.map((r: any) => {
              const uploaded = documents.some((d: any) => (d.type || "").toLowerCase() === r.documentType);
              return (
                <Badge
                  key={r.id}
                  variant={uploaded ? "default" : "outline"}
                  className={`text-xs ${uploaded ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : r.mandatory ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400" : "border-gray-300 text-gray-500"}`}
                >
                  {uploaded && <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {DETAIL_DOC_TYPE_LABELS[r.documentType] || r.documentType}
                  {r.mandatory && !uploaded && " *"}
                </Badge>
              );
            })}
          </div>
          {mandatoryMissing.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-2">
              Missing mandatory: {mandatoryMissing.join(", ")}
            </p>
          )}
        </div>
      )}

      {!level && (
        <div className="mb-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Set the student's "Interested Level" in the Edit form to see level-specific required documents.
          </p>
        </div>
      )}

      <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
        {documents.length === 0 ? (
          <div
            className="p-16 text-center text-muted-foreground cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={openUpload}
          >
            <Upload className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No documents yet</p>
            <p className="text-xs mt-1">Click to upload documents</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                {pdfDocs.length >= 2 && (
                  <th className="text-center px-2 py-3 w-8">
                    <span className="text-xs text-muted-foreground">PDF</span>
                  </th>
                )}
                <th className="text-left px-4 py-3 font-semibold text-foreground">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-foreground">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-foreground">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-foreground">Uploaded</th>
                <th className="text-left px-4 py-3 font-semibold text-foreground">File</th>
                <th className="text-left px-4 py-3 font-semibold text-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc: any) => (
                <tr key={doc.id} className="border-t hover:bg-primary/5 transition-colors">
                  {pdfDocs.length >= 2 && (
                    <td className="px-2 py-3 text-center">
                      {(doc.mimeType === "application/pdf" && (doc.fileData || doc.fileUrl)) && (
                        <input
                          type="checkbox"
                          checked={selectedForMerge.includes(doc.id)}
                          onChange={() => toggleMergeSelection(doc.id)}
                          className="rounded border-gray-300"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">{doc.name}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{DETAIL_DOC_TYPE_LABELS[doc.type] || doc.type}</td>
                  <td className="px-4 py-3">
                    <Badge className="capitalize text-xs px-2 py-0.5 border-0 rounded-full bg-secondary text-secondary-foreground">
                      {doc.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {doc.fileData && (
                      <button
                        onClick={() => {
                          const mimeType = doc.mimeType || "application/octet-stream";
                          const filename = buildDownloadFilename(doc.type, student?.firstName ?? "", student?.lastName ?? "", mimeType);
                          const link = document.createElement("a");
                          link.href = `data:${mimeType};base64,${doc.fileData}`;
                          link.download = filename;
                          link.click();
                        }}
                        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    )}
                    {doc.fileUrl && !doc.fileData && (
                      <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium">
                        View
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={async () => {
                        if (!confirm("Are you sure you want to delete this document?")) return;
                        const resp = await apiFetch(`${BASE_URL}/api/documents/${doc.id}`, { method: "DELETE" });
                        if (resp.ok) {
                          await qc.invalidateQueries({ predicate: (q: any) => q.queryKey.some((k: any) => typeof k === "string" && (k.includes("document") || k.includes("student"))) });
                        }
                      }}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                      title="Delete document"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
    </>
  );
}
