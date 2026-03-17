import { useState, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useListApplications,
  useListStudents,
  useCreateApplication,
} from "@workspace/api-client-react";
import type { Student } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Search,
  Plus,
  MoreHorizontal,
  ArrowUpRight,
  User,
  ChevronDown,
  X,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  inquiry: { label: "Inquiry", color: "bg-slate-100 text-slate-700 border-slate-200" },
  documents_collected: { label: "Documents", color: "bg-blue-100 text-blue-700 border-blue-200" },
  submitted: { label: "Submitted", color: "bg-violet-100 text-violet-700 border-violet-200" },
  offer_received: { label: "Offer Received", color: "bg-amber-100 text-amber-700 border-amber-200" },
  visa_applied: { label: "Visa Applied", color: "bg-orange-100 text-orange-700 border-orange-200" },
  visa_approved: { label: "Visa Approved", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  enrolled: { label: "Enrolled", color: "bg-green-100 text-green-700 border-green-200" },
  rejected: { label: "Rejected", color: "bg-rose-100 text-rose-700 border-rose-200" },
};

const STAGE_ORDER = [
  "inquiry", "documents_collected", "submitted", "offer_received",
  "visa_applied", "visa_approved", "enrolled", "rejected",
];

const STUDY_LEVELS = [
  { value: "foundation", label: "Foundation / Hazırlık" },
  { value: "diploma", label: "Diploma" },
  { value: "undergraduate", label: "Undergraduate / Lisans" },
  { value: "masters", label: "Masters / Yüksek Lisans" },
  { value: "mba", label: "MBA" },
  { value: "doctorate", label: "Doctorate / Doktora" },
  { value: "certificate", label: "Certificate Program" },
  { value: "language_school", label: "Language School" },
];

const INSTRUCTION_LANGUAGES = [
  "English", "Turkish", "French", "German", "Arabic", "Russian",
  "Dutch", "Spanish", "Italian", "Chinese", "Japanese", "Portuguese",
];

const STUDY_COUNTRIES = [
  "United Kingdom", "United States", "Canada", "Australia", "Germany",
  "France", "Netherlands", "Turkey", "Ireland", "New Zealand",
  "Sweden", "Norway", "Denmark", "Switzerland", "Austria",
  "Italy", "Spain", "Poland", "Czech Republic", "Hungary",
  "Japan", "South Korea", "Singapore", "Malaysia", "UAE",
  "Qatar", "Saudi Arabia", "South Africa", "Brazil", "Argentina",
];

function generateIntakes(): string[] {
  const intakes: string[] = [];
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const months = [
    { label: "Sep", month: 8 },
    { label: "Jan", month: 0 },
    { label: "Feb", month: 1 },
    { label: "May", month: 4 },
  ];
  for (let y = year; y <= year + 3; y++) {
    for (const m of months) {
      if (y === year && m.month < month) continue;
      intakes.push(`${m.label} ${y}`);
    }
  }
  return intakes;
}

const INTAKES = generateIntakes();

const EMPTY_FORM = {
  country: "",
  universityName: "",
  level: "",
  programName: "",
  instructionLanguage: "",
  intake: "",
  notes: "",
};

