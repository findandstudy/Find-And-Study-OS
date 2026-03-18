import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useListStudents, useCreateStudent } from "@workspace/api-client-react";
import { useSeason } from "@/contexts/SeasonContext";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TablePagination, useTablePagination } from "@/components/TablePagination";
import {
  Search, Plus,
  User, GraduationCap, X, CheckCircle2, AlertCircle,
  Users, Loader2, LayoutGrid, List,
  ArrowUpDown, ArrowUp, ArrowDown, Trash2, Pencil,
  Filter, UserCheck, UserX, UserMinus, UserPlus,
  Trophy, XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages, type PipelineStage } from "@/hooks/use-pipeline-stages";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/CountryFlag";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.status === 204) return undefined;
  return r.json();
}

const STATUS_COLORS_DEFAULT: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  inactive: "bg-gray-100 text-gray-600 border-gray-200",
  graduated: "bg-blue-100 text-blue-700 border-blue-200",
  suspended: "bg-red-100 text-red-700 border-red-200",
};

const STU_STAGE_COLORS = [
  "bg-green-100 text-green-700 border-green-200",
  "bg-gray-100 text-gray-600 border-gray-200",
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
];
const STU_WON_COLOR = "bg-blue-100 text-blue-700 border-blue-200";
const STU_LOST_COLOR = "bg-red-100 text-red-700 border-red-200";

function getStuStageColor(stage: PipelineStage, index: number): string {
  if (stage.variant === "won") return STU_WON_COLOR;
  if (stage.variant === "lost") return STU_LOST_COLOR;
  return STU_STAGE_COLORS[index % STU_STAGE_COLORS.length];
}

const EMPTY_FORM = {
  firstName: "", lastName: "", email: "", phone: "", phoneCode: "+90",
  nationality: "", dateOfBirth: "",
  passportNumber: "", passportIssueDate: "", passportExpiry: "",
  motherName: "", fatherName: "", address: "",
  highSchool: "", graduationYear: "", gpa: "", gradingSystem: "4",
  universityBachelor: "", universityMaster: "",
  languageScore: "",
  notes: "",
};

const GRADING_SYSTEMS = [
  { value: "4", label: "Out of 4", placeholder: "e.g. 3.8", max: 4 },
  { value: "5", label: "Out of 5", placeholder: "e.g. 4.5", max: 5 },
  { value: "10", label: "Out of 10", placeholder: "e.g. 8.5", max: 10 },
  { value: "12", label: "Out of 12", placeholder: "e.g. 10", max: 12 },
  { value: "20", label: "Out of 20", placeholder: "e.g. 16.5", max: 20 },
  { value: "100", label: "Out of 100", placeholder: "e.g. 85", max: 100 },
];

