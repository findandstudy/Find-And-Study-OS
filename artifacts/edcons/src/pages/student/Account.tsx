import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  User, Globe, Shield, Save, Check, GraduationCap,
  Loader2, FileText, MapPin, Phone, Mail, Calendar, Camera,
  BookOpen, Languages, Award, Upload, FolderOpen, Download,
  CheckCircle2, X,
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { validateFileObj as validateFile, sanitizeFileName, ACCEPT_ATTRIBUTE, FILE_UPLOAD_HELP_TEXT } from "@/lib/fileUploadValidation";
import { StudentDocChecklist } from "@/components/StudentDocChecklist";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const DOC_TYPES = [
  { key: "passport", label: "Passport" },
  { key: "diploma", label: "Diploma" },
  { key: "transcript", label: "Transcript" },
  { key: "photo", label: "Photo" },
  { key: "language_certificate", label: "Language Certificate" },
  { key: "cv", label: "CV / Resume" },
  { key: "motivation_letter", label: "Motivation Letter" },
  { key: "recommendation", label: "Recommendation Letter" },
  { key: "other", label: "Other" },
];

const LANGUAGES = [
  { code: "en", label: "English",   country: "GB" },
  { code: "tr", label: "Türkçe",    country: "TR" },
  { code: "ar", label: "العربية",   country: "SA" },
  { code: "fr", label: "Français",  country: "FR" },
  { code: "ru", label: "Русский",   country: "RU" },
  { code: "fa", label: "فارسی",     country: "IR" },
  { code: "zh", label: "中文",       country: "CN" },
  { code: "hi", label: "हिन्दी",       country: "IN" },
  { code: "es", label: "Español",   country: "ES" },
  { code: "id", label: "Bahasa",    country: "ID" },
];

