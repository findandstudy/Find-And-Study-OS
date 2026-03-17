import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListStudents, useCreateStudent } from "@workspace/api-client-react";
import { useSeason } from "@/contexts/SeasonContext";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Search, Plus, FileText, FileUp, Sparkles, ChevronLeft,
  User, GraduationCap, X, CheckCircle2, AlertCircle,
  Users, Download, Eye, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
  graduated: "bg-blue-100 text-blue-700 border-blue-200",
  suspended: "bg-red-100 text-red-700 border-red-200",
};

const DOC_TYPES = [
  { key: "passport", label: "Passport", icon: "🛂", accept: "image/*,.pdf" },
  { key: "diploma", label: "Diploma", icon: "🎓", accept: "image/*,.pdf" },
  { key: "transcript", label: "Transcript", icon: "📋", accept: "image/*,.pdf" },
  { key: "photo", label: "Photo", icon: "📷", accept: "image/*" },
  { key: "other", label: "Other", icon: "📎", accept: "image/*,.pdf" },
];

type UploadedDoc = {
  key: string;
  label: string;
  file: File;
  base64: string;
  mediaType: string;
  isImage: boolean;
};

type ExtractedData = {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  passportNumber?: string | null;
  passportIssueDate?: string | null;
  passportExpiry?: string | null;
  motherName?: string | null;
  fatherName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  highSchool?: string | null;
  graduationYear?: number | null;
  gpa?: string | null;
  languageScore?: string | null;
  confidence?: string;
  extractedNotes?: string | null;
};

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "",
  nationality: "", dateOfBirth: "",
  passportNumber: "", passportIssueDate: "", passportExpiry: "",
  motherName: "", fatherName: "", address: "",
  highSchool: "", graduationYear: "", gpa: "", languageScore: "",
  notes: "",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File, maxWidth = 1600, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareDocumentBase64(file: File): Promise<{ base64: string; mediaType: string; isImage: boolean }> {
  const isImage = file.type.startsWith("image/");
  if (isImage) {
    const base64 = await compressImage(file);
    return { base64, mediaType: "image/jpeg", isImage: true };
  }
  const base64 = await fileToBase64(file);
  return { base64, mediaType: file.type || "application/pdf", isImage: false };
}