const PHONE_CODES = [
  { code: "+90", country: "TR" },
  { code: "+1", country: "US" },
  { code: "+44", country: "GB" },
  { code: "+49", country: "DE" },
  { code: "+33", country: "FR" },
  { code: "+39", country: "IT" },
  { code: "+34", country: "ES" },
  { code: "+31", country: "NL" },
  { code: "+46", country: "SE" },
  { code: "+47", country: "NO" },
  { code: "+45", country: "DK" },
  { code: "+41", country: "CH" },
  { code: "+43", country: "AT" },
  { code: "+48", country: "PL" },
  { code: "+7", country: "RU" },
  { code: "+380", country: "UA" },
  { code: "+86", country: "CN" },
  { code: "+81", country: "JP" },
  { code: "+82", country: "KR" },
  { code: "+91", country: "IN" },
  { code: "+92", country: "PK" },
  { code: "+93", country: "AF" },
  { code: "+966", country: "SA" },
  { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" },
  { code: "+98", country: "IR" },
  { code: "+962", country: "JO" },
  { code: "+961", country: "LB" },
  { code: "+20", country: "EG" },
  { code: "+212", country: "MA" },
  { code: "+234", country: "NG" },
  { code: "+27", country: "ZA" },
  { code: "+55", country: "BR" },
  { code: "+52", country: "MX" },
  { code: "+54", country: "AR" },
  { code: "+61", country: "AU" },
  { code: "+64", country: "NZ" },
  { code: "+60", country: "MY" },
  { code: "+65", country: "SG" },
  { code: "+63", country: "PH" },
  { code: "+66", country: "TH" },
  { code: "+84", country: "VN" },
  { code: "+62", country: "ID" },
  { code: "+994", country: "AZ" },
  { code: "+995", country: "GE" },
  { code: "+998", country: "UZ" },
  { code: "+996", country: "KG" },
  { code: "+993", country: "TM" },
  { code: "+77", country: "KZ" },
];

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
  docType: LevelDoc;
  uploaded?: UploadedDoc;
  onUpload: (doc: UploadedDoc) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    const { base64, mediaType, isImage } = await prepareDocumentBase64(file);
    onUpload({ key: docType.key, label: docType.label, file, base64, mediaType, isImage });
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

  const requiredBadge = docType.required
    ? <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full font-semibold border border-rose-200">Required</span>
    : <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium border border-gray-200">Optional</span>;

  if (uploaded) {
    return (
      <div className="relative flex flex-col items-center gap-1.5 p-3 border-2 border-green-300 bg-green-50 rounded-2xl text-center min-h-[120px] justify-center">
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-2 right-2 w-5 h-5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-full flex items-center justify-center"
        >
          <X className="w-3 h-3" />
        </button>
        <CheckCircle2 className="w-6 h-6 text-green-500" />
        <div>
          <p className="text-xs font-semibold text-foreground truncate max-w-[90px]">{uploaded.file.name}</p>
          <p className="text-xs text-muted-foreground">{Math.round(uploaded.file.size / 1024)}KB</p>
        </div>
        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{docType.label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 p-3 border-2 border-dashed rounded-2xl text-center cursor-pointer min-h-[120px] justify-center transition-all",
        dragging ? "border-primary bg-primary/10"
          : docType.required ? "border-rose-200 hover:border-rose-400 hover:bg-rose-50/50" : "border-border hover:border-primary/50 hover:bg-secondary/50"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <span className="text-2xl">{docType.icon}</span>
      <p className="text-xs font-semibold text-foreground leading-tight">{docType.label}</p>
      {docType.note && <p className="text-[10px] text-muted-foreground leading-tight">{docType.note}</p>}
      <div className="mt-0.5">{requiredBadge}</div>
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

function AddStudentModal({
  open,
  onClose,
  onSuccess,
  defaultStatus,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultStatus?: string;
}) {
  const { toast } = useToast();
  const createStudent = useCreateStudent();
  const { season } = useSeason();

  const { data: countriesResp } = useQuery({
    queryKey: ["all-countries-nationality"],
    queryFn: () => fetch(`${BASE_URL}/api/countries?limit=500`, { credentials: "include" }).then(r => r.json()),
  });
  const allCountries: Array<{ id: number; name: string; code?: string; flagEmoji?: string | null }> = countriesResp?.data ?? [];

  const [form, setForm] = useState(EMPTY_FORM);

  function handleClose() {
    setForm(EMPTY_FORM);
    onClose();
  }

  function field(name: keyof typeof EMPTY_FORM) {
    return (value: string) => setForm((f) => ({ ...f, [name]: value }));
  }

  const gradingSys = GRADING_SYSTEMS.find(g => g.value === form.gradingSystem) || GRADING_SYSTEMS[0];

  function handleSubmit() {
    const missing: string[] = [];
    if (!form.firstName.trim()) missing.push("First Name");
    if (!form.lastName.trim()) missing.push("Last Name");
    if (!form.email.trim()) missing.push("Email");
    if (!form.phone.trim()) missing.push("Phone");
    if (!form.dateOfBirth.trim()) missing.push("Date of Birth");
    if (!form.nationality.trim()) missing.push("Nationality");
    if (!form.motherName.trim()) missing.push("Mother's Name");
    if (!form.fatherName.trim()) missing.push("Father's Name");
    if (!form.passportNumber.trim()) missing.push("Passport Number");
    if (missing.length > 0) {
      toast({ title: "Required fields missing", description: missing.join(", "), variant: "destructive" });
      return;
    }
    const fullPhone = form.phone ? `${form.phoneCode} ${form.phone}` : null;
    createStudent.mutate(
      {
        data: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email || null,
          phone: fullPhone,
          nationality: form.nationality || null,
          dateOfBirth: form.dateOfBirth || null,
          passportNumber: form.passportNumber || null,
          passportIssueDate: form.passportIssueDate || null,
          passportExpiry: form.passportExpiry || null,
          motherName: form.motherName || null,
          fatherName: form.fatherName || null,
          address: form.address || null,
          highSchool: form.highSchool || null,
          universityBachelor: form.universityBachelor || null,
          universityMaster: form.universityMaster || null,
          graduationYear: form.graduationYear ? parseInt(form.graduationYear, 10) : null,
          gpa: form.gpa ? `${form.gpa} / ${form.gradingSystem}` : null,
          languageScore: form.languageScore || null,
          notes: form.notes || null,
          status: defaultStatus || "active",
          season,
        },
      },
      {
        onSuccess: () => { toast({ title: "Student created successfully" }); handleClose(); onSuccess(); },
        onError: (err: any) => { toast({ title: "Failed to create student", description: err?.message, variant: "destructive" }); },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl font-display">Add Student</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>First Name <span className="text-destructive">*</span></Label><Input value={form.firstName} onChange={e => field("firstName")(e.target.value)} placeholder="First name" /></div>
            <div className="space-y-1.5"><Label>Last Name <span className="text-destructive">*</span></Label><Input value={form.lastName} onChange={e => field("lastName")(e.target.value)} placeholder="Last name" /></div>
            <div className="space-y-1.5"><Label>Email <span className="text-destructive">*</span></Label><Input type="email" value={form.email} onChange={e => field("email")(e.target.value)} placeholder="email@example.com" /></div>
            <div className="space-y-1.5">
              <Label>Phone <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Select value={form.phoneCode} onValueChange={v => field("phoneCode")(v)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{PHONE_CODES.map(pc => <SelectItem key={pc.code} value={pc.code}>{pc.code} {pc.country}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={form.phone} onChange={e => field("phone")(e.target.value)} placeholder="555 123 4567" className="flex-1" />
              </div>
            </div>
            <div className="space-y-1.5"><Label>Date of Birth <span className="text-destructive">*</span></Label><Input type="date" value={form.dateOfBirth} onChange={e => field("dateOfBirth")(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Nationality <span className="text-destructive">*</span></Label>
              <Select value={form.nationality} onValueChange={v => field("nationality")(v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="max-h-60">{allCountries.map(c => <SelectItem key={c.id} value={c.name}>{c.flagEmoji || ""} {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Mother's Name <span className="text-destructive">*</span></Label><Input value={form.motherName} onChange={e => field("motherName")(e.target.value)} placeholder="Mother's name" /></div>
            <div className="space-y-1.5"><Label>Father's Name <span className="text-destructive">*</span></Label><Input value={form.fatherName} onChange={e => field("fatherName")(e.target.value)} placeholder="Father's name" /></div>
            <div className="space-y-1.5 col-span-2"><Label>Address</Label><Input value={form.address} onChange={e => field("address")(e.target.value)} placeholder="Full home address" /></div>
            <div className="space-y-1.5"><Label>Passport Number <span className="text-destructive">*</span></Label><Input value={form.passportNumber} onChange={e => field("passportNumber")(e.target.value)} placeholder="e.g. AB1234567" /></div>
            <div className="space-y-1.5"><Label>Passport Issue Date</Label><Input type="date" value={form.passportIssueDate} onChange={e => field("passportIssueDate")(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Passport Expiry</Label><Input type="date" value={form.passportExpiry} onChange={e => field("passportExpiry")(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>High School</Label><Input value={form.highSchool} onChange={e => field("highSchool")(e.target.value)} placeholder="High school name" /></div>
            <div className="space-y-1.5"><Label>Graduation Year</Label><Input value={form.graduationYear} onChange={e => field("graduationYear")(e.target.value)} placeholder="e.g. 2023" /></div>
            <div className="space-y-1.5">
              <Label>GPA</Label>
              <div className="flex gap-2">
                <Input value={form.gpa} onChange={e => field("gpa")(e.target.value)} placeholder={gradingSys.placeholder} className="flex-1" />
                <Select value={form.gradingSystem} onValueChange={v => field("gradingSystem")(v)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{GRADING_SYSTEMS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Language Score</Label><Input value={form.languageScore} onChange={e => field("languageScore")(e.target.value)} placeholder="e.g. IELTS 7.0" /></div>
            <div className="space-y-1.5"><Label>Bachelor University</Label><Input value={form.universityBachelor} onChange={e => field("universityBachelor")(e.target.value)} placeholder="University name" /></div>
            <div className="space-y-1.5"><Label>Master University</Label><Input value={form.universityMaster} onChange={e => field("universityMaster")(e.target.value)} placeholder="University name" /></div>
            <div className="space-y-1.5 col-span-2"><Label>Notes</Label><textarea value={form.notes} onChange={e => field("notes")(e.target.value)} rows={2} placeholder="Additional notes..." className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" /></div>
          </div>
        </div>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createStudent.isPending || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.phone.trim() || !form.dateOfBirth.trim() || !form.nationality.trim() || !form.motherName.trim() || !form.fatherName.trim() || !form.passportNumber.trim()}>
            {createStudent.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Create Student
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


const VIEW_KEY_STU = "edcons_students_view";

type StuSortKey = "name" | "email" | "nationality" | "status" | "passport" | "date";
type StuSortDir = "asc" | "desc";

function StuSortHeader({ label, sortKey, currentSort, onSort }: {
  label: string; sortKey: StuSortKey; currentSort: { key: StuSortKey; dir: StuSortDir }; onSort: (k: StuSortKey) => void;
}) {
  const active = currentSort.key === sortKey;
  return (
    <TableHead className="cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        {active ? (currentSort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />}
      </div>
    </TableHead>
  );
}

type StuColVariant = "won" | "lost" | undefined;

function StudentAvatar({ student, size = "sm" }: { student: any; size?: "sm" | "md" }) {
  const dim = size === "md" ? "w-10 h-10" : "w-8 h-8";
  const textSize = size === "md" ? "text-sm" : "text-xs";
  const [imgError, setImgError] = useState(false);

  if (student.hasPhoto && !imgError) {
    return (
      <img
        src={`/api/students/${student.id}/photo`}
        alt={`${student.firstName} ${student.lastName}`}
        className={`${dim} rounded-full object-cover border border-primary/20 shrink-0`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shrink-0`}>
      <span className={`${textSize} font-bold text-primary`}>{student.firstName?.[0]}{student.lastName?.[0]}</span>
    </div>
  );
}

function DraggableStudentCard({ student, onView, variant }: { student: any; onView: (id: number) => void; variant?: StuColVariant }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: student.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const cardBg =
    variant === "won" ? "bg-emerald-50 border-emerald-200 hover:border-emerald-300" :
    variant === "lost" ? "bg-rose-50 border-rose-200 hover:border-rose-300" :
    "bg-card border-border hover:shadow-md";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border ${isDragging ? "border-primary shadow-xl opacity-50 z-50 relative" : cardBg} mb-3 transition-shadow duration-200`}
    >
      <div {...attributes} {...listeners} className={`p-4 pb-2 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <StudentAvatar student={student} />
          <div className="min-w-0">
            <h4 className="font-bold text-sm text-foreground line-clamp-1">{student.firstName} {student.lastName}</h4>
            <p className="text-xs text-muted-foreground truncate">{student.email || student.phone || "No contact"}</p>
          </div>
        </div>
        {student.nationality && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{student.nationality}</span>}
      </div>
      <div className="px-4 pb-3 flex justify-end">
        <button
          onClick={() => onView(student.id)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <Eye className="w-3 h-3" /> View
        </button>
      </div>
    </div>
  );
}

function DroppableStuColumn({ status, label, variant, students, onView }: { status: string; label: string; variant?: string | null; students: any[]; onView: (id: number) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const v = variant as StuColVariant;

  const colBg = v === "won" ? "bg-emerald-50/60 border-emerald-200/50" : v === "lost" ? "bg-rose-50/60 border-rose-200/50" : "bg-secondary/50 border-border/50";
  const headerBg = v === "won" ? "bg-emerald-100/80 border-emerald-200/70" : v === "lost" ? "bg-rose-100/80 border-rose-200/70" : "bg-card/50 border-border/50";
  const badgeBg = v === "won" ? "bg-emerald-200/60 text-emerald-800 border-emerald-300/50" : v === "lost" ? "bg-rose-200/60 text-rose-800 border-rose-300/50" : "bg-background text-muted-foreground border shadow-sm";

  const dropBg =
    v === "won" ? (isOver ? "bg-emerald-100/60" : "") :
    v === "lost" ? (isOver ? "bg-rose-100/60" : "") :
    (isOver ? "bg-primary/5" : "");

  const emptyBorder =
    v === "won" ? "border-emerald-300/50 text-emerald-500" :
    v === "lost" ? "border-rose-300/50 text-rose-400" :
    "border-border/50 text-muted-foreground";

  const icon =
    v === "won" ? <Trophy className="w-4 h-4 text-emerald-500 shrink-0" /> :
    v === "lost" ? <XCircle className="w-4 h-4 text-rose-400 shrink-0" /> :
    null;

  return (
    <div className={`w-72 flex flex-col max-h-full rounded-2xl border overflow-hidden ${colBg}`}>
      <div className={`p-4 border-b shrink-0 ${headerBg}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-1.5">
            {icon}
            <h3 className={`font-display font-bold text-sm ${v === "won" ? "text-emerald-800" : v === "lost" ? "text-rose-700" : "text-foreground"}`}>{label}</h3>
          </div>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${badgeBg}`}>{students.length}</span>
        </div>
      </div>
      <div ref={setNodeRef} className={`p-3 flex-1 overflow-y-auto custom-scrollbar transition-colors duration-150 ${dropBg}`}>
        <SortableContext items={students.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {students.map((s: any) => (
            <DraggableStudentCard key={s.id} student={s} onView={onView} variant={v} />
          ))}
          {students.length === 0 && (
            <div className={`h-20 border-2 border-dashed rounded-xl flex items-center justify-center text-sm font-medium ${emptyBorder}`}>Drop here</div>
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function EditStudentDialog({ open, onClose, student, stages }: { open: boolean; onClose: () => void; student: any; stages: PipelineStage[] }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", nationality: "", status: "active", dateOfBirth: "", passportNumber: "", notes: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && student) {
      setForm({
        firstName: student.firstName || "", lastName: student.lastName || "",
        email: student.email || "", phone: student.phone || "",
        nationality: student.nationality || "", status: student.status || "active",
        dateOfBirth: student.dateOfBirth || "", passportNumber: student.passportNumber || "",
        notes: student.notes || "",
      });
    }
  }, [open, student]);

  async function handleSave() {
    if (!student || !form.firstName || !form.lastName) return;
    try {
      const res = await fetch(`${BASE_URL}/api/students/${student.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Student updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit Student</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Last Name *</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Nationality</Label><Input value={form.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Date of Birth</Label><Input type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Passport Number</Label><Input value={form.passportNumber} onChange={e => setForm({ ...form, passportNumber: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.firstName || !form.lastName}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StuDeleteConfirmDialog({ open, onClose, count, onConfirm, isPending }: {
  open: boolean; onClose: () => void; count: number; onConfirm: () => void; isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete {count} Student{count > 1 ? "s" : ""}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground py-2">This action cannot be undone.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>{isPending ? "Deleting..." : `Delete ${count}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StuFilterPopover({ filters, onChange, stages }: {
  stages: PipelineStage[];
  filters: { status: string }; onChange: (f: { status: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasActive = filters.status !== "all";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className={`rounded-full relative ${hasActive ? "border-primary text-primary bg-primary/5" : ""}`}>
          <Filter className="w-4 h-4" />
          {hasActive && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-4 space-y-4" align="end">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Filter</p>
          {hasActive && <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange({ status: "all" })}>Clear</Button>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={filters.status} onValueChange={v => onChange({ status: v })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {stages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="w-full" onClick={() => setOpen(false)}>Apply</Button>
      </PopoverContent>
    </Popover>
  );
}

export default function AgentStudentsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth(true, ["agent", "sub_agent"]);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"pipeline" | "list">(() => (localStorage.getItem(VIEW_KEY_STU) as "pipeline" | "list") || "list");
  const [filters, setFilters] = useState({ status: "all" });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<{ key: StuSortKey; dir: StuSortDir }>({ key: "date", dir: "desc" });
  const [editStudent, setEditStudent] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const pg = useTablePagination(25);
  const [activeId, setActiveId] = useState<number | null>(null);

  const stuSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const { stages: pipelineStages } = usePipelineStages("student");
  const studentStatuses = pipelineStages.map(s => s.key);
  const stageMap = Object.fromEntries(pipelineStages.map((s, i) => [s.key, { ...s, _index: i }]));

  const { season } = useSeason();
  const { data, isLoading } = useListStudents({ search, season, limit: 500 } as any);
  const allStudents: any[] = data?.data ?? [];

  const filteredStudents = allStudents.filter((s: any) => {
    if (filters.status !== "all" && s.status !== filters.status) return false;
    return true;
  });

  const sortedStudents = useMemo(() => {
    const arr = [...filteredStudents];
    arr.sort((a: any, b: any) => {
      let valA: any, valB: any;
      switch (sort.key) {
        case "name": valA = `${a.firstName} ${a.lastName}`.toLowerCase(); valB = `${b.firstName} ${b.lastName}`.toLowerCase(); break;
        case "email": valA = (a.email || "").toLowerCase(); valB = (b.email || "").toLowerCase(); break;
        case "nationality": valA = (a.nationality || "").toLowerCase(); valB = (b.nationality || "").toLowerCase(); break;
        case "status": valA = a.status || ""; valB = b.status || ""; break;
        case "passport": valA = a.passportNumber || ""; valB = b.passportNumber || ""; break;
        case "date": valA = a.createdAt || ""; valB = b.createdAt || ""; break;
        default: return 0;
      }
      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredStudents, sort]);

  const { paged: pagedStudents, total: totalStudentsCount } = pg.paginate(sortedStudents);

  useEffect(() => { pg.setPage(1); setSelectedIds(new Set()); }, [search, filters, sort]);

  const pagedIds = useMemo(() => new Set(pagedStudents.map((s: any) => s.id)), [pagedStudents]);
  const allPageSelected = pagedStudents.length > 0 && pagedStudents.every((s: any) => selectedIds.has(s.id));

  function toggleView(mode: "pipeline" | "list") { setViewMode(mode); localStorage.setItem(VIEW_KEY_STU, mode); setSelectedIds(new Set()); }
  function handleSort(key: StuSortKey) { setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }); }
  function toggleSelect(id: number) { setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleSelectAll() {
    if (allPageSelected) { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.delete(id)); return next; }); }
    else { setSelectedIds(prev => { const next = new Set(prev); pagedIds.forEach(id => next.add(id)); return next; }); }
  }

  function invalidate() { queryClient.invalidateQueries({ queryKey: ["/api/students"] }); }

  async function handleBulkDelete() {
    setDeleteInProgress(true);
    const ids = Array.from(selectedIds);
    let failed = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${BASE_URL}/api/students/${id}`, { method: "DELETE", credentials: "include" });
        if (!res.ok) failed++;
      } catch { failed++; }
    }
    setDeleteInProgress(false); setDeleteOpen(false); setSelectedIds(new Set());
    invalidate();
    if (failed === 0) toast({ title: `${ids.length} student${ids.length > 1 ? "s" : ""} deleted` });
    else toast({ title: "Some could not be deleted", variant: "destructive" });
  }

  const allStuColumnIds = new Set(pipelineStages.map(s => s.key));
  const activeStuCard = activeId ? allStudents.find((s: any) => s.id === activeId) : null;

  const handleStuDragStart = (event: DragStartEvent) => setActiveId(event.active.id as number);

  const handleStuDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const studentId = active.id as number;
    const overId = over.id;

    let targetStatus: string;
    if (allStuColumnIds.has(overId as string)) {
      targetStatus = overId as string;
    } else {
      const overStu = allStudents.find((s: any) => s.id === overId);
      if (!overStu) return;
      targetStatus = overStu.status;
    }

    const student = allStudents.find((s: any) => s.id === studentId);
    if (!student || student.status === targetStatus) return;

    apiFetch(`${BASE_URL}/api/students/${studentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: targetStatus }),
    }).then(() => {
      invalidate();
      const colLabel = pipelineStages.find(s => s.key === targetStatus)?.label ?? targetStatus;
      toast({ title: `Student moved → ${colLabel}` });
    }).catch(() => {
      toast({ title: "Error", description: "Could not move student", variant: "destructive" });
      invalidate();
    });
  };

  function formatDate(d: string | null | undefined) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-8rem)] flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Students</h1>
            <p className="text-muted-foreground text-sm mt-1">{data?.meta?.total ?? 0} total students</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search students..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-white dark:bg-black/20 border-border rounded-full" />
            </div>
            <StuFilterPopover filters={filters} onChange={setFilters} stages={pipelineStages} />
            <div className="flex items-center border rounded-full overflow-hidden">
              <button onClick={() => toggleView("pipeline")} className={`p-2 transition-colors ${viewMode === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="Pipeline view"><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => toggleView("list")} className={`p-2 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`} title="List view"><List className="w-4 h-4" /></button>
            </div>
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" className="rounded-full" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="w-4 h-4 mr-1" /> Delete ({selectedIds.size})
              </Button>
            )}
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Student
            </Button>
          </div>
        </div>

        {viewMode === "pipeline" && (
          <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
            <div className="flex gap-5 h-full min-w-max px-1">
              <DndContext
                sensors={stuSensors}
                collisionDetection={closestCorners}
                onDragStart={handleStuDragStart}
                onDragEnd={handleStuDragEnd}
              >
                {pipelineStages.map((ps, idx) => {
                  const statusStudents = filteredStudents.filter((s: any) => s.status === ps.key);
                  return <DroppableStuColumn key={ps.key} status={ps.key} label={ps.label} variant={ps.variant} students={statusStudents} onView={id => { const s = allStudents.find((x: any) => x.id === id); if (s) setEditStudent(s); }} />;
                })}

                <DragOverlay>
                  {activeStuCard ? (
                    <div className="bg-card rounded-xl border border-primary shadow-2xl p-4 w-72 opacity-95 rotate-1">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <StudentAvatar student={activeStuCard} />
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-foreground line-clamp-1">{activeStuCard.firstName} {activeStuCard.lastName}</h4>
                          <p className="text-xs text-muted-foreground truncate">{activeStuCard.email || activeStuCard.phone || "No contact"}</p>
                        </div>
                      </div>
                      {activeStuCard.nationality && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{activeStuCard.nationality}</span>}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </div>
        )}

        {viewMode === "list" && (
          <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border">
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10"><Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} /></TableHead>
                    <StuSortHeader label="Name" sortKey="name" currentSort={sort} onSort={handleSort} />
                    <StuSortHeader label="Email" sortKey="email" currentSort={sort} onSort={handleSort} />
                    <StuSortHeader label="Nationality" sortKey="nationality" currentSort={sort} onSort={handleSort} />
                    <StuSortHeader label="Passport" sortKey="passport" currentSort={sort} onSort={handleSort} />
                    <StuSortHeader label="Status" sortKey="status" currentSort={sort} onSort={handleSort} />
                    <StuSortHeader label="Joined" sortKey="date" currentSort={sort} onSort={handleSort} />
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : pagedStudents.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No students found</TableCell></TableRow>
                  ) : pagedStudents.map((student: any) => (
                    <TableRow key={student.id} className={`cursor-pointer hover:bg-muted/30 transition-colors ${selectedIds.has(student.id) ? "bg-primary/5" : ""}`}>
                      <TableCell onClick={e => e.stopPropagation()}><Checkbox checked={selectedIds.has(student.id)} onCheckedChange={() => toggleSelect(student.id)} /></TableCell>
                      <TableCell className="font-medium" onClick={() => setEditStudent(student)}>
                        <div className="flex items-center gap-2">
                          <StudentAvatar student={student} />
                          <div>
                            <p className="text-sm font-semibold">{student.firstName} {student.lastName}</p>
                            {student.phone && <p className="text-xs text-muted-foreground">{student.phone}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground" onClick={() => setEditStudent(student)}>{student.email || "-"}</TableCell>
                      <TableCell onClick={() => setEditStudent(student)}>{student.nationality || "-"}</TableCell>
                      <TableCell className="font-mono text-xs" onClick={() => setEditStudent(student)}>{student.passportNumber || "-"}</TableCell>
                      <TableCell onClick={() => setEditStudent(student)}>
                        <Badge className={cn("text-xs border font-medium", stageMap[student.status] ? getStuStageColor(stageMap[student.status], stageMap[student.status]._index) : "bg-gray-100 text-gray-600 border-gray-200")}>{stageMap[student.status]?.label || student.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs" onClick={() => setEditStudent(student)}>{formatDate(student.createdAt)}</TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditStudent(student)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setSelectedIds(new Set([student.id])); setDeleteOpen(true); }} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              currentPage={pg.page}
              totalItems={totalStudentsCount}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
          </div>
        )}
      </div>

      <EditStudentDialog open={!!editStudent} onClose={() => setEditStudent(null)} student={editStudent} stages={pipelineStages} />
      <StuDeleteConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} count={selectedIds.size} onConfirm={handleBulkDelete} isPending={deleteInProgress} />
      <AddStudentModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={invalidate} defaultStatus={pipelineStages[0]?.key} />
    </DashboardLayout>
  );
}