export default function StudentAccount() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emptyStudentForm = {
    nationality: "", dateOfBirth: "",
    passportNumber: "", passportIssueDate: "", passportExpiry: "",
    motherName: "", fatherName: "", address: "",
    highSchool: "", universityBachelor: "", universityMaster: "",
    graduationYear: "", gpa: "", languageScore: "",
  };
  const [studentForm, setStudentForm] = useState(emptyStudentForm);
  const [savingStudent, setSavingStudent] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName || "",
        lastName:  user.lastName  || "",
        phone:     (user as any).phone || "",
      });
    }
  }, [user]);

  const { data: studentProfile, isLoading: profileLoading } = useQuery<any>({
    queryKey: ["student-me"],
    enabled: !!user,
    queryFn: async () => {
      try {
        return await customFetch("/api/students/me");
      } catch {
        return null;
      }
    },
  });

  const { data: countriesResp } = useQuery({
    queryKey: ["all-countries-nationality"],
    queryFn: async () => customFetch("/api/countries?limit=500"),
    staleTime: 5 * 60_000,
  });
  const nationalityOptions = ((countriesResp as any)?.data ?? []).map((c: any) => ({
    value: c.name,
    label: c.name,
    icon: c.code ? <CountryFlag code={c.code} size="sm" /> : undefined,
  }));

  useEffect(() => {
    if (studentProfile) {
      setStudentForm({
        nationality: studentProfile.nationality || "",
        dateOfBirth: studentProfile.dateOfBirth || "",
        passportNumber: studentProfile.passportNumber || "",
        passportIssueDate: studentProfile.passportIssueDate || "",
        passportExpiry: studentProfile.passportExpiry || "",
        motherName: studentProfile.motherName || "",
        fatherName: studentProfile.fatherName || "",
        address: studentProfile.address || "",
        highSchool: studentProfile.highSchool || "",
        universityBachelor: studentProfile.universityBachelor || "",
        universityMaster: studentProfile.universityMaster || "",
        graduationYear: studentProfile.graduationYear ? String(studentProfile.graduationYear) : "",
        gpa: studentProfile.gpa || "",
        languageScore: studentProfile.languageScore || "",
      });
    }
  }, [studentProfile]);

  async function handleSaveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName:  form.lastName,
          phone:     form.phone || undefined,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated", description: "Your information has been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLang(code: string) {
    if (!user) return;
    setLang(code as any);
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: code }),
      });
    } catch {}
  }

  async function handleSaveStudentInfo() {
    if (!user) return;
    setSavingStudent(true);
    try {
      await customFetch("/api/students/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...studentForm,
          graduationYear: studentForm.graduationYear ? parseInt(studentForm.graduationYear, 10) : null,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["student-me"] });
      toast({ title: "Student info updated", description: "Your student record has been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingStudent(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5MB.", variant: "destructive" });
      return;
    }
    setUploadingAvatar(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `avatar-${user.id}-${Date.now()}.${file.name.split(".").pop()}`, size: file.size, contentType: file.type }),
      });
      const uploadRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadRes.ok) throw new Error("Failed to upload image");
      const avatarUrl = `/api/storage/objects/${objectPath.replace(/^\/objects\//, "")}`;
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Photo updated", description: "Your profile photo has been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || user?.email?.[0] || "?"}`.toUpperCase();

  return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">{t("studentAccount.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("studentAccount.subtitle")}</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="profile"     className="rounded-lg gap-2"><User className="w-4 h-4" /> Profile</TabsTrigger>
            <TabsTrigger value="student"     className="rounded-lg gap-2"><GraduationCap className="w-4 h-4" /> Student Info</TabsTrigger>
            <TabsTrigger value="documents"   className="rounded-lg gap-2"><FolderOpen className="w-4 h-4" /> Documents</TabsTrigger>
            <TabsTrigger value="language"    className="rounded-lg gap-2"><Globe className="w-4 h-4" /> Language</TabsTrigger>
            <TabsTrigger value="security"    className="rounded-lg gap-2"><Shield className="w-4 h-4" /> Security</TabsTrigger>
          </TabsList>

          {/* ── Profile ── */}
          <TabsContent value="profile" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Personal Information</h2>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <div className="flex items-center gap-5 mb-8 p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/10">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="relative w-20 h-20 rounded-2xl overflow-hidden shrink-0 group cursor-pointer"
                >
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg">
                      {initials}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                    {uploadingAvatar ? (
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                    ) : (
                      <Camera className="w-6 h-6 text-white" />
                    )}
                  </div>
                </button>
                <div>
                  <p className="font-display font-bold text-lg text-foreground">{user?.firstName} {user?.lastName}</p>
                  <p className="text-muted-foreground text-sm">{user?.email}</p>
                  <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs mt-2">Student</Badge>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label>First Name</Label>
                  <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") }))} className="rounded-xl uppercase" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name</Label>
                  <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") }))} className="rounded-xl uppercase" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</Label>
                  <Input type="email" value={user?.email || ""} disabled className="rounded-xl bg-secondary/40 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Email is managed by your login provider</p>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                  <PhoneInput value={form.phone} onChange={phone => setForm(f => ({ ...f, phone }))} />
                </div>
              </div>
              <Button onClick={handleSaveProfile} disabled={saving} className="mt-6 rounded-xl gap-2 px-8">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </Card>
          </TabsContent>

          {/* ── Student Info ── */}
          <TabsContent value="student" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Student Record</h2>
              {profileLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-secondary animate-pulse rounded-xl" />)}
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> Personal Details
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Nationality</Label>
                        <SearchableSelect
                          value={studentForm.nationality}
                          onValueChange={v => setStudentForm(f => ({ ...f, nationality: v }))}
                          options={nationalityOptions}
                          placeholder="Select country..."
                          className="rounded-xl"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Date of Birth</Label>
                        <Input type="date" value={studentForm.dateOfBirth} onChange={e => setStudentForm(f => ({ ...f, dateOfBirth: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Mother's Name</Label>
                        <Input value={studentForm.motherName} onChange={e => setStudentForm(f => ({ ...f, motherName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") }))} placeholder="Mother's full name" className="rounded-xl uppercase" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Father's Name</Label>
                        <Input value={studentForm.fatherName} onChange={e => setStudentForm(f => ({ ...f, fatherName: e.target.value.toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ\s'-]/g, "") }))} placeholder="Father's full name" className="rounded-xl uppercase" />
                      </div>
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Address</Label>
                        <Textarea value={studentForm.address} onChange={e => setStudentForm(f => ({ ...f, address: e.target.value }))} placeholder="Your full address" className="rounded-xl resize-none" rows={2} />
                      </div>
                    </div>
                  </div>

                  <hr className="border-border/40" />

                  <div>
                    <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Passport Information
                    </p>
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label>Passport Number</Label>
                        <Input value={studentForm.passportNumber} onChange={e => setStudentForm(f => ({ ...f, passportNumber: e.target.value }))} placeholder="Passport number" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Issue Date</Label>
                        <Input type="date" value={studentForm.passportIssueDate} onChange={e => setStudentForm(f => ({ ...f, passportIssueDate: e.target.value }))} className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Expiry Date</Label>
                        <Input type="date" value={studentForm.passportExpiry} onChange={e => setStudentForm(f => ({ ...f, passportExpiry: e.target.value }))} className="rounded-xl" />
                      </div>
                    </div>
                  </div>

                  <hr className="border-border/40" />

                  <div>
                    <p className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5" /> Education
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>High School</Label>
                        <Input value={studentForm.highSchool} onChange={e => setStudentForm(f => ({ ...f, highSchool: e.target.value }))} placeholder="High school name" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Graduation Year</Label>
                        <Input type="number" value={studentForm.graduationYear} onChange={e => setStudentForm(f => ({ ...f, graduationYear: e.target.value }))} placeholder="e.g. 2024" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>University (Bachelor)</Label>
                        <Input value={studentForm.universityBachelor} onChange={e => setStudentForm(f => ({ ...f, universityBachelor: e.target.value }))} placeholder="Bachelor's university (if any)" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>University (Master)</Label>
                        <Input value={studentForm.universityMaster} onChange={e => setStudentForm(f => ({ ...f, universityMaster: e.target.value }))} placeholder="Master's university (if any)" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> GPA</Label>
                        <Input value={studentForm.gpa} onChange={e => setStudentForm(f => ({ ...f, gpa: e.target.value }))} placeholder="e.g. 3.5/4.0" className="rounded-xl" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="flex items-center gap-1.5"><Languages className="w-3.5 h-3.5" /> Language Score</Label>
                        <Input value={studentForm.languageScore} onChange={e => setStudentForm(f => ({ ...f, languageScore: e.target.value }))} placeholder="e.g. IELTS 7.0, TOEFL 100" className="rounded-xl" />
                      </div>
                    </div>
                  </div>

                  <Button onClick={handleSaveStudentInfo} disabled={savingStudent} className="rounded-xl gap-2 px-8">
                    {savingStudent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Student Info
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Documents ── */}
          <TabsContent value="documents" className="mt-6">
            <StudentDocumentsTab user={user} studentProfile={studentProfile} />
          </TabsContent>

          {/* ── Language ── */}
          <TabsContent value="language" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Language Preference</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {LANGUAGES.map(l => (
                  <button key={l.code} onClick={() => handleSaveLang(l.code)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50
                      ${lang === l.code ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border hover:bg-secondary/30"}`}>
                    <CountryFlag code={l.country} size="xl" />
                    <div className="flex-1">
                      <p className="font-bold text-foreground">{l.label}</p>
                      <p className="text-xs text-muted-foreground">{l.code.toUpperCase()}</p>
                    </div>
                    {lang === l.code && <Check className="w-5 h-5 text-primary" />}
                  </button>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── Security ── */}
          <TabsContent value="security" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Security & Access</h2>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="font-bold text-blue-800 flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Secured Account
                  </p>
                  <p className="text-sm text-blue-700 mt-2">
                    Your account is secured through Replit's authentication system.
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-border/50 space-y-2">
                  <p className="font-semibold text-foreground">Account Details</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Role</span>
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">Student</Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Account ID</span>
                    <span className="font-mono text-foreground">#{user?.id}</span>
                  </div>
                </div>
                <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/5 hover:border-destructive/30" asChild>
                  <a href="/api/auth/logout">Sign Out</a>
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  );
}

