import { useState, useRef, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useGetStudent,
  useListApplications,
  useListDocuments,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Mail, Phone, Globe, GraduationCap, FileText, User, Home, Calendar, Upload, X, CheckCircle2, Camera, Download, Trash2, Plus, Loader2 } from "lucide-react";
import { QuickContactButtons } from "@/components/QuickContact";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";

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

  const { data: student, isLoading } = useGetStudent(id);
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

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState("passport");
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

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

  const missingDocs = useMemo(() => {
    if (!appProgramId) return [];
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
  }, [appProgramId, filteredPrograms, documents]);

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
      toast({ title: "Failed", description: err.message || "Could not create application", variant: "destructive" });
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

  function handleFileSelect(file: File) {
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

      const resp = await fetch(`${BASE_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

      await qc.invalidateQueries({ predicate: q => q.queryKey.some(k => typeof k === "string" && k.includes("document")) });
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

      const resp = await fetch(`${BASE_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

      await qc.invalidateQueries({ predicate: q => q.queryKey.some(k => typeof k === "string" && k.includes("document")) });
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
    <DashboardLayout>
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
              accept="image/*"
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
            <TabsTrigger value="applications">
              Applications {applications.length > 0 && `(${applications.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documents {documents.length > 0 && `(${documents.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4">
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
              </div>
            </div>

            {student?.notes && (
              <div className="mt-4 bg-card rounded-2xl border shadow-sm p-6">
                <h2 className="font-semibold text-foreground mb-2">Notes</h2>
                <p className="text-sm text-foreground">{student.notes}</p>
              </div>
            )}
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
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">{documents.length} documents</p>
              <Button size="sm" onClick={openUpload}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Docs
              </Button>
            </div>

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
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Type</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">Uploaded</th>
                      <th className="text-left px-4 py-3 font-semibold text-foreground">File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc: any) => (
                      <tr key={doc.id} className="border-t hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3 font-medium">{doc.name}</td>
                        <td className="px-4 py-3 text-muted-foreground capitalize">{doc.type}</td>
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
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                              Download
                            </button>
                          )}
                          {doc.fileUrl && !doc.fileData && (
                            <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              View
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
                    <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — max 10 MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
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
        <p className="font-medium text-foreground">{value || "\u2014"}</p>
      </div>
    </div>
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