function StudentSearchInput({
  value,
  onChange,
}: {
  value: Student | null;
  onChange: (student: Student | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: studentsResp, isLoading } = useListStudents(
    { search: debouncedQuery, limit: 10 },
    { query: { enabled: debouncedQuery.length >= 1 } }
  );
  const students = studentsResp?.data ?? [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 p-2.5 border border-primary rounded-xl bg-primary/5">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {value.firstName} {value.lastName}
          </p>
          {value.email && (
            <p className="text-xs text-muted-foreground truncate">{value.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-1 rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="pl-9 rounded-xl"
        />
      </div>

      {open && (query.length >= 1) && (
        <div className="absolute z-50 top-full mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          {isLoading && (
            <div className="p-3 text-sm text-muted-foreground text-center">Searching…</div>
          )}
          {!isLoading && students.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground text-center">
              No students found
            </div>
          )}
          {students.map((student) => (
            <button
              key={student.id}
              type="button"
              className="w-full flex items-center gap-3 p-3 hover:bg-secondary/70 transition-colors text-left border-b border-border/50 last:border-0"
              onClick={() => {
                onChange(student);
                setQuery("");
                setOpen(false);
              }}
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {student.firstName} {student.lastName}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {student.email || student.nationality || "—"}
                </p>
              </div>
              <Check className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddApplicationModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const createApplication = useCreateApplication();

  function handleClose() {
    setSelectedStudent(null);
    setForm(EMPTY_FORM);
    onClose();
  }

  function handleSubmit() {
    if (!selectedStudent) {
      toast({ title: "Please select a student", variant: "destructive" });
      return;
    }
    if (!form.country) {
      toast({ title: "Please select a country", variant: "destructive" });
      return;
    }
    if (!form.level) {
      toast({ title: "Please select a study level", variant: "destructive" });
      return;
    }

    createApplication.mutate(
      {
        data: {
          studentId: selectedStudent.id,
          stage: "inquiry",
          country: form.country || null,
          universityName: form.universityName || null,
          level: form.level || null,
          programName: form.programName || null,
          instructionLanguage: form.instructionLanguage || null,
          intake: form.intake || null,
          notes: form.notes || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Application created successfully" });
          handleClose();
          onSuccess();
        },
        onError: (err: any) => {
          toast({
            title: "Failed to create application",
            description: err?.message || "Please try again",
            variant: "destructive",
          });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-display">New Application</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="font-semibold flex items-center gap-1.5">
              <User className="w-4 h-4 text-primary" />
              Student <span className="text-destructive">*</span>
            </Label>
            <StudentSearchInput value={selectedStudent} onChange={setSelectedStudent} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">
                Country <span className="text-destructive">*</span>
              </Label>
              <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select country…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {STUDY_COUNTRIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">University / School</Label>
              <Input
                placeholder="e.g. University of Manchester"
                value={form.universityName}
                onChange={(e) => setForm({ ...form, universityName: e.target.value })}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">
                Study Level <span className="text-destructive">*</span>
              </Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select level…" />
                </SelectTrigger>
                <SelectContent>
                  {STUDY_LEVELS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">Department / Program</Label>
              <Input
                placeholder="e.g. Computer Science"
                value={form.programName}
                onChange={(e) => setForm({ ...form, programName: e.target.value })}
                className="rounded-xl"
              />
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">Instruction Language</Label>
              <Select
                value={form.instructionLanguage}
                onValueChange={(v) => setForm({ ...form, instructionLanguage: v })}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select language…" />
                </SelectTrigger>
                <SelectContent>
                  {INSTRUCTION_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label className="font-semibold">Intake</Label>
              <Select value={form.intake} onValueChange={(v) => setForm({ ...form, intake: v })}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select intake…" />
                </SelectTrigger>
                <SelectContent>
                  {INTAKES.map((intake) => (
                    <SelectItem key={intake} value={intake}>{intake}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2">
              <Label className="font-semibold">Notes</Label>
              <textarea
                placeholder="Additional notes about this application…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              />
            </div>
          </div>

          {selectedStudent && (
            <div className="bg-secondary/50 rounded-xl p-3 border border-border/50">
              <p className="text-xs font-medium text-muted-foreground mb-1">Application Summary</p>
              <p className="text-sm">
                <span className="font-semibold">{selectedStudent.firstName} {selectedStudent.lastName}</span>
                {form.level && <> · <span className="capitalize">{STUDY_LEVELS.find(l => l.value === form.level)?.label}</span></>}
                {form.country && <> · {form.country}</>}
                {form.universityName && <> · {form.universityName}</>}
                {form.intake && <> · {form.intake}</>}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} className="rounded-xl">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createApplication.isPending || !selectedStudent || !form.country || !form.level}
            className="rounded-xl"
          >
            {createApplication.isPending ? "Creating…" : "Create Application"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ApplicationsPage() {
  const [stageFilter, setStageFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: applicationsResp, isLoading } = useListApplications({});
  const applications: any[] = (applicationsResp as any)?.data || [];

  const filtered = applications.filter((app: any) =>
    stageFilter === "all" || app.stage === stageFilter
  );

  const stageCounts = STAGE_ORDER.reduce((acc, s) => {
    acc[s] = applications.filter((a: any) => a.stage === s).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Applications</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {applications.length} total applications
            </p>
          </div>
          <Button
            className="rounded-xl gap-2 shadow-md shadow-primary/20"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="w-4 h-4" /> New Application
          </Button>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          <button
            onClick={() => setStageFilter("all")}
            className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
              ${stageFilter === "all" ? "bg-primary text-white border-primary shadow-sm shadow-primary/25" : "bg-card border-border hover:border-primary/50"}`}
          >
            All{" "}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${stageFilter === "all" ? "bg-white/20" : "bg-secondary"}`}>
              {applications.length}
            </span>
          </button>
          {STAGE_ORDER.map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const count = stageCounts[stage] || 0;
            if (count === 0 && stageFilter !== stage) return null;
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(stage)}
                className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all
                  ${stageFilter === stage ? "bg-primary text-white border-primary shadow-sm shadow-primary/25" : "bg-card border-border hover:border-primary/50"}`}
              >
                {cfg.label}{" "}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${stageFilter === stage ? "bg-white/20" : "bg-secondary"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <Card className="border-none shadow-md shadow-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-secondary/30">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Student
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Stage
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Country
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    University
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Level
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Program
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Intake
                  </th>
                  <th className="px-6 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {isLoading && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                      Loading applications…
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                      No applications found.{" "}
                      <button
                        onClick={() => setAddOpen(true)}
                        className="text-primary hover:underline font-medium"
                      >
                        Add one
                      </button>
                    </td>
                  </tr>
                )}
                {filtered.map((app: any) => {
                  const stageCfg = STAGE_CONFIG[app.stage] || { label: app.stage, color: "bg-secondary text-muted-foreground border-border" };
                  const levelLabel = STUDY_LEVELS.find((l) => l.value === app.level)?.label || app.level || "—";
                  return (
                    <tr key={app.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-primary" />
                          </div>
                          <span className="text-sm font-medium text-foreground">
                            #{app.studentId}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${stageCfg.color}`}>
                          {stageCfg.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">{app.country || "—"}</td>
                      <td className="px-6 py-4 text-sm text-foreground max-w-[160px] truncate">{app.universityName || "—"}</td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        {levelLabel}
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground max-w-[160px] truncate">{app.programName || "—"}</td>
                      <td className="px-6 py-4 text-sm text-foreground">{app.intake || "—"}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-primary/10 hover:text-primary">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg">
                                <MoreHorizontal className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl shadow-lg">
                              <DropdownMenuItem>Update Stage</DropdownMenuItem>
                              <DropdownMenuItem>Add Note</DropdownMenuItem>
                              <DropdownMenuItem>Request Documents</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">Archive</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {STAGE_ORDER.map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const count = stageCounts[stage] || 0;
            return (
              <Card
                key={stage}
                className="p-4 text-center border-none shadow-md shadow-black/5 hover:-translate-y-1 transition-transform cursor-pointer"
                onClick={() => setStageFilter(stage)}
              >
                <p className="text-2xl font-display font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-tight">{cfg.label}</p>
              </Card>
            );
          })}
        </div>
      </div>

      <AddApplicationModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/applications"] })}
      />
    </DashboardLayout>
  );
}