function StudentDocumentsTab({ user, studentProfile }: { user: any; studentProfile: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState("passport");
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: applicationsResp } = useQuery<any>({
    queryKey: ["student-applications-for-checklist"],
    queryFn: async () => customFetch(`${BASE_URL}/api/applications`),
    staleTime: 30_000,
  });
  const studentApplications: any[] = useMemo(() => {
    const list = (applicationsResp as any)?.data || applicationsResp || [];
    return Array.isArray(list) ? list : [];
  }, [applicationsResp]);
  const activeApp = useMemo(() => {
    const withProg = studentApplications.filter(a => a && a.programId);
    if (withProg.length === 0) return null;
    const sorted = [...withProg].sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
    return sorted[0];
  }, [studentApplications]);

  const { data: documents = [], isLoading } = useQuery<any[]>({
    queryKey: ["student-documents"],
    enabled: !!user,
    queryFn: () => customFetch("/api/documents"),
  });

  function openUpload() {
    setUploadType("passport");
    setUploadFile(null);
    const first = (user?.firstName ?? "").toLowerCase();
    const last = (user?.lastName ?? "").toLowerCase();
    setUploadName(`passport-${first}-${last}`);
    setUploadOpen(true);
  }

  function handleFileSelect(file: File) {
    const validation = validateFile(file);
    if (!validation.valid) {
      toast({ title: "Dosya hatas\u0131", description: validation.message, variant: "destructive" });
      return;
    }
    const safeFile = new File([file], sanitizeFileName(file.name), { type: file.type });
    setUploadFile(safeFile);
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(uploadFile);
      });
      const type = (DOC_TYPES.find(d => d.key === uploadType)?.label ?? "document").toLowerCase();
      const first = (user?.firstName ?? "").toLowerCase();
      const last = (user?.lastName ?? "").toLowerCase();
      const docName = uploadName.trim() || `${type}-${first}-${last}`;

      await customFetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: docName,
          type: uploadType,
          studentId: studentProfile?.id || null,
          fileData: base64,
          mimeType: uploadFile.type,
          sizeBytes: uploadFile.size,
          originalFileName: uploadFile.name,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["student-documents"] });
      toast({ title: "Document uploaded" });
      setUploadOpen(false);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function buildDownloadFilename(type: string, firstName: string, lastName: string, mimeType: string) {
    const ext = mimeType.includes("pdf") ? "pdf" : mimeType.includes("png") ? "png" : "jpg";
    return `${type}-${firstName}-${lastName}.${ext}`.toLowerCase().replace(/\s+/g, "-");
  }

  return (
    <Card className="border-none shadow-lg shadow-black/5 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display font-bold text-lg">My Documents</h2>
          <p className="text-sm text-muted-foreground mt-1">{documents.length} document{documents.length !== 1 ? "s" : ""} uploaded</p>
        </div>
        <Button size="sm" onClick={openUpload} className="rounded-xl gap-2" disabled={!studentProfile?.id}>
          <Upload className="w-4 h-4" />
          Upload Document
        </Button>
      </div>

      {!studentProfile?.id && (
        <div className="p-4 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          Please complete your Student Info in the Student Info tab before uploading documents.
        </div>
      )}

      {studentProfile?.id && (
        <div className="mb-5">
          <StudentDocChecklist
            level={activeApp?.level ?? studentProfile.interestedLevel}
            documents={documents}
            compact={false}
            programId={activeApp?.programId ?? null}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-xl" />)}
        </div>
      ) : documents.length === 0 ? (
        <div
          className="p-16 text-center text-muted-foreground cursor-pointer hover:bg-secondary/30 transition-colors rounded-2xl border-2 border-dashed"
          onClick={openUpload}
        >
          <Upload className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No documents yet</p>
          <p className="text-xs mt-1">Upload your passport, diploma, transcript and other documents here</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border overflow-hidden">
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
                  <td className="px-4 py-3 text-muted-foreground capitalize">{doc.type?.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">
                    <Badge className={`capitalize text-xs px-2 py-0.5 border-0 rounded-full ${
                      doc.status === "approved" ? "bg-green-500/10 text-green-600" :
                      doc.status === "rejected" ? "bg-red-500/10 text-red-600" :
                      "bg-secondary text-secondary-foreground"
                    }`}>
                      {doc.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {(doc.fileData || doc.fileUrl) && (
                      <button
                        onClick={() => {
                          if (doc.fileUrl) {
                            window.open(doc.fileUrl, "_blank");
                          } else {
                            const mimeType = doc.mimeType || "application/octet-stream";
                            const filename = buildDownloadFilename(doc.type, user?.firstName ?? "", user?.lastName ?? "", mimeType);
                            const link = document.createElement("a");
                            link.href = `data:${mimeType};base64,${doc.fileData}`;
                            link.download = filename;
                            link.click();
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {doc.fileUrl ? "Open" : "Download"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                const first = (user?.firstName ?? "").toLowerCase();
                const last = (user?.lastName ?? "").toLowerCase();
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
                placeholder={`passport-${(user?.firstName ?? "").toLowerCase()}-${(user?.lastName ?? "").toLowerCase()}`}
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
                    <p className="text-xs text-muted-foreground mt-1">{FILE_UPLOAD_HELP_TEXT}</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTRIBUTE}
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
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
