import { useState, useEffect, useCallback, useRef } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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
  universityName: string;
  universityCountry: string | null;
  universityCity: string | null;
  universityLogoUrl: string | null;
}

interface Filters {
  countries: string[];
  degrees: string[];
  languages: string[];
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

type ApplyStep = "upload" | "analyzing" | "form";

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "", phoneCode: "+90",
  nationality: "", dateOfBirth: "", notes: "",
};

function ApplyDialog({ open, onClose, program }: { open: boolean; onClose: () => void; program: Program | null }) {
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
    if (!form.firstName || !form.lastName || !form.email) {
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

      toast({ title: "Application submitted successfully!", description: "We will contact you soon." });
      reset();
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
                  Phone {extracted.has("phone") && <AiBadge />}
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
                  Nationality {extracted.has("nationality") && <AiBadge />}
                </Label>
                <Input value={form.nationality} onChange={(e) => setForm(f => ({ ...f, nationality: e.target.value }))}
                  placeholder="Nationality" className={`rounded-xl ${extracted.has("nationality") ? "border-emerald-300 bg-emerald-50/40" : ""}`} />
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

export default function Programs() {
  useSeo({ title: "Programs", description: "Browse programs at 200+ partner universities worldwide." });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [country, setCountry] = useState("All");
  const [level, setLevel] = useState("All");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ countries: [], degrees: [], languages: [] });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    customFetch<Filters>("/api/course-finder/filters", { method: "GET" })
      .then(data => setFilters(data))
      .catch(() => {});
  }, []);

  const fetchPrograms = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (country !== "All") params.set("country", country);
      if (level !== "All") params.set("level", level);

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
  }, [page, debouncedSearch, country, level]);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);
  useEffect(() => { setPage(1); }, [debouncedSearch, country, level]);

  const displayCountries = filters.countries.length > 0 ? ["All", ...filters.countries] : ["All"];
  const displayDegrees = filters.degrees.length > 0 ? ["All", ...filters.degrees] : ["All"];

  return (
    <PublicLayout>
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <GraduationCap className="w-4 h-4" /> {total > 0 ? `${total}+ Programs Available` : "Browse Programs"}
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
              Find Your Perfect <span className="text-primary">Program</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Browse programs at top universities worldwide and find the one that's right for you.
            </p>
            <div className="max-w-2xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search programs, universities, locations..."
                className="pl-12 pr-4 py-6 text-base rounded-full shadow-lg border-border/50 focus:border-primary" />
            </div>
          </motion.div>
        </div>
      </section>

      <section className="sticky top-20 z-40 bg-background/95 backdrop-blur-sm border-b py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6 overflow-x-auto pb-2">
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Country:</span>
              {displayCountries.map(c => (
                <button key={c} onClick={() => setCountry(c)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                    ${country === c ? 'bg-primary text-white shadow-md shadow-primary/25' : 'bg-secondary hover:bg-primary/10 text-muted-foreground hover:text-primary'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Level:</span>
              {displayDegrees.map(l => (
                <button key={l} onClick={() => setLevel(l)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                    ${level === l ? 'bg-accent text-white shadow-md shadow-accent/25' : 'bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <p className="text-muted-foreground">
              Showing <span className="font-bold text-foreground">{total}</span> programs
            </p>
          </div>

          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-72 rounded-2xl bg-secondary animate-pulse" />
              ))}
            </div>
          ) : programs.length === 0 ? (
            <div className="text-center py-24">
              <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-foreground mb-2">No programs found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search terms</p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {programs.map((prog, i) => {
                  const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
                  const hasDiscount = prog.discountedFee && prog.tuitionFee && prog.discountedFee < prog.tuitionFee;
                  const logoSrc = fixStorageUrl(prog.universityLogoUrl);
                  return (
                    <motion.div key={prog.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.03 }}
                      className="group bg-card rounded-2xl overflow-hidden shadow-lg shadow-black/5 hover:-translate-y-1 transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 border border-border/40 flex flex-col">
                      <div className="h-16 bg-gradient-to-r from-primary/15 via-accent/10 to-primary/5 relative flex items-center px-5 gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/90 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                          {logoSrc ? (
                            <img src={logoSrc} alt={prog.universityName} className="w-8 h-8 object-contain" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }}
                            />
                          ) : null}
                          <GraduationCap className={`w-5 h-5 text-primary ${logoSrc ? "hidden" : ""}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground truncate font-medium">{prog.universityName}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          {prog.universityCountry && (
                            <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{prog.universityCountry}</Badge>
                          )}
                          {prog.degree && (
                            <Badge className="bg-primary/90 text-white text-[10px] px-2 py-0.5">{prog.degree}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="p-5 flex-1 flex flex-col">
                        <h3 className="font-display font-bold text-foreground text-base mb-2 group-hover:text-primary transition-colors leading-tight line-clamp-2">
                          {prog.name}
                        </h3>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-3">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{[prog.universityCity, prog.universityCountry].filter(Boolean).join(", ")}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                          {prog.language && (
                            <span className="flex items-center gap-1.5">
                              <Languages className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="truncate">{prog.language}</span>
                            </span>
                          )}
                          {prog.duration && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="truncate">{prog.duration}</span>
                            </span>
                          )}
                          {prog.intakes && (
                            <span className="flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <span className="truncate">{prog.intakes}</span>
                            </span>
                          )}
                          {effectiveFee ? (
                            <span className="flex items-center gap-1.5">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="truncate">
                                {hasDiscount && (
                                  <span className="line-through text-muted-foreground/50 mr-1 text-xs">
                                    {formatFee(prog.tuitionFee, prog.currency)}
                                  </span>
                                )}
                                {formatFee(effectiveFee, prog.currency)}
                              </span>
                            </span>
                          ) : null}
                        </div>
                        {prog.scholarship && prog.scholarship > 0 ? (
                          <div className="mb-4">
                            <Badge variant="outline" className="text-xs border-green-500/30 text-green-600 bg-green-50 dark:bg-green-950/30">
                              Scholarship: {formatFee(prog.scholarship, prog.currency)}
                            </Badge>
                          </div>
                        ) : null}
                        <div className="mt-auto">
                          <Button onClick={() => setApplyProgram(prog)} className="w-full rounded-xl">
                            Apply Now
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-10">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-full">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-full">
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">Can't find the right program?</h2>
          <p className="text-white/80 mb-8">Our advisors can help you find the perfect fit for your academic goals.</p>
          <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold">
            <a href="/contact">Talk to an Advisor</a>
          </Button>
        </div>
      </section>

      <ApplyDialog open={!!applyProgram} onClose={() => setApplyProgram(null)} program={applyProgram} />
    </PublicLayout>
  );
}