function DropZone({
  docType,
  uploaded,
  onUpload,
  onRemove,
}: {
  docType: (typeof DOC_TYPES)[0];
  uploaded?: UploadedDoc;
  onUpload: (doc: UploadedDoc) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    const { base64, mediaType, isImage } = await prepareDocumentBase64(file);
    onUpload({
      key: docType.key,
      label: docType.label,
      file,
      base64,
      mediaType,
      isImage,
    });
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    []
  );

  if (uploaded) {
    return (
      <div className="relative flex flex-col items-center gap-2 p-3 border-2 border-primary/30 bg-primary/5 rounded-2xl text-center min-h-[110px] justify-center">
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-2 right-2 w-5 h-5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-full flex items-center justify-center"
        >
          <X className="w-3 h-3" />
        </button>
        <CheckCircle2 className="w-6 h-6 text-green-500" />
        <div>
          <p className="text-xs font-semibold text-foreground truncate max-w-[80px]">{uploaded.file.name}</p>
          <p className="text-xs text-muted-foreground">{Math.round(uploaded.file.size / 1024)}KB</p>
        </div>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{docType.label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 p-3 border-2 border-dashed rounded-2xl text-center cursor-pointer min-h-[110px] justify-center transition-all",
        dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary/50"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <span className="text-2xl">{docType.icon}</span>
      <p className="text-xs font-semibold text-foreground">{docType.label}</p>
      <p className="text-xs text-muted-foreground">Drop or click</p>
      <input
        ref={inputRef}
        type="file"
        accept={docType.accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

function AiBadge() {
  return <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">AI ✓</span>;
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  aiExtracted,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  aiExtracted?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="font-semibold text-sm flex items-center">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
        {aiExtracted && <AiBadge />}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "rounded-xl",
          aiExtracted && "border-emerald-300 bg-emerald-50/40 focus-visible:ring-emerald-400"
        )}
      />
    </div>
  );
}

type Step = "upload" | "analyzing" | "review";

function AddStudentModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const createStudent = useCreateStudent();
  const { season } = useSeason();

  const { data: countriesResp } = useQuery({
    queryKey: ["all-countries-nationality"],
    queryFn: () => fetch(`${BASE_URL}/api/countries?limit=500`, { credentials: "include" }).then(r => r.json()),
  });
  const allCountries: Array<{ id: number; name: string; flagEmoji?: string | null }> = countriesResp?.data ?? [];

  const [step, setStep] = useState<Step>("upload");
  const [docs, setDocs] = useState<Record<string, UploadedDoc>>({});
  const [extractedFields, setExtractedFields] = useState<Set<string>>(new Set());
  const [form, setForm] = useState(EMPTY_FORM);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  function handleClose() {
    setStep("upload");
    setDocs({});
    setExtractedFields(new Set());
    setForm(EMPTY_FORM);
    setAnalysisError(null);
    onClose();
  }

  function field(name: keyof typeof EMPTY_FORM) {
    return (value: string) => setForm((f) => ({ ...f, [name]: value }));
  }

  async function analyzeDocuments() {
    const uploadedDocs = Object.values(docs);
    if (uploadedDocs.length === 0) {
      toast({ title: "Upload at least one document", variant: "destructive" });
      return;
    }

    setStep("analyzing");
    setAnalysisError(null);

    try {
      const docPayload = uploadedDocs.map((d) => ({
        type: d.isImage ? "image" : "pdf",
        data: d.base64,
        mediaType: d.mediaType,
        label: d.label,
      }));

      const res = await fetch(`${BASE_URL}/api/ai/extract-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documents: docPayload }),
      });

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error("Documents are too large even after compression. Please use smaller files (max ~10MB total).");
        }
        const err = await res.json().catch(() => ({ error: "AI extraction failed" }));
        throw new Error(err.error || "AI extraction failed");
      }

      const { extracted }: { extracted: ExtractedData } = await res.json();

      const newForm = { ...EMPTY_FORM };
      const newExtracted = new Set<string>();

      const mapping: [keyof typeof EMPTY_FORM, keyof ExtractedData][] = [
        ["firstName", "firstName"], ["lastName", "lastName"],
        ["email", "email"], ["phone", "phone"],
        ["nationality", "nationality"], ["dateOfBirth", "dateOfBirth"],
        ["passportNumber", "passportNumber"], ["passportIssueDate", "passportIssueDate"],
        ["passportExpiry", "passportExpiry"],
        ["motherName", "motherName"], ["fatherName", "fatherName"],
        ["address", "address"], ["highSchool", "highSchool"],
        ["gpa", "gpa"], ["languageScore", "languageScore"],
      ];

      for (const [fk, ek] of mapping) {
        const val = extracted[ek];
        if (val !== null && val !== undefined && val !== "") {
          (newForm as any)[fk] = String(val);
          newExtracted.add(fk);
        }
      }
      if (extracted.graduationYear != null) {
        newForm.graduationYear = String(extracted.graduationYear);
        newExtracted.add("graduationYear");
      }

      setForm(newForm);
      setExtractedFields(newExtracted);
      setStep("review");
    } catch (err: any) {
      setAnalysisError(err.message || "AI extraction failed");
      setStep("review");
    }
  }

  async function saveDocumentsForStudent(studentId: number, firstName: string, lastName: string) {
    const uploadedDocs = Object.values(docs);
    if (uploadedDocs.length === 0) return;

    const docTypeLabel: Record<string, string> = {
      passport: "Passport",
      diploma: "Diploma",
      transcript: "Transcript",
      photo: "Photo",
      other: "Other",
    };

    await Promise.allSettled(
      uploadedDocs.map((d) => {
        const label = docTypeLabel[d.label?.toLowerCase()] ?? d.label ?? "Document";
        const docName = `${firstName}-${lastName}-${label}`;
        return fetch(`${BASE_URL}/api/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: docName,
            type: d.label?.toLowerCase() ?? "other",
            status: "pending",
            studentId,
            fileData: d.base64,
            mimeType: d.mediaType,
            sizeBytes: d.file?.size ?? null,
          }),
        });
      })
    );
  }

  function handleSubmit() {
    if (!form.firstName || !form.lastName) {
      toast({ title: "First and Last name are required", variant: "destructive" });
      return;
    }

    createStudent.mutate(
      {
        data: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || null,
          phone: form.phone || null,
          nationality: form.nationality || null,
          dateOfBirth: form.dateOfBirth || null,
          passportNumber: form.passportNumber || null,
          passportIssueDate: form.passportIssueDate || null,
          passportExpiry: form.passportExpiry || null,
          motherName: form.motherName || null,
          fatherName: form.fatherName || null,
          address: form.address || null,
          highSchool: form.highSchool || null,
          graduationYear: form.graduationYear ? parseInt(form.graduationYear, 10) : null,
          gpa: form.gpa || null,
          languageScore: form.languageScore || null,
          notes: form.notes || null,
          status: "active",
          season,
        },
      },
      {
        onSuccess: async (createdStudent: any) => {
          const docCount = Object.keys(docs).length;
          if (docCount > 0) {
            await saveDocumentsForStudent(createdStudent.id, form.firstName, form.lastName);
            toast({ title: "Öğrenci oluşturuldu", description: `${docCount} belge profil'e eklendi.` });
          } else {
            toast({ title: "Student created successfully" });
          }
          handleClose();
          onSuccess();
        },
        onError: (err: any) => {
          toast({ title: "Failed to create student", description: err?.message, variant: "destructive" });
        },
      }
    );
  }

  const uploadedCount = Object.keys(docs).length;
  const stepProgress = step === "upload" ? 33 : step === "analyzing" ? 66 : 100;
  const ef = extractedFields;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && step !== "analyzing") handleClose(); }}>
      <DialogContent
        className="sm:max-w-2xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        onInteractOutside={(e) => { if (step === "analyzing") e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (step === "analyzing") e.preventDefault(); }}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-xl font-display">Add New Student</DialogTitle>
          <div className="mt-3 space-y-2">
            <Progress value={stepProgress} className="h-1.5" />
            <div className="flex items-center gap-6 text-xs font-medium">
              {[
                { id: "upload", label: "1. Upload Documents" },
                { id: "analyzing", label: "2. AI Analysis" },
                { id: "review", label: "3. Review & Save" },
              ].map((s) => (
                <span
                  key={s.id}
                  className={cn(step === s.id ? "text-primary" : "text-muted-foreground")}
                >
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === "upload" && (
            <div className="space-y-5">
              <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-2xl p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-violet-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">AI-Powered Form Filling</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload the student's documents below. AI will read them and automatically fill the form fields. You'll only need to complete anything missing.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-foreground mb-3">
                  Upload Documents <span className="text-muted-foreground font-normal">(optional but recommended)</span>
                </p>
                <div className="grid grid-cols-5 gap-3">
                  {DOC_TYPES.map((dt) => (
                    <DropZone
                      key={dt.key}
                      docType={dt}
                      uploaded={docs[dt.key]}
                      onUpload={(doc) => setDocs((d) => ({ ...d, [dt.key]: doc }))}
                      onRemove={() => setDocs((d) => { const n = { ...d }; delete n[dt.key]; return n; })}
                    />
                  ))}
                </div>
                {uploadedCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {uploadedCount} document{uploadedCount !== 1 ? "s" : ""} ready for AI analysis
                  </p>
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700">
                  No documents? Click <strong>"Skip to Form"</strong> to fill everything manually.
                </p>
              </div>
            </div>
          )}

          {step === "analyzing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-violet-500" />
                </div>
                <div className="absolute inset-0 rounded-full border-4 border-violet-200 animate-ping opacity-40" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-lg font-display font-semibold">AI is reading your documents…</p>
                <p className="text-sm text-muted-foreground">
                  Extracting information from {uploadedCount} document{uploadedCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {Object.values(docs).map((d) => (
                  <div key={d.key} className="flex items-center gap-2 text-sm bg-secondary/50 rounded-lg px-3 py-2">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                    <span className="text-sm text-muted-foreground">Analyzing {d.label}…</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              {ef.size > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700">
                    <strong>AI extracted {ef.size} field{ef.size !== 1 ? "s" : ""} automatically.</strong>{" "}
                    Fields marked <span className="bg-emerald-100 text-emerald-700 px-1 rounded font-semibold text-[10px]">AI ✓</span> were filled from documents. Review and complete any missing fields below.
                  </p>
                </div>
              )}

              {analysisError && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <p className="text-xs text-rose-700">
                    AI could not read the documents: {analysisError}. Please fill the form manually.
                  </p>
                </div>
              )}

              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                  <User className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Personal Information</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField required label="First Name" value={form.firstName} onChange={field("firstName")} placeholder="First name" aiExtracted={ef.has("firstName")} />
                  <FormField required label="Last Name" value={form.lastName} onChange={field("lastName")} placeholder="Last name" aiExtracted={ef.has("lastName")} />
                  <FormField label="Email" value={form.email} onChange={field("email")} placeholder="email@example.com" type="email" aiExtracted={ef.has("email")} />
                  <FormField label="Phone" value={form.phone} onChange={field("phone")} placeholder="+90 555 000 0000" aiExtracted={ef.has("phone")} />
                  <FormField label="Date of Birth" value={form.dateOfBirth} onChange={field("dateOfBirth")} type="date" aiExtracted={ef.has("dateOfBirth")} />
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">Nationality{ef.has("nationality") && <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">AI ✓</span>}</Label>
                    <Select value={form.nationality} onValueChange={field("nationality")}>
                      <SelectTrigger className="mt-1 h-9 text-sm">
                        <SelectValue placeholder="Ülke seçin…" />
                      </SelectTrigger>
                      <SelectContent>
                        {allCountries.map(c => (
                          <SelectItem key={c.id} value={c.name}>
                            {c.flagEmoji ? `${c.flagEmoji} ` : ""}{c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <FormField label="Mother's Name" value={form.motherName} onChange={field("motherName")} placeholder="Anne adı" aiExtracted={ef.has("motherName")} />
                  <FormField label="Father's Name" value={form.fatherName} onChange={field("fatherName")} placeholder="Baba adı" aiExtracted={ef.has("fatherName")} />
                  <div className="col-span-2">
                    <FormField label="Address" value={form.address} onChange={field("address")} placeholder="Full home address" aiExtracted={ef.has("address")} />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                  <span className="text-base leading-none">🛂</span>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Passport / Identity</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <FormField label="Passport Number" value={form.passportNumber} onChange={field("passportNumber")} placeholder="e.g. AB1234567" aiExtracted={ef.has("passportNumber")} />
                  </div>
                  <FormField label="Issue Date" value={form.passportIssueDate} onChange={field("passportIssueDate")} type="date" aiExtracted={ef.has("passportIssueDate")} />
                  <FormField label="Expiry Date" value={form.passportExpiry} onChange={field("passportExpiry")} type="date" aiExtracted={ef.has("passportExpiry")} />
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                  <GraduationCap className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Education</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <FormField label="High School" value={form.highSchool} onChange={field("highSchool")} placeholder="e.g. Ankara Fen Lisesi" aiExtracted={ef.has("highSchool")} />
                  </div>
                  <FormField label="Graduation Year" value={form.graduationYear} onChange={field("graduationYear")} placeholder="e.g. 2022" aiExtracted={ef.has("graduationYear")} />
                  <FormField label="GPA" value={form.gpa} onChange={field("gpa")} placeholder="e.g. 3.8 / 4.0" aiExtracted={ef.has("gpa")} />
                  <div className="col-span-2">
                    <FormField label="Language Score" value={form.languageScore} onChange={field("languageScore")} placeholder="e.g. IELTS 7.0, TOEFL 100" aiExtracted={ef.has("languageScore")} />
                  </div>
                </div>
              </section>

              <div className="space-y-1.5">
                <Label className="font-semibold text-sm">Notes</Label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Any additional notes about this student…"
                  rows={2}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-5 pt-3 border-t border-border/50 flex items-center justify-between shrink-0 gap-3">
          {step === "upload" && (
            <>
              <Button variant="ghost" onClick={handleClose} className="rounded-xl">Cancel</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep("review")} className="rounded-xl text-muted-foreground">
                  Skip to Form
                </Button>
                <Button
                  onClick={analyzeDocuments}
                  disabled={uploadedCount === 0}
                  className="rounded-xl gap-2 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white border-0"
                >
                  <Sparkles className="w-4 h-4" />
                  Analyze {uploadedCount > 0 ? `${uploadedCount} Doc${uploadedCount !== 1 ? "s" : ""}` : "Documents"}
                </Button>
              </div>
            </>
          )}

          {step === "analyzing" && (
            <div className="w-full flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          )}

          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")} className="rounded-xl gap-2">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createStudent.isPending || !form.firstName || !form.lastName}
                className="rounded-xl gap-2"
              >
                {createStudent.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Create Student
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const SAMPLE_CSV = `firstName,lastName,email,phone,nationality,dateOfBirth,passportNumber,motherName,fatherName
John,Doe,john@example.com,+1-555-0001,American,1998-05-15,US12345678,Mary Doe,James Doe
Jane,Smith,jane@example.com,+44-20-0002,British,2000-09-22,GB87654321,Sarah Smith,Robert Smith`;

function BulkImportModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void; }) {
  const { toast } = useToast();
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setCsvFile(null);
    setParsing(false);
    setPreview(null);
    setImporting(false);
    setResult(null);
    onClose();
  }

  async function parseCSV(file: File) {
    setParsing(true);
    setPreview(null);
    try {
      const text = await file.text();
      const res = await fetch(`${BASE_URL}/api/ai/extract-bulk-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ csvData: text }),
      });
      if (!res.ok) throw new Error("CSV parsing failed");
      const { students } = await res.json();
      setPreview(students);
    } catch (err: any) {
      toast({ title: "CSV parse failed", description: err.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  }

  async function importAll() {
    if (!preview) return;
    setImporting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/students/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ students: preview }),
      });
      if (!res.ok) throw new Error("Import failed");
      const data = await res.json();
      setResult({ success: data.success, errors: data.errors?.length || 0 });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-xl font-display flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Bulk Import Students
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {!result && (
            <>
              <div className="bg-gradient-to-br from-blue-50 to-violet-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">AI-powered CSV Import</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload any CSV with student data. AI will intelligently map column names regardless of format — no strict header requirements.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold">CSV File</p>
                  <button
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={() => {
                      const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "sample_students.csv";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="w-3 h-3" /> Download Sample
                  </button>
                </div>

                {!csvFile ? (
                  <div
                    className="border-2 border-dashed border-border hover:border-primary/50 rounded-2xl p-8 text-center cursor-pointer transition-colors hover:bg-secondary/30"
                    onClick={() => inputRef.current?.click()}
                  >
                    <FileUp className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-semibold text-foreground">Drop CSV file here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Accepts .csv files</p>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setCsvFile(f); parseCSV(f); }
                        e.target.value = "";
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl border border-border">
                    <FileText className="w-5 h-5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{csvFile.name}</p>
                      <p className="text-xs text-muted-foreground">{Math.round(csvFile.size / 1024)}KB</p>
                    </div>
                    <button
                      onClick={() => { setCsvFile(null); setPreview(null); }}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {parsing && (
                <div className="flex items-center gap-3 p-4 bg-violet-50 border border-violet-100 rounded-xl">
                  <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
                  <div>
                    <p className="text-sm font-semibold text-violet-700">AI is parsing your CSV…</p>
                    <p className="text-xs text-violet-600">Mapping columns and extracting student records</p>
                  </div>
                </div>
              )}

              {preview && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">
                      Preview — <span className="text-primary">{preview.length} students</span>
                    </p>
                    <span className="text-xs text-muted-foreground">Scroll to review all</span>
                  </div>
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="overflow-x-auto max-h-60">
                      <table className="w-full text-xs">
                        <thead className="bg-secondary/50 border-b border-border sticky top-0">
                          <tr>
                            {["#", "First Name", "Last Name", "Email", "Nationality", "DOB", "Passport", "Mother", "Father"].map((h) => (
                              <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {preview.map((s: any, i: number) => (
                            <tr key={i} className="hover:bg-secondary/20">
                              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                              <td className="px-3 py-2 font-medium">{s.firstName || "—"}</td>
                              <td className="px-3 py-2">{s.lastName || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{s.email || "—"}</td>
                              <td className="px-3 py-2">{s.nationality || "—"}</td>
                              <td className="px-3 py-2">{s.dateOfBirth || "—"}</td>
                              <td className="px-3 py-2 font-mono">{s.passportNumber || "—"}</td>
                              <td className="px-3 py-2">{s.motherName || "—"}</td>
                              <td className="px-3 py-2">{s.fatherName || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{result.success} Students Imported!</p>
                {result.errors > 0 && (
                  <p className="text-sm text-destructive mt-1">{result.errors} row{result.errors !== 1 ? "s" : ""} skipped (missing required fields)</p>
                )}
              </div>
              <Button onClick={handleClose} className="rounded-xl mt-2">Done</Button>
            </div>
          )}
        </div>

        {!result && (
          <div className="px-6 pb-5 pt-3 border-t border-border/50 flex items-center justify-between shrink-0">
            <Button variant="outline" onClick={handleClose} className="rounded-xl">Cancel</Button>
            <Button
              onClick={importAll}
              disabled={!preview || importing || preview.length === 0}
              className="rounded-xl gap-2"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Import {preview ? `${preview.length} Students` : "Students"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function StudentsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { season } = useSeason();
  const { data, isLoading } = useListStudents({ search, season } as any);
  const students = data?.data ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/students"] });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Students</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {data?.meta?.total ?? 0} total students
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search students…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>
            <Button
              variant="outline"
              className="rounded-xl gap-2 border-primary/30 text-primary hover:bg-primary/5"
              onClick={() => setBulkOpen(true)}
            >
              <FileUp className="w-4 h-4" /> Bulk Import
            </Button>
            <Button
              className="rounded-xl gap-2 shadow-md shadow-primary/20"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="w-4 h-4" /> Add Student
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 shadow-md shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-secondary/30">
                <TableRow>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide pl-6">Name</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Contact</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Nationality</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Passport</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Status</TableHead>
                  <TableHead className="font-semibold text-xs uppercase tracking-wide">Joined</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground text-sm">Loading students…</td>
                  </tr>
                )}
                {!isLoading && students.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm">
                      <div className="flex flex-col items-center gap-3">
                        <User className="w-12 h-12 text-muted-foreground/20" />
                        <div>
                          <p className="font-semibold text-foreground">No students yet</p>
                          <p className="text-muted-foreground text-xs mt-1">
                            Add a student or{" "}
                            <button onClick={() => setBulkOpen(true)} className="text-primary hover:underline font-medium">
                              bulk import from CSV
                            </button>
                          </p>
                        </div>
                        <Button size="sm" className="rounded-xl gap-1 mt-1" onClick={() => setAddOpen(true)}>
                          <Plus className="w-3.5 h-3.5" /> Add First Student
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
                {students.map((student: any) => (
                  <TableRow
                    key={student.id}
                    className="cursor-pointer hover:bg-secondary/20 transition-colors"
                    onClick={() => setLocation(`/staff/students/${student.id}`)}
                  >
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-primary">
                            {student.firstName[0]}{student.lastName[0]}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {student.firstName} {student.lastName}
                          </p>
                          {(student.motherName || student.fatherName) && (
                            <p className="text-xs text-muted-foreground">
                              {[student.motherName, student.fatherName].filter(Boolean).join(" / ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {student.email && <p className="text-xs text-foreground">{student.email}</p>}
                        {student.phone && <p className="text-xs text-muted-foreground">{student.phone}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{student.nationality || "—"}</TableCell>
                    <TableCell>
                      <div className="text-xs">
                        {student.passportNumber && <p className="font-mono text-foreground">{student.passportNumber}</p>}
                        {student.passportExpiry && <p className="text-muted-foreground">Exp: {student.passportExpiry}</p>}
                        {student.passportIssueDate && <p className="text-muted-foreground">Iss: {student.passportIssueDate}</p>}
                        {!student.passportNumber && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs border font-medium", STATUS_COLORS[student.status] || "bg-gray-100 text-gray-600 border-gray-200")}>
                        {student.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(student.createdAt).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary"
                        onClick={(e) => { e.stopPropagation(); setLocation(`/staff/students/${student.id}`); }}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={invalidate} />
      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} onSuccess={invalidate} />
    </DashboardLayout>
  );
}
