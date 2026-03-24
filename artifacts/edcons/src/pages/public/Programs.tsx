import { useState, useEffect, useCallback, useRef } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { customFetch } from "@workspace/api-client-react";
import {
  Search, MapPin, BookOpen, GraduationCap, Globe2, Clock, DollarSign,
  Languages, ChevronLeft, ChevronRight, Upload, X, CheckCircle2, Loader2, Sparkles,
  SlidersHorizontal, Building2, Award, ChevronDown, ChevronUp, Info, ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface Program {
  id: number;
  name: string;
  degree: string | null;
  field: string | null;
  language: string | null;
  duration: string | null;
  tuitionFee: number | null;
  currency: string | null;
  discountedFee: number | null;
  scholarship: number | null;
  intakes: string | null;
  requirements: string | null;
  applicationFee: number | null;
  advancedFee: number | null;
  depositFee: number | null;
  languageFee: number | null;
  feeType: string | null;
  universityName: string;
  universityCountry: string | null;
  universityType: string | null;
  universityCity: string | null;
  universityLogoUrl: string | null;
  universityWebsite: string | null;
  universityDescription: string | null;
  universityRanking: string | null;
  universityQsRanking: string | null;
  universityTimesRanking: string | null;
  universityAddress: string | null;
}

interface Filters {
  countries: string[];
  cities: string[];
  universityTypes: string[];
  universities: { id: number; name: string }[];
  degrees: string[];
  languages: string[];
  fields: string[];
  feeRange: { min: number; max: number } | null;
}

function formatFee(fee: number | null, currency: string | null): string {
  if (!fee) return "";
  const cur = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(fee);
  } catch {
    return `${fee} ${cur}`;
  }
}

function fixStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let fixed = url.replace(/\/api\/storage\/objects\/objects\//, "/api/storage/objects/");
  if (!fixed.startsWith("http") && !fixed.startsWith(BASE_URL)) {
    fixed = `${BASE_URL}${fixed.startsWith("/") ? "" : "/"}${fixed}`;
  }
  return fixed;
}

type DocKey = "passport" | "diploma" | "transcript" | "photo";

const DOC_TYPES: Array<{ key: DocKey; label: string; icon: string; accept: string; required: boolean }> = [
  { key: "passport", label: "Passport", icon: "🛂", accept: "image/*,.pdf", required: true },
  { key: "diploma", label: "Diploma", icon: "🎓", accept: "image/*,.pdf", required: false },
  { key: "transcript", label: "Transcript", icon: "📋", accept: "image/*,.pdf", required: false },
  { key: "photo", label: "Photo", icon: "📷", accept: "image/*", required: false },
];

type UploadedDoc = { key: string; label: string; file: File; base64: string; mediaType: string; isImage: boolean };

