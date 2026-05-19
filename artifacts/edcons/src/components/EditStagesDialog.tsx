import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, AlertCircle, Pencil, ArrowLeft, ChevronDown } from "lucide-react";
import type { PipelineStage, StageAction, StageActionType } from "@/hooks/use-pipeline-stages";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type ActionTypeOrNone = StageActionType | "none";
const ACTION_TYPE_OPTIONS: { value: ActionTypeOrNone; label: string; defaultLabel: string; defaultColor: string }[] = [
  { value: "none", label: "— None —", defaultLabel: "", defaultColor: "#3b82f6" },
  { value: "upload", label: "Upload Document", defaultLabel: "Upload", defaultColor: "#3b82f6" },
  { value: "download", label: "Download Document", defaultLabel: "Download", defaultColor: "#10b981" },
  { value: "missing_docs", label: "Missing Documents", defaultLabel: "Missing Docs", defaultColor: "#f59e0b" },
];

function humanizeDocType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function DocTypePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: docTypes = [] } = useQuery<string[]>({
    queryKey: ["document-types"],
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/document-types`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const summary = value.length === 0 ? "Tümü" : value.length === 1 ? humanizeDocType(value[0]) : `${value.length} belge türü`;
  function toggle(t: string) {
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between h-8 font-normal">
          <span className="truncate text-xs">{summary}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-xs font-semibold">Required Documents</span>
          {value.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>Clear</Button>
          )}
        </div>
        <div className="max-h-64 overflow-auto pr-1">
          {docTypes.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-2">No document types available</p>
          )}
          {docTypes.map((t) => (
            <label key={t} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/60 cursor-pointer">
              <Checkbox checked={value.includes(t)} onCheckedChange={() => toggle(t)} />
              <span className="text-xs flex-1">{humanizeDocType(t)}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StageActionEditor({
  action,
  allStages,
  currentStageKey,
  onChange,
  onRemove,
  index,
}: {
  action: StageAction;
  allStages: PipelineStage[];
  currentStageKey: string;
  onChange: (a: StageAction) => void;
  onRemove: () => void;
  index: number;
}) {
  const typeOpt = ACTION_TYPE_OPTIONS.find((o) => o.value === action.type);
  const targetOptions = allStages.filter((s) => s.key && s.key !== currentStageKey);
  const requiresDocs = action.type === "missing_docs";
  const docsMissing = requiresDocs && (!action.requiredDocTypes || action.requiredDocTypes.length === 0);
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Button {index + 1}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove} title="Remove action">
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Type</Label>
          <Select
            value={action.type}
            onValueChange={(v) => {
              if (v === "none") {
                onRemove();
                return;
              }
              const opt = ACTION_TYPE_OPTIONS.find((o) => o.value === v);
              onChange({
                ...action,
                type: v as StageActionType,
                label: action.label || opt?.defaultLabel || null,
                color: action.color || opt?.defaultColor || null,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTION_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Move to stage</Label>
          <Select
            value={action.targetStageKey || ""}
            onValueChange={(v) => onChange({ ...action, targetStageKey: v })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select stage…" /></SelectTrigger>
            <SelectContent>
              {targetOptions.map((s) => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Button label</Label>
          <Input
            value={action.label || ""}
            onChange={(e) => onChange({ ...action, label: e.target.value })}
            placeholder={typeOpt?.defaultLabel || "Button"}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Color</Label>
          <input
            type="color"
            value={action.color || typeOpt?.defaultColor || "#3B82F6"}
            onChange={(e) => onChange({ ...action, color: e.target.value })}
            className="h-8 w-12 rounded border cursor-pointer p-0.5"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">
          {requiresDocs
            ? <>Required documents <span className="text-destructive">*</span></>
            : <>Required documents (informational)</>}
        </Label>
        <DocTypePicker
          value={action.requiredDocTypes || []}
          onChange={(v) => onChange({ ...action, requiredDocTypes: v })}
        />
        {docsMissing && (
          <p className="text-[11px] text-destructive">Missing Documents için en az bir belge türü seçilmeli.</p>
        )}
      </div>
    </div>
  );
}

interface EditStagesDialogProps {
  open: boolean;
  onClose: () => void;
  stages: PipelineStage[];
  onSave: (stages: PipelineStage[]) => Promise<void>;
  isSaving: boolean;
  entityLabel: string;
  /**
   * Available student-pipeline stage keys/labels. When provided AND the
   * pipeline being edited is the application pipeline, each row gets an
   * extra "→ Student stage" picker that maps the application stage to a
   * student status. Selecting a value causes the backend to automatically
   * update the linked student's status when the application reaches that
   * stage. Pass `null`/`undefined` to disable the mapping UI (e.g. when
   * editing the lead or student pipeline themselves).
   */
  studentStages?: PipelineStage[];
}

const VARIANT_OPTIONS = [
  { value: "none", label: "—", dotClass: "bg-muted-foreground/40" },
  { value: "won", label: "Won", dotClass: "bg-emerald-500" },
  { value: "partial_won", label: "Partial Won", dotClass: "bg-amber-500" },
  { value: "lost", label: "Lost", dotClass: "bg-rose-500" },
  { value: "none_finance", label: "None", dotClass: "bg-gray-300" },
];

function getVariantDot(variant: string | null | undefined) {
  const opt = VARIANT_OPTIONS.find(v => v.value === (variant || "none"));
  return opt?.dotClass || "bg-muted-foreground/40";
}

function RadioGroup({ label, value, onChange, required }: { label: string; value: boolean; onChange: (v: boolean) => void; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={label}
            checked={!value}
            onChange={() => onChange(false)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">No</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={label}
            checked={value}
            onChange={() => onChange(true)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">Yes</span>
        </label>
      </div>
    </div>
  );
}

const UPLOAD_PERMISSION_OPTIONS = [
  { value: "none", label: "None — no uploads allowed" },
  { value: "admin_only", label: "Admin only (admin / manager)" },
  { value: "staff_only", label: "All staff" },
  { value: "staff_and_agent", label: "Staff + Agents" },
  { value: "everyone", label: "Everyone (Staff + Agents + Students)" },
];

const FINANCE_STATUS_OPTIONS = [
  { value: "auto", label: "Auto (use Finance Category)" },
  { value: "potential", label: "Potential" },
  { value: "confirmed", label: "Confirmed" },
  { value: "excluded", label: "Excluded" },
];

function StageEditForm({ stage, onChange, allStages }: { stage: PipelineStage; onChange: (s: PipelineStage) => void; allStages: PipelineStage[] }) {
  const isApplicationStage = stage.entityType === "application";
  const actions: StageAction[] = Array.isArray(stage.actions) ? stage.actions : [];
  function updateActionAt(i: number, a: StageAction) {
    const next = actions.slice();
    next[i] = a;
    onChange({ ...stage, actions: next });
  }
  function removeActionAt(i: number) {
    onChange({ ...stage, actions: actions.filter((_, idx) => idx !== i) });
  }
  function addAction() {
    if (actions.length >= 2) return;
    // Default to "upload" (first non-"none" option) when adding a new slot.
    const opt = ACTION_TYPE_OPTIONS.find((o) => o.value !== "none")!;
    const fallbackTarget = allStages.find((s) => s.key && s.key !== stage.key)?.key || stage.key;
    const newAction: StageAction = {
      type: opt.value as StageActionType,
      label: opt.defaultLabel,
      color: opt.defaultColor,
      targetStageKey: fallbackTarget,
      requiredDocTypes: [],
    };
    onChange({ ...stage, actions: [...actions, newAction] });
  }
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Name<span className="text-destructive ml-0.5">*</span>
        </Label>
        <Input
          value={stage.label}
          onChange={e => onChange({ ...stage, label: e.target.value })}
          placeholder="Stage name"
        />
      </div>

      <RadioGroup
        label="Is Notes mandatory?"
        value={!!stage.isNotesMandatory}
        onChange={v => onChange({ ...stage, isNotesMandatory: v })}
        required
      />

      <RadioGroup
        label="Can attach File?"
        value={!!stage.canAttachFile}
        onChange={v => onChange({ ...stage, canAttachFile: v, ...(v ? {} : { isFileUploadMandatory: false }) })}
      />

      {stage.canAttachFile && (
        <>
          <div className="space-y-1.5 ml-4 border-l-2 border-muted pl-4">
            <Label className="text-sm font-medium">
              No. of files that can be attached<span className="text-destructive ml-0.5">*</span>
            </Label>
            <Select
              value={String(stage.maxFiles || 1)}
              onValueChange={v => onChange({ ...stage, maxFiles: parseInt(v) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 10, 20].map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <RadioGroup
              label="Is file attachment Upload mandatory?"
              value={!!stage.isFileUploadMandatory}
              onChange={v => onChange({ ...stage, isFileUploadMandatory: v })}
              required
            />
          </div>
        </>
      )}

      <RadioGroup
        label="Can go back to previous stage from this stage?"
        value={stage.canGoBack !== false}
        onChange={v => onChange({ ...stage, canGoBack: v })}
        required
      />

      <RadioGroup
        label="Is this Case Close stage?"
        value={!!stage.isCaseClose}
        onChange={v => onChange({ ...stage, isCaseClose: v })}
        required
      />

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Select Countries</Label>
        <Input
          value={stage.countries || ""}
          onChange={e => onChange({ ...stage, countries: e.target.value || null })}
          placeholder="e.g. Turkey, Germany, USA (comma-separated)"
        />
        <p className="text-xs text-muted-foreground">
          If University Application Status is for specific country, this status will be shown.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Color<span className="text-destructive ml-0.5">*</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            value={stage.color || "#3B82F6"}
            onChange={e => onChange({ ...stage, color: e.target.value })}
            placeholder="#3B82F6"
            className="flex-1"
          />
          <input
            type="color"
            value={stage.color || "#3B82F6"}
            onChange={e => onChange({ ...stage, color: e.target.value })}
            className="w-10 h-10 rounded border cursor-pointer p-0.5"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Finance Category</Label>
        <Select
          value={stage.variant || "none"}
          onValueChange={v => onChange({ ...stage, variant: v === "none" ? null : v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VARIANT_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${opt.dotClass}`} />
                  {opt.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Won = confirmed commission/service fee. Partial Won = potential commission/service fee. None = excluded from finance.
        </p>
      </div>

      {isApplicationStage && (
        <>
          <div className="pt-2 border-t" />

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Document upload permission</Label>
            <Select
              value={stage.uploadPermissionLevel || "none"}
              onValueChange={v => onChange({ ...stage, uploadPermissionLevel: v })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UPLOAD_PERMISSION_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Who can upload documents to this stage. "None" hides this stage from the documents panel entirely.
            </p>
          </div>

          <RadioGroup
            label="Track offer expiry (valid-until date)?"
            value={!!stage.tracksOfferExpiry}
            onChange={v => onChange({ ...stage, tracksOfferExpiry: v, ...(v ? {} : { requiresValidUntil: false }) })}
          />

          {stage.tracksOfferExpiry && (
            <div className="ml-4 border-l-2 border-muted pl-4">
              <RadioGroup
                label="Valid-until date is mandatory?"
                value={!!stage.requiresValidUntil}
                onChange={v => onChange({ ...stage, requiresValidUntil: v })}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Commission finance status when reached</Label>
            <Select
              value={stage.commissionFinanceStatus || "auto"}
              onValueChange={v => onChange({ ...stage, commissionFinanceStatus: v === "auto" ? null : v })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINANCE_STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Service fee finance status when reached</Label>
            <Select
              value={stage.serviceFeeFinanceStatus || "auto"}
              onValueChange={v => onChange({ ...stage, serviceFeeFinanceStatus: v === "auto" ? null : v })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FINANCE_STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Override the finance status applied to commissions and service fees when an application reaches this stage. "Auto" derives the status from the Finance Category above.
            </p>
          </div>

          <RadioGroup
            label="Auto-cancel sibling applications when reaching this stage?"
            value={!!stage.autoCancelSiblingsOnWon}
            onChange={v => onChange({ ...stage, autoCancelSiblingsOnWon: v })}
          />

          <div className="pt-2 border-t" />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Stage Actions</Label>
                <p className="text-[11px] text-muted-foreground">
                  Up to 2 action buttons appear on the Applications list for rows in this stage.
                  Completing an action moves the application to the chosen target stage.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 shrink-0"
                onClick={addAction}
                disabled={actions.length >= 2}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
            </div>
            {actions.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No actions configured.</p>
            )}
            {actions.map((a, i) => (
              <StageActionEditor
                key={i}
                action={a}
                index={i}
                allStages={allStages}
                currentStageKey={stage.key}
                onChange={(u) => updateActionAt(i, u)}
                onRemove={() => removeActionAt(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function EditStagesDialog({ open, onClose, stages, onSave, isSaving, entityLabel, studentStages }: EditStagesDialogProps) {
  const showStudentMapping = !!studentStages && (stages[0]?.entityType === "application");
  const [localStages, setLocalStages] = useState<PipelineStage[]>([]);
  const [error, setError] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setLocalStages(stages.map(s => ({ ...s })));
      setError("");
      setEditIndex(null);
    }
  }, [open]);

  function addStage() {
    const order = localStages.length;
    const key = `stage_${Date.now()}`;
    setLocalStages([...localStages, {
      entityType: stages[0]?.entityType || "lead",
      key,
      label: "",
      sortOrder: order,
      variant: null,
      color: "#3B82F6",
      isNotesMandatory: false,
      canAttachFile: false,
      maxFiles: 1,
      isFileUploadMandatory: false,
      canGoBack: true,
      isCaseClose: false,
      countries: null,
      uploadPermissionLevel: "none",
      tracksOfferExpiry: false,
      requiresValidUntil: false,
      commissionFinanceStatus: null,
      serviceFeeFinanceStatus: null,
      autoCancelSiblingsOnWon: false,
    }]);
    setEditIndex(localStages.length);
  }

  function removeStage(index: number) {
    if (localStages.length <= 1) {
      setError("At least one stage is required");
      return;
    }
    setLocalStages(localStages.filter((_, i) => i !== index));
    if (editIndex === index) setEditIndex(null);
    else if (editIndex !== null && editIndex > index) setEditIndex(editIndex - 1);
  }

  function updateStageAtIndex(index: number, updated: PipelineStage) {
    setLocalStages(prev => prev.map((s, i) => i === index ? updated : s));
    setError("");
  }

  function moveStage(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= localStages.length) return;
    const arr = [...localStages];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setLocalStages(arr);
    if (editIndex === index) setEditIndex(newIndex);
    else if (editIndex === newIndex) setEditIndex(index);
  }

  async function handleSave() {
    const emptyLabels = localStages.filter(s => !s.label.trim());
    if (emptyLabels.length > 0) {
      setError("All stages need a label");
      return;
    }
    const emptyKeys = localStages.filter(s => !s.key.trim());
    if (emptyKeys.length > 0) {
      setError("All stages need a key");
      return;
    }
    const keys = localStages.map(s => s.key);
    if (new Set(keys).size !== keys.length) {
      setError("Duplicate keys are not allowed");
      return;
    }
    try {
      await onSave(localStages.map((s, i) => ({ ...s, sortOrder: i })));
      toast({ title: "Pipeline stages saved" });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save stages", variant: "destructive" });
    }
  }

  const editingStage = editIndex !== null ? localStages[editIndex] : null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {editingStage ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditIndex(null)}
                  className="p-1 rounded hover:bg-muted"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                Edit Stage: {editingStage.label || "New Stage"}
              </div>
            ) : (
              `${entityLabel} Pipeline Stages`
            )}
          </DialogTitle>
        </DialogHeader>

        {editingStage && editIndex !== null ? (
          <div className="flex-1 overflow-y-auto py-2 pr-1">
            <StageEditForm
              stage={editingStage}
              onChange={updated => updateStageAtIndex(editIndex, updated)}
              allStages={localStages}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1">
            {localStages.map((stage, idx) => (
              <div key={idx} className="flex items-center gap-2 group">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveStage(idx, "up")}
                    disabled={idx === 0}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"
                  >
                    <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 5l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStage(idx, "down")}
                    disabled={idx === localStages.length - 1}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-20"
                  >
                    <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
                  </button>
                </div>
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${getVariantDot(stage.variant)}`} />
                <Input
                  value={stage.label}
                  onChange={e => updateStageAtIndex(idx, { ...stage, label: e.target.value })}
                  className="h-8 text-sm flex-1"
                  placeholder="Stage name"
                />
                <Input
                  value={stage.key}
                  onChange={e => {
                    const newKey = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
                    updateStageAtIndex(idx, { ...stage, key: newKey });
                  }}
                  className="h-8 text-xs font-mono w-24 shrink-0"
                  placeholder="key"
                  readOnly={!!stage.id}
                  title={stage.id ? "Key cannot be changed for existing stages" : ""}
                />
                <Select value={stage.variant || "none"} onValueChange={v => updateStageAtIndex(idx, { ...stage, variant: v === "none" ? null : v })}>
                  <SelectTrigger className="h-8 w-24 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VARIANT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${opt.dotClass}`} />
                          <span className="text-xs">{opt.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {showStudentMapping && (
                  <Select
                    value={stage.mappedStudentStageKey || "__none__"}
                    onValueChange={v => updateStageAtIndex(idx, { ...stage, mappedStudentStageKey: v === "__none__" ? null : v })}
                  >
                    <SelectTrigger
                      className="h-8 w-32 text-xs shrink-0"
                      title="When the application reaches this stage, the linked student's status is set to this value"
                    >
                      <SelectValue placeholder="→ Student" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-xs text-muted-foreground">— No mapping —</span>
                      </SelectItem>
                      {(studentStages || []).map(ss => (
                        <SelectItem key={ss.key} value={ss.key}>
                          <span className="text-xs">→ {ss.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button
                  type="button"
                  onClick={() => setEditIndex(idx)}
                  className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  title="Edit stage details"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStage(idx)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t">
          {editingStage ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditIndex(null)} className="gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to List
              </Button>
              <Button onClick={() => setEditIndex(null)}>
                <Check className="h-3.5 w-3.5 mr-1.5" /> Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={addStage} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Stage
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  <Check className="h-3.5 w-3.5 mr-1.5" />{isSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