function compressImage(file: File, maxWidth = 1600, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function prepareDoc(file: File): Promise<{ base64: string; mediaType: string; isImage: boolean }> {
  if (file.type.startsWith("image/")) {
    return { base64: await compressImage(file), mediaType: "image/jpeg", isImage: true };
  }
  return { base64: await fileToBase64(file), mediaType: file.type || "application/pdf", isImage: false };
}

function DropZone({ docType, uploaded, onUpload, onRemove }: {
  docType: typeof DOC_TYPES[0]; uploaded?: UploadedDoc; onUpload: (d: UploadedDoc) => void; onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    const { base64, mediaType, isImage } = await prepareDoc(file);
    onUpload({ key: docType.key, label: docType.label, file, base64, mediaType, isImage });
  }

  if (uploaded) {
    return (
      <div className="relative flex flex-col items-center gap-1.5 p-3 border-2 border-green-300 bg-green-50 dark:bg-green-950/30 rounded-2xl text-center min-h-[100px] justify-center">
        <button type="button" onClick={onRemove} className="absolute top-2 right-2 w-5 h-5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-full flex items-center justify-center">
          <X className="w-3 h-3" />
        </button>
        <CheckCircle2 className="w-5 h-5 text-green-500" />
        <p className="text-xs font-semibold text-foreground truncate max-w-[90px]">{uploaded.file.name}</p>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{docType.label}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center gap-1.5 p-3 border-2 border-dashed rounded-2xl text-center cursor-pointer min-h-[100px] justify-center transition-all
        ${dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary/50"}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      <span className="text-2xl">{docType.icon}</span>
      <p className="text-xs font-semibold text-foreground">{docType.label}</p>
      {docType.required && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full font-semibold">Required</span>}
      <input ref={inputRef} type="file" accept={docType.accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

function AiBadge() {
  return <span className="ml-1.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-1.5 py-0.5 rounded-full font-medium">AI</span>;
}

type ApplyStep = "upload" | "analyzing" | "form" | "success";

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "", phoneCode: "+90",
  nationality: "", dateOfBirth: "", notes: "",
  motherName: "", fatherName: "",
};

function ApplyDialog({ open, onClose, program, countries }: { open: boolean; onClose: () => void; program: Program | null; countries: string[] }) {
  const { toast } = useToast();
  const [step, setStep] = useState<ApplyStep>("upload");
  const [docs, setDocs] = useState<Record<string, UploadedDoc>>({});
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [extracted, setExtracted] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setDocs({});
    setForm({ ...EMPTY_FORM });
    setExtracted(new Set());
    setSubmitting(false);
    setAiError(null);
    onClose();
  }

  async function analyzeDocuments() {
    const uploadedDocs = Object.values(docs);
    if (uploadedDocs.length === 0) {
      toast({ title: "Please upload at least one document", variant: "destructive" });
      return;
    }

    setStep("analyzing");
    setAiError(null);

    try {
      const docPayload = uploadedDocs.map((d) => ({
        type: d.isImage ? "image" as const : "pdf" as const,
        data: d.base64,
        mediaType: d.mediaType,
        label: d.label,
      }));

      const resp = await fetch(`${BASE_URL}/api/public/ai/extract-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents: docPayload }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "AI extraction failed" }));
        throw new Error(err.error || "AI extraction failed");
      }

      const { extracted: data } = await resp.json();
      const newForm = { ...EMPTY_FORM };
      const newExtracted = new Set<string>();

      const mapping: [keyof typeof EMPTY_FORM, string][] = [
        ["firstName", "firstName"], ["lastName", "lastName"],
        ["email", "email"], ["phone", "phone"],
        ["nationality", "nationality"], ["dateOfBirth", "dateOfBirth"],
        ["motherName", "motherName"], ["fatherName", "fatherName"],
      ];

      for (const [fk, ek] of mapping) {
        const val = data[ek];
        if (val != null && val !== "") {
          (newForm as any)[fk] = String(val);
          newExtracted.add(fk);
        }
      }

      setForm(newForm);
      setExtracted(newExtracted);
      setStep("form");
    } catch (err: any) {
      setAiError(err.message || "AI extraction failed");
      setStep("form");
    }
  }

  async function handleSubmit() {
    if (!form.firstName || !form.lastName || !form.email || !form.phone || !form.motherName || !form.fatherName || !form.nationality) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/public/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          programId: program?.id,
          programName: program?.name,
          universityName: program?.universityName,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Submission failed" }));
        toast({ title: err.error || "Failed to submit application", variant: "destructive" });
        return;
      }

      setStep("success");
    } catch {
      toast({ title: "Failed to submit application", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (!program) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <GraduationCap className="w-5 h-5 text-primary" />
            Apply — {program.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{program.universityName}</p>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-5">
            <div className="bg-primary/5 rounded-xl p-4 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">AI-Powered Document Analysis</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload your documents and our AI will automatically extract your information. You can review and edit before submitting.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {DOC_TYPES.map((dt) => (
                <DropZone
                  key={dt.key}
                  docType={dt}
                  uploaded={docs[dt.key]}
                  onUpload={(d) => setDocs((prev) => ({ ...prev, [dt.key]: d }))}
                  onRemove={() => setDocs((prev) => { const n = { ...prev }; delete n[dt.key]; return n; })}
                />
              ))}
            </div>

            <div className="flex gap-3">
              <Button onClick={analyzeDocuments} className="flex-1 rounded-xl gap-2" disabled={Object.keys(docs).length === 0}>
                <Sparkles className="w-4 h-4" /> Analyze with AI & Continue
              </Button>
              <Button variant="ghost" onClick={() => { setStep("form"); }} className="rounded-xl">
                Skip, fill manually
              </Button>
            </div>
          </div>
        )}

        {step === "analyzing" && (
          <div className="flex flex-col items-center py-12 gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <Loader2 className="absolute -top-1 -right-1 w-6 h-6 text-primary animate-spin" />
            </div>
            <h3 className="font-semibold text-foreground">AI is analyzing your documents...</h3>
            <p className="text-sm text-muted-foreground">This usually takes a few seconds</p>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center py-8 gap-5 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="font-display font-bold text-xl text-foreground mb-2">Application Submitted!</h3>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                Your application has been received. We have sent your login details and email verification instructions to your email address.
              </p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 w-full text-left">
              <p className="text-sm font-semibold text-foreground mb-2">What happens next?</p>
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">1.</span> Check your email for account setup instructions</li>
                <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">2.</span> Set your password to activate your account</li>
                <li className="flex items-start gap-2"><span className="text-primary font-bold mt-0.5">3.</span> Log in to track your application progress</li>
              </ul>
            </div>
            <div className="flex gap-3 w-full">
              <Button variant="outline" onClick={reset} className="flex-1 rounded-xl">
                Close
              </Button>
              <Button onClick={() => { reset(); window.location.href = "/login"; }} className="flex-1 rounded-xl gap-2">
                Go to Login
              </Button>
            </div>
          </div>
        )}

        {step === "form" && (
          <div className="space-y-4">
            {aiError && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-300">
                {aiError}. Please fill in the form manually.
              </div>
            )}
            {extracted.size > 0 && !aiError && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                AI extracted {extracted.size} fields. Please review and complete the form.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  First Name <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("firstName") && <AiBadge />}
                </Label>
                <Input value={form.firstName} onChange={(e) => setForm(f => ({ ...f, firstName: e.target.value }))}
                  placeholder="First name" className={`rounded-xl ${extracted.has("firstName") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  Last Name <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("lastName") && <AiBadge />}
                </Label>
                <Input value={form.lastName} onChange={(e) => setForm(f => ({ ...f, lastName: e.target.value }))}
                  placeholder="Last name" className={`rounded-xl ${extracted.has("lastName") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  Mother Name <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("motherName") && <AiBadge />}
                </Label>
                <Input value={form.motherName} onChange={(e) => setForm(f => ({ ...f, motherName: e.target.value }))}
                  placeholder="Mother's full name" className={`rounded-xl ${extracted.has("motherName") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  Father Name <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("fatherName") && <AiBadge />}
                </Label>
                <Input value={form.fatherName} onChange={(e) => setForm(f => ({ ...f, fatherName: e.target.value }))}
                  placeholder="Father's full name" className={`rounded-xl ${extracted.has("fatherName") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold flex items-center">
                Email <span className="text-destructive ml-0.5">*</span>
                {extracted.has("email") && <AiBadge />}
              </Label>
              <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@example.com" className={`rounded-xl ${extracted.has("email") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  Phone <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("phone") && <AiBadge />}
                </Label>
                <div className="flex gap-1.5">
                  <Input value={form.phoneCode} onChange={(e) => setForm(f => ({ ...f, phoneCode: e.target.value }))}
                    placeholder="+90" className="rounded-xl w-20" />
                  <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="Phone number" className={`rounded-xl flex-1 ${extracted.has("phone") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold flex items-center">
                  Nationality <span className="text-destructive ml-0.5">*</span>
                  {extracted.has("nationality") && <AiBadge />}
                </Label>
                <select value={form.nationality} onChange={(e) => setForm(f => ({ ...f, nationality: e.target.value }))}
                  className={`w-full h-10 rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${extracted.has("nationality") ? "border-emerald-300 bg-emerald-50/40" : ""}`}>
                  <option value="">Select nationality</option>
                  {countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Additional Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional information..." className="rounded-xl resize-none" rows={3} />
            </div>

            <div className="bg-secondary/50 rounded-xl p-3 text-sm">
              <p className="font-medium text-foreground mb-1">Applying for:</p>
              <p className="text-muted-foreground">{program.name} — {program.universityName}</p>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => setStep("upload")} variant="outline" className="rounded-xl">
                Back
              </Button>
              <Button onClick={handleSubmit} className="flex-1 rounded-xl gap-2" disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Submit Application
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProgramDetailDialog({ open, onClose, program }: { open: boolean; onClose: () => void; program: Program | null }) {
  if (!program) return null;
  const effectiveFee = program.discountedFee ?? program.tuitionFee;
  const hasDiscount = program.discountedFee && program.tuitionFee && program.discountedFee < program.tuitionFee;
  const logoSrc = fixStorageUrl(program.universityLogoUrl);

  const programInfoRows: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (program.degree) programInfoRows.push({ icon: <GraduationCap className="w-4 h-4" />, label: "Degree", value: program.degree });
  if (program.field) programInfoRows.push({ icon: <Award className="w-4 h-4" />, label: "Field", value: program.field });
  if (program.language) programInfoRows.push({ icon: <Languages className="w-4 h-4" />, label: "Language", value: program.language });
  if (program.duration) programInfoRows.push({ icon: <Clock className="w-4 h-4" />, label: "Duration", value: program.duration });
  if (program.intakes) programInfoRows.push({ icon: <BookOpen className="w-4 h-4" />, label: "Intakes", value: program.intakes });
  if (program.feeType) programInfoRows.push({ icon: <DollarSign className="w-4 h-4" />, label: "Fee Type", value: program.feeType });

  const feeRows: { label: string; value: string }[] = [];
  if (program.applicationFee) feeRows.push({ label: "Application Fee", value: formatFee(program.applicationFee, program.currency) });
  if (program.depositFee) feeRows.push({ label: "Deposit Fee", value: formatFee(program.depositFee, program.currency) });
  if (program.advancedFee) feeRows.push({ label: "Advanced Fee", value: formatFee(program.advancedFee, program.currency) });
  if (program.languageFee) feeRows.push({ label: "Language Fee", value: formatFee(program.languageFee, program.currency) });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="relative bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5 px-6 pt-6 pb-5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.5),transparent_70%)]" />
          <DialogHeader className="relative z-10">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white dark:bg-card shadow-lg shadow-primary/10 flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-white/80 dark:ring-border/50">
                {logoSrc ? (
                  <img src={logoSrc} alt={program.universityName} className="w-10 h-10 object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }} />
                ) : null}
                <GraduationCap className={`w-7 h-7 text-primary ${logoSrc ? "hidden" : ""}`} />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <DialogTitle className="text-lg font-display font-bold leading-tight text-foreground">{program.name}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1 font-medium">{program.universityName}</p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                  <MapPin className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                  <span>{[program.universityCity, program.universityCountry].filter(Boolean).join(", ")}</span>
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 space-y-5">
          {(effectiveFee || (program.scholarship && program.scholarship > 0)) && (
            <div className="rounded-2xl overflow-hidden border border-emerald-200/50 dark:border-emerald-800/30">
              {effectiveFee ? (
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20 px-5 py-4">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-3xl font-display font-bold text-emerald-700 dark:text-emerald-400">{formatFee(effectiveFee, program.currency)}</span>
                    {hasDiscount && (
                      <span className="text-base line-through text-muted-foreground/40 font-medium">{formatFee(program.tuitionFee, program.currency)}</span>
                    )}
                    {hasDiscount && (
                      <span className="text-[11px] font-bold text-white bg-emerald-500 rounded-full px-2.5 py-0.5 shadow-sm">
                        {Math.round(((program.tuitionFee! - program.discountedFee!) / program.tuitionFee!) * 100)}% OFF
                      </span>
                    )}
                  </div>
                  {program.feeType && (
                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-1 font-medium">{program.feeType}</p>
                  )}
                </div>
              ) : null}
              {program.scholarship && program.scholarship > 0 ? (
                <div className="bg-emerald-500/5 px-5 py-3 border-t border-emerald-200/30 dark:border-emerald-800/20 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Scholarship</p>
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatFee(program.scholarship, program.currency)}</p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {programInfoRows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded-full bg-primary" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Program Details</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {programInfoRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 rounded-xl px-3.5 py-3 bg-secondary/40 dark:bg-secondary/20 border border-border/20">
                    <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 text-primary/70">
                      {row.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold leading-none mb-0.5">{row.label}</p>
                      <p className="text-sm font-semibold text-foreground truncate">{row.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feeRows.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded-full bg-amber-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Additional Fees</h4>
              </div>
              <div className="rounded-xl border border-border/30 overflow-hidden divide-y divide-border/20">
                {feeRows.map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between px-4 py-2.5 bg-secondary/20 dark:bg-secondary/10">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <span className="text-sm font-bold text-foreground">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {program.requirements && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded-full bg-violet-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Requirements</h4>
              </div>
              <div className="bg-violet-50/50 dark:bg-violet-950/20 rounded-xl p-4 border border-violet-200/30 dark:border-violet-800/20">
                <p className="text-sm text-foreground/80 whitespace-pre-line leading-relaxed">{program.requirements}</p>
              </div>
            </div>
          )}

          {(program.universityDescription || program.universityRanking || program.universityQsRanking || program.universityTimesRanking) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-4 rounded-full bg-sky-500" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">About {program.universityName}</h4>
              </div>
              <div className="bg-sky-50/50 dark:bg-sky-950/20 rounded-xl p-4 border border-sky-200/30 dark:border-sky-800/20 space-y-3">
                {program.universityDescription && (
                  <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4">{program.universityDescription}</p>
                )}
                {(program.universityRanking || program.universityQsRanking || program.universityTimesRanking) && (
                  <div className="flex flex-wrap gap-1.5">
                    {program.universityRanking && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white/80 dark:bg-card/50 text-sky-700 dark:text-sky-300 rounded-lg px-2.5 py-1 border border-sky-200/40 dark:border-sky-800/30">
                        <Award className="w-3 h-3" /> #{program.universityRanking}
                      </span>
                    )}
                    {program.universityQsRanking && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white/80 dark:bg-card/50 text-sky-700 dark:text-sky-300 rounded-lg px-2.5 py-1 border border-sky-200/40 dark:border-sky-800/30">
                        QS #{program.universityQsRanking}
                      </span>
                    )}
                    {program.universityTimesRanking && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white/80 dark:bg-card/50 text-sky-700 dark:text-sky-300 rounded-lg px-2.5 py-1 border border-sky-200/40 dark:border-sky-800/30">
                        Times #{program.universityTimesRanking}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {program.universityWebsite && (
            <a href={program.universityWebsite} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full text-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/30 rounded-xl px-4 py-2.5 transition-all duration-200">
              <ExternalLink className="w-4 h-4" /> Visit University Website
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Programs() {
  const { t, lang } = useI18n();
  useSeo({ title: t("seo.programsTitle"), description: t("seo.programsDesc"), lang });
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [universityType, setUniversityType] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [level, setLevel] = useState("");
  const [language, setLanguage] = useState("");
  const [field, setField] = useState("");
  const [feeMin, setFeeMin] = useState("");
  const [feeMax, setFeeMax] = useState("");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ countries: [], cities: [], universityTypes: [], universities: [], degrees: [], languages: [], fields: [], feeRange: null });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);
  const [detailProgram, setDetailProgram] = useState<Program | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    customFetch<Filters>("/api/course-finder/filters", { method: "GET" })
      .then(data => setFilters(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setCity("");
  }, [country]);

  const debouncedFeeMin = useDebounce(feeMin, 500);
  const debouncedFeeMax = useDebounce(feeMax, 500);

  const fetchPrograms = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (country) params.set("country", country);
      if (city) params.set("city", city);
      if (universityType) params.set("universityType", universityType);
      if (universityId) params.set("universityId", universityId);
      if (level) params.set("level", level);
      if (language) params.set("language", language);
      if (field) params.set("field", field);
      if (debouncedFeeMin) params.set("feeMin", debouncedFeeMin);
      if (debouncedFeeMax) params.set("feeMax", debouncedFeeMax);

      const resp = await customFetch<{ data: Program[]; meta: { total: number; page: number; totalPages: number } }>(
        `/api/course-finder?${params.toString()}`,
        { method: "GET" }
      );
      setPrograms(resp.data || []);
      setTotal(resp.meta?.total || 0);
      setTotalPages(resp.meta?.totalPages || 1);
    } catch {
      setPrograms([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, country, city, universityType, universityId, level, language, field, debouncedFeeMin, debouncedFeeMax]);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);
  useEffect(() => { setPage(1); }, [debouncedSearch, country, city, universityType, universityId, level, language, field, debouncedFeeMin, debouncedFeeMax]);

  const filteredCities = filters.cities;

  const hasActiveFilters = country || city || universityType || universityId || level || language || field || feeMin || feeMax;

  function clearAllFilters() {
    setCountry("");
    setCity("");
    setUniversityType("");
    setUniversityId("");
    setLevel("");
    setLanguage("");
    setField("");
    setFeeMin("");
    setFeeMax("");
    setSearch("");
  }

  const activeFilterCount = [country, city, universityType, universityId, level, language, field, feeMin, feeMax].filter(Boolean).length;

  const pageNumbers = (() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  })();

  return (
    <PublicLayout>
      <section className="pt-24 pb-6 bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/[0.07] via-transparent to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="text-center mb-10">
              <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6 border border-primary/20">
                <GraduationCap className="w-4 h-4" /> {t("programs.badge")}
              </span>
              <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
                {t("programs.title")} <span className="text-primary">{t("programs.titleHighlight")}</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("programs.subtitle")}
              </p>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}>
            <div className="glass-card rounded-2xl p-6 pb-6 -mb-8 relative z-20 shadow-lg shadow-primary/[0.03]">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-primary/60" />
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={t("programs.searchPlaceholder")}
                    className="pl-12 pr-4 h-12 text-base rounded-xl border-border/50 focus:border-primary bg-background/80 backdrop-blur-sm shadow-sm w-full" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters(prev => !prev)}
                  aria-expanded={showFilters}
                  aria-controls="programs-filter-panel"
                  aria-label={showFilters ? t("programs.lessFilters") : t("programs.moreFilters")}
                  className={`inline-flex items-center gap-2 h-12 px-5 rounded-xl text-sm font-semibold transition-all duration-200 border shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                    ${showFilters
                      ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 hover:bg-primary/90"
                      : "bg-background/80 text-foreground border-border/50 hover:border-primary/40 hover:bg-primary/5 shadow-sm"
                    }`}
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">{showFilters ? t("programs.lessFilters") : t("programs.moreFilters")}</span>
                  {activeFilterCount > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold
                      ${showFilters ? "bg-white/25 text-primary-foreground" : "bg-primary text-primary-foreground"}`}>
                      {activeFilterCount}
                    </span>
                  )}
                  {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {showFilters && (
                  <motion.div
                    key="filter-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div id="programs-filter-panel" className="pt-5 space-y-4">
                      <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Globe2 className="w-3 h-3" /> {t("programs.filterCountry")}
                          </label>
                          <select value={country} onChange={e => setCountry(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allCountries")}</option>
                            {filters.countries.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <MapPin className="w-3 h-3" /> {t("programs.filterCity")}
                          </label>
                          <select value={city} onChange={e => setCity(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allCities")}</option>
                            {filteredCities.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Building2 className="w-3 h-3" /> {t("programs.filterUniversityType")}
                          </label>
                          <select value={universityType} onChange={e => setUniversityType(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allTypes")}</option>
                            {filters.universityTypes.map(ut => <option key={ut} value={ut}>{ut}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <GraduationCap className="w-3 h-3" /> {t("programs.filterUniversity")}
                          </label>
                          <select value={universityId} onChange={e => setUniversityId(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allUniversities")}</option>
                            {filters.universities.map(u => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <BookOpen className="w-3 h-3" /> {t("programs.filterLevel")}
                          </label>
                          <select value={level} onChange={e => setLevel(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allLevels")}</option>
                            {filters.degrees.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Languages className="w-3 h-3" /> {t("programs.filterLanguage")}
                          </label>
                          <select value={language} onChange={e => setLanguage(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allLanguages")}</option>
                            {filters.languages.map(lg => <option key={lg} value={lg}>{lg}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <Award className="w-3 h-3" /> {t("programs.filterField")}
                          </label>
                          <select value={field} onChange={e => setField(e.target.value)}
                            className="w-full h-10 px-3 rounded-xl border border-border/50 bg-background/80 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer hover:border-primary/40 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8">
                            <option value="">{t("programs.allFields")}</option>
                            {filters.fields.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <DollarSign className="w-3 h-3" /> {t("programs.filterTuitionFee")}
                          </label>
                          <div className="flex items-center gap-2">
                            <Input type="number" value={feeMin} onChange={e => setFeeMin(e.target.value)}
                              placeholder={filters.feeRange?.min != null ? `Min (${filters.feeRange.min})` : t("programs.feeMin")}
                              className="h-10 rounded-xl border-border/50 bg-background/80 text-sm flex-1 hover:border-primary/40 transition-all" min="0"
                              max={filters.feeRange?.max} />
                            <span className="text-muted-foreground text-sm font-medium">–</span>
                            <Input type="number" value={feeMax} onChange={e => setFeeMax(e.target.value)}
                              placeholder={filters.feeRange?.max != null ? `Max (${filters.feeRange.max})` : t("programs.feeMax")}
                              className="h-10 rounded-xl border-border/50 bg-background/80 text-sm flex-1 hover:border-primary/40 transition-all" min="0"
                              max={filters.feeRange?.max} />
                          </div>
                        </div>
                      </div>

                      {hasActiveFilters && (
                        <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/30">
                          <div className="flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-primary" />
                            <p className="text-sm text-muted-foreground">
                              {t("programs.showingResults", { count: String(total) })}
                            </p>
                          </div>
                          <button onClick={clearAllFilters} className="inline-flex items-center gap-1.5 text-sm text-destructive/80 hover:text-destructive font-semibold transition-colors bg-destructive/5 hover:bg-destructive/10 px-3 py-1.5 rounded-lg">
                            <X className="w-3.5 h-3.5" /> {t("programs.clearFilters")}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="pt-20 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
            className="flex items-center justify-between mb-8 bg-card/60 backdrop-blur-sm rounded-2xl px-6 py-4 border border-border/30 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-primary" />
              </div>
              <p className="text-muted-foreground">
                Showing <span className="font-bold text-foreground">{total}</span> programs
              </p>
            </div>
          </motion.div>

          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-border/30 bg-card">
                  <div className="h-20 bg-gradient-to-r from-secondary via-secondary/50 to-secondary animate-pulse relative overflow-hidden">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="h-5 bg-secondary rounded-lg w-4/5 animate-pulse" />
                    <div className="h-4 bg-secondary rounded-lg w-3/5 animate-pulse" />
                    <div className="grid grid-cols-2 gap-2 mt-4">
                      <div className="h-4 bg-secondary rounded-lg animate-pulse" />
                      <div className="h-4 bg-secondary rounded-lg animate-pulse" />
                    </div>
                    <div className="h-10 bg-secondary rounded-xl mt-4 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : programs.length === 0 ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="text-center py-24 bg-gradient-to-br from-primary/[0.03] via-accent/[0.03] to-primary/[0.03] rounded-3xl border border-border/30">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Globe2 className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-xl font-bold font-display text-foreground mb-2">{t("programs.noResults")}</h3>
              <p className="text-muted-foreground mb-6">{t("programs.noResultsDesc")}</p>
              <Button variant="outline" onClick={clearAllFilters} className="rounded-full px-6">
                <X className="w-4 h-4 mr-2" /> {t("programs.clearFilters")}
              </Button>
            </motion.div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {programs.map((prog, i) => {
                  const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
                  const hasDiscount = prog.discountedFee && prog.tuitionFee && prog.discountedFee < prog.tuitionFee;
                  const logoSrc = fixStorageUrl(prog.universityLogoUrl);
                  const cardGradients = [
                    "from-blue-500/15 via-indigo-500/10 to-violet-500/5",
                    "from-emerald-500/15 via-teal-500/10 to-cyan-500/5",
                    "from-rose-500/15 via-pink-500/10 to-fuchsia-500/5",
                    "from-amber-500/15 via-orange-500/10 to-yellow-500/5",
                    "from-violet-500/15 via-purple-500/10 to-indigo-500/5",
                    "from-cyan-500/15 via-sky-500/10 to-blue-500/5",
                  ];
                  const gradient = cardGradients[i % cardGradients.length];

                  return (
                    <motion.div key={prog.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04, duration: 0.4 }}
                      className="group bg-card rounded-2xl overflow-hidden shadow-md shadow-black/[0.04] hover:-translate-y-1.5 hover:shadow-xl hover:shadow-primary/[0.08] transition-all duration-300 border border-border/40 hover:border-primary/20 flex flex-col">
                      <div className={`h-20 bg-gradient-to-r ${gradient} relative flex items-center px-5 gap-3`}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.4),transparent_70%)]" />
                        {prog.universityWebsite ? (
                          <a href={prog.universityWebsite} target="_blank" rel="noopener noreferrer"
                            className="w-11 h-11 rounded-xl bg-white/90 dark:bg-card/90 shadow-md shadow-black/10 flex items-center justify-center shrink-0 overflow-hidden relative z-10 ring-2 ring-white/50 hover:ring-primary/50 hover:scale-105 transition-all cursor-pointer"
                            onClick={(e) => e.stopPropagation()}>
                            {logoSrc ? (
                              <img src={logoSrc} alt={prog.universityName} className="w-8 h-8 object-contain" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
                              />
                            ) : null}
                            <GraduationCap className={`w-5 h-5 text-primary ${logoSrc ? "hidden" : ""}`} />
                          </a>
                        ) : (
                          <div className="w-11 h-11 rounded-xl bg-white/90 dark:bg-card/90 shadow-md shadow-black/10 flex items-center justify-center shrink-0 overflow-hidden relative z-10 ring-2 ring-white/50">
                            {logoSrc ? (
                              <img src={logoSrc} alt={prog.universityName} className="w-8 h-8 object-contain" loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
                              />
                            ) : null}
                            <GraduationCap className={`w-5 h-5 text-primary ${logoSrc ? "hidden" : ""}`} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1 relative z-10">
                          <p className="text-xs text-foreground/70 truncate font-semibold">{prog.universityName}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0 relative z-10">
                          {prog.universityType && (
                            <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-white/70 dark:bg-card/70 backdrop-blur-sm border-0 shadow-sm">{prog.universityType}</Badge>
                          )}
                          {prog.degree && (
                            <Badge className="bg-primary/90 text-white text-[10px] px-2 py-0.5 shadow-sm">{prog.degree}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="p-5 flex-1 flex flex-col">
                        <h3 className="font-display font-bold text-foreground text-[15px] mb-2.5 group-hover:text-primary transition-colors duration-200 leading-snug line-clamp-2">
                          {prog.name}
                        </h3>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-3.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-primary/50" />
                          <span className="truncate">{[prog.universityCity, prog.universityCountry].filter(Boolean).join(", ")}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-muted-foreground mb-4 bg-secondary/30 dark:bg-secondary/20 rounded-xl p-3">
                          {prog.language && (
                            <span className="flex items-center gap-1.5">
                              <Languages className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="truncate text-xs font-medium">{prog.language}</span>
                            </span>
                          )}
                          {prog.duration && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="truncate text-xs font-medium">{prog.duration}</span>
                            </span>
                          )}
                          {prog.intakes && (
                            <span className="flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <span className="truncate text-xs font-medium">{prog.intakes}</span>
                            </span>
                          )}
                          {effectiveFee ? (
                            <span className="flex items-center gap-1.5">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="flex items-center gap-1 text-xs font-medium min-w-0">
                                {hasDiscount && (
                                  <span className="line-through text-muted-foreground/40 text-[10px]">{formatFee(prog.tuitionFee, prog.currency)}</span>
                                )}
                                <span className={hasDiscount ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""}>
                                  {formatFee(effectiveFee, prog.currency)}
                                </span>
                                {hasDiscount && (
                                  <span className="text-[9px] font-bold text-white bg-emerald-500 rounded px-1 py-px leading-tight">
                                    -{Math.round(((prog.tuitionFee! - prog.discountedFee!) / prog.tuitionFee!) * 100)}%
                                  </span>
                                )}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        {prog.scholarship && prog.scholarship > 0 ? (
                          <div className="mb-3">
                            <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 gap-1">
                              <Award className="w-3 h-3" /> Scholarship: {formatFee(prog.scholarship, prog.currency)}
                            </Badge>
                          </div>
                        ) : null}

                        <div className="mt-auto flex gap-2">
                          <Button variant="outline" size="icon" onClick={() => setDetailProgram(prog)}
                            className="rounded-xl shrink-0 h-10 w-10 border-border/50 hover:border-primary/40 hover:bg-primary/5" title="Program Details">
                            <Info className="w-4 h-4" />
                          </Button>
                          <Button onClick={() => setApplyProgram(prog)} className="flex-1 rounded-xl shadow-md shadow-primary/10 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300">
                            Apply Now
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-12">
                  <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-full w-10 h-10">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  {pageNumbers.map((p, idx) => (
                    p === "..." ? (
                      <span key={`dots-${idx}`} className="px-2 text-muted-foreground">...</span>
                    ) : (
                      <button key={p} onClick={() => setPage(p as number)}
                        className={`w-10 h-10 rounded-full text-sm font-semibold transition-all duration-200 ${
                          page === p
                            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}>
                        {p}
                      </button>
                    )
                  ))}
                  <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-full w-10 h-10">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.1),transparent_60%)]" />
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">Can't find the right program?</h2>
          <p className="text-white/80 mb-8">Our advisors can help you find the perfect fit for your academic goals.</p>
          <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold shadow-xl shadow-black/10 hover:-translate-y-1 transition-all duration-300">
            <a href="/contact">Talk to an Advisor</a>
          </Button>
        </div>
      </section>

      <ApplyDialog open={!!applyProgram} onClose={() => setApplyProgram(null)} program={applyProgram} countries={filters.countries} />
      <ProgramDetailDialog open={!!detailProgram} onClose={() => setDetailProgram(null)} program={detailProgram} />
    </PublicLayout>
  );
}
