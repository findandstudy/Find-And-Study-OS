import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, AlertCircle, Pencil, ArrowLeft } from "lucide-react";
import type { PipelineStage, StageAction, StageActionType } from "@/hooks/use-pipeline-stages";
import { useToast } from "@/hooks/use-toast";

type ActionTypeOrNone = StageActionType | "none";
const ACTION_TYPE_OPTIONS: { value: ActionTypeOrNone; label: string; defaultLabel: string; defaultColor: string }[] = [
  { value: "none", label: "Yok", defaultLabel: "", defaultColor: "#3b82f6" },
  { value: "upload", label: "Belge Yükle", defaultLabel: "Yükle", defaultColor: "#3b82f6" },
  { value: "download", label: "Belge İndir", defaultLabel: "İndir", defaultColor: "#10b981" },
  { value: "missing_docs", label: "Eksik Belgeler", defaultLabel: "Eksik Belgeler", defaultColor: "#f59e0b" },
];

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
  const showDocName = action.type === "upload" || action.type === "download";
  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full border"
          style={{ backgroundColor: action.color || typeOpt?.defaultColor || "#3b82f6" }}
        />
        <span className="text-sm font-medium flex-1">Buton {index + 1}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} title="Sil">
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Aksiyon tipi</Label>
        <Select
          value={action.type}
          onValueChange={(v) => {
            if (v === "none") { onRemove(); return; }
            const opt = ACTION_TYPE_OPTIONS.find((o) => o.value === v);
            onChange({
              ...action,
              type: v as StageActionType,
              label: action.label || opt?.defaultLabel || null,
              color: action.color || opt?.defaultColor || null,
            });
          }}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTION_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Buton üzerinde görünecek yazı</Label>
        <div className="flex items-center gap-2">
          <Input
            value={action.label || ""}
            onChange={(e) => onChange({ ...action, label: e.target.value })}
            placeholder={typeOpt?.defaultLabel || "Buton"}
            className="h-9 flex-1"
            maxLength={32}
          />
          <input
            type="color"
            value={action.color || typeOpt?.defaultColor || "#3b82f6"}
            onChange={(e) => onChange({ ...action, color: e.target.value.toLowerCase() })}
            className="h-9 w-10 rounded border cursor-pointer p-0.5"
            title="Buton rengi"
          />
        </div>
      </div>

      {showDocName && (
        <div className="space-y-1.5">
          <Label className="text-xs">Belge adı</Label>
          <Input
            value={action.documentName || ""}
            onChange={(e) => onChange({ ...action, documentName: e.target.value })}
            placeholder={action.type === "upload" ? "örn. Teklif Mektubu" : "indirilecek belgenin adı"}
            className="h-9"
            maxLength={64}
          />
          <p className="text-[11px] text-muted-foreground">
            {action.type === "upload"
              ? "Yüklenen dosya bu adla kaydedilir."
              : "Bu adla eşleşen belge indirilir."}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">İşlem bittiğinde aşamayı değiştir</Label>
        <Select
          value={action.targetStageKey || "__none__"}
          onValueChange={(v) => onChange({ ...action, targetStageKey: v === "__none__" ? null : v })}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Değiştirme</SelectItem>
            {targetOptions.map((s) => (
              <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  { value: "won", label: "Kazanıldı", dotClass: "bg-emerald-500" },
  { value: "partial_won", label: "Kısmi Kazanım", dotClass: "bg-amber-500" },
  { value: "lost", label: "Kaybedildi", dotClass: "bg-rose-500" },
  { value: "none_finance", label: "Yok", dotClass: "bg-gray-300" },
];

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card">
      <header className="px-4 py-2.5 border-b bg-muted/30 rounded-t-lg">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </header>
      <div className="p-4 space-y-4">
        {children}
      </div>
    </section>
  );
}

function getVariantDot(variant: string | null | undefined) {
  const opt = VARIANT_OPTIONS.find(v => v.value === (variant || "none"));
  return opt?.dotClass || "bg-muted-foreground/40";
}

function RadioGroup({ label, value, onChange, required }: { label: string; value: boolean; onChange: (v: boolean) => void; required?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm font-medium flex-1">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="flex items-center gap-4 shrink-0">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={label}
            checked={!value}
            onChange={() => onChange(false)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">Hayır</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={label}
            checked={value}
            onChange={() => onChange(true)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm">Evet</span>
        </label>
      </div>
    </div>
  );
}

const UPLOAD_PERMISSION_OPTIONS = [
  { value: "none", label: "Yok — yükleme kapalı" },
  { value: "admin_only", label: "Sadece yönetici" },
  { value: "staff_only", label: "Tüm personel" },
  { value: "staff_and_agent", label: "Personel + Acenteler" },
  { value: "everyone", label: "Herkes (Personel + Acente + Öğrenci)" },
];

const FINANCE_STATUS_OPTIONS = [
  { value: "auto", label: "Otomatik (Finans Kategorisinden)" },
  { value: "potential", label: "Potansiyel" },
  { value: "confirmed", label: "Onaylı" },
  { value: "excluded", label: "Hariç" },
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
    const newAction: StageAction = {
      type: opt.value as StageActionType,
      label: opt.defaultLabel,
      documentName: null,
      color: opt.defaultColor,
      // "Don't change" by default — admin opts in to a transition.
      targetStageKey: null,
      requiredDocTypes: [],
    };
    onChange({ ...stage, actions: [...actions, newAction] });
  }
  return (
    <div className="space-y-4">
      <FormSection title="Temel Bilgiler">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Aşama Adı<span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              value={stage.label}
              onChange={e => onChange({ ...stage, label: e.target.value })}
              placeholder="örn. Başvuru Alındı"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Renk<span className="text-destructive ml-0.5">*</span>
            </Label>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={stage.color || "#3B82F6"}
                onChange={e => onChange({ ...stage, color: e.target.value })}
                className="w-9 h-9 rounded border cursor-pointer p-0.5"
              />
              <Input
                value={stage.color || "#3B82F6"}
                onChange={e => onChange({ ...stage, color: e.target.value })}
                placeholder="#3B82F6"
                className="h-9 w-24 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Finans Kategorisi</Label>
          <Select
            value={stage.variant || "none"}
            onValueChange={v => onChange({ ...stage, variant: v === "none" ? null : v })}
          >
            <SelectTrigger className="w-full h-9">
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
          <p className="text-[11px] text-muted-foreground">
            Kazanıldı = kesin komisyon/servis ücreti. Kısmi Kazanım = potansiyel. Yok = finanstan hariç tutulur.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Ülkeler</Label>
          <Input
            value={stage.countries || ""}
            onChange={e => onChange({ ...stage, countries: e.target.value || null })}
            placeholder="örn. Türkiye, Almanya, ABD (virgülle ayırın)"
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            Sadece belirli ülkeler için geçerliyse bu alanı doldurun.
          </p>
        </div>
      </FormSection>

      <FormSection title="Davranış Kuralları">
        <RadioGroup
          label="Notlar zorunlu mu?"
          value={!!stage.isNotesMandatory}
          onChange={v => onChange({ ...stage, isNotesMandatory: v })}
          required
        />
        <RadioGroup
          label="Önceki aşamaya dönülebilir mi?"
          value={stage.canGoBack !== false}
          onChange={v => onChange({ ...stage, canGoBack: v })}
          required
        />
        <RadioGroup
          label="Dosya kapatma aşaması mı?"
          value={!!stage.isCaseClose}
          onChange={v => onChange({ ...stage, isCaseClose: v })}
          required
        />
      </FormSection>

      <FormSection title="Dosya Ekleri">
        <RadioGroup
          label="Dosya eklenebilir mi?"
          value={!!stage.canAttachFile}
          onChange={v => onChange({ ...stage, canAttachFile: v, ...(v ? {} : { isFileUploadMandatory: false }) })}
        />
        {stage.canAttachFile && (
          <div className="ml-2 border-l-2 border-primary/30 pl-4 space-y-4">
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  En fazla dosya sayısı<span className="text-destructive ml-0.5">*</span>
                </Label>
                <Select
                  value={String(stage.maxFiles || 1)}
                  onValueChange={v => onChange({ ...stage, maxFiles: parseInt(v) })}
                >
                  <SelectTrigger className="w-full h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 10, 20].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <RadioGroup
              label="Dosya yüklemek zorunlu mu?"
              value={!!stage.isFileUploadMandatory}
              onChange={v => onChange({ ...stage, isFileUploadMandatory: v })}
              required
            />
          </div>
        )}
      </FormSection>

      {isApplicationStage && (
        <>
          <FormSection title="Başvuru Ayarları">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Belge yükleme yetkisi</Label>
              <Select
                value={stage.uploadPermissionLevel || "none"}
                onValueChange={v => onChange({ ...stage, uploadPermissionLevel: v })}
              >
                <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UPLOAD_PERMISSION_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Bu aşamada kim belge yükleyebilir. "Yok" seçilirse aşama belge panelinde görünmez.
              </p>
            </div>

            <RadioGroup
              label="Teklif son tarihi takip edilsin mi?"
              value={!!stage.tracksOfferExpiry}
              onChange={v => onChange({ ...stage, tracksOfferExpiry: v, ...(v ? {} : { requiresValidUntil: false }) })}
            />
            {stage.tracksOfferExpiry && (
              <div className="ml-2 border-l-2 border-primary/30 pl-4">
                <RadioGroup
                  label="Geçerlilik tarihi zorunlu mu?"
                  value={!!stage.requiresValidUntil}
                  onChange={v => onChange({ ...stage, requiresValidUntil: v })}
                />
              </div>
            )}

            <RadioGroup
              label="Bu aşamaya gelince diğer başvurular otomatik iptal edilsin mi?"
              value={!!stage.autoCancelSiblingsOnWon}
              onChange={v => onChange({ ...stage, autoCancelSiblingsOnWon: v })}
            />

            {/* Task #187 — when every catalog-based missing-doc request on
                this stage is fulfilled, auto-advance the application to
                the selected stage. */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Eksik belgeler tamamlanınca geçilecek aşama
              </Label>
              <Select
                value={(() => {
                  const k = stage.missingDocsFulfilledTargetStageKey;
                  if (k) return k;
                  const id = stage.missingDocsFulfilledTargetStageId;
                  if (id) {
                    const found = allStages.find((s) => s.id === id);
                    if (found?.key) return found.key;
                  }
                  return "none";
                })()}
                onValueChange={(v) => onChange({
                  ...stage,
                  missingDocsFulfilledTargetStageKey: v === "none" ? null : v,
                })}
              >
                <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Değişme —</SelectItem>
                  {allStages
                    .filter((s) => s.entityType === "application" && s.key !== stage.key && !!s.key)
                    .map((s) => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Bu aşamadaki tüm katalog tabanlı eksik belge talepleri öğrenci tarafından karşılandığında başvuru otomatik olarak seçili aşamaya geçer. Özel (serbest metin) talepler bu hesaba dahil değildir.
              </p>
            </div>
          </FormSection>

          <FormSection
            title="Finans Durumu Atama"
            description="Bu aşamaya ulaşıldığında komisyon ve servis ücreti için finans durumu otomatik atanır."
          >
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Komisyon finans durumu</Label>
              <Select
                value={stage.commissionFinanceStatus || "auto"}
                onValueChange={v => onChange({ ...stage, commissionFinanceStatus: v === "auto" ? null : v })}
              >
                <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FINANCE_STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Servis ücreti finans durumu</Label>
              <Select
                value={stage.serviceFeeFinanceStatus || "auto"}
                onValueChange={v => onChange({ ...stage, serviceFeeFinanceStatus: v === "auto" ? null : v })}
              >
                <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FINANCE_STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FormSection>

          <FormSection
            title="Aşama Aksiyonları"
            description="Bu aşamadaki başvurular için Başvurular listesinde en fazla 2 buton görünür. Buton tamamlandığında başvuru seçili hedef aşamaya geçer."
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {actions.length} / 2 buton tanımlı
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 h-8"
                onClick={addAction}
                disabled={actions.length >= 2}
              >
                <Plus className="w-3.5 h-3.5" /> Buton Ekle
              </Button>
            </div>
            {actions.length === 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground italic border border-dashed rounded-md">
                Henüz aksiyon tanımlanmadı.
              </div>
            )}
            <div className="space-y-3">
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
          </FormSection>
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
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="text-base">
            {editingStage ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditIndex(null)}
                  className="p-1 rounded hover:bg-muted"
                  title="Listeye dön"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold">Aşamayı Düzenle:</span>
                <span className="text-muted-foreground font-normal truncate">
                  {editingStage.label || "Yeni Aşama"}
                </span>
              </div>
            ) : (
              `${entityLabel} Pipeline Aşamaları`
            )}
          </DialogTitle>
        </DialogHeader>

        {editingStage && editIndex !== null ? (
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <StageEditForm
              stage={editingStage}
              onChange={updated => updateStageAtIndex(editIndex, updated)}
              allStages={localStages}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 px-6 py-4">
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

        <div className="px-6 pb-5 pt-4 border-t shrink-0 space-y-3 bg-muted/20">
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex items-center justify-between">
            {editingStage ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditIndex(null)} className="gap-1.5">
                  <ArrowLeft className="w-3.5 h-3.5" /> Listeye Dön
                </Button>
                <Button onClick={() => setEditIndex(null)}>
                  <Check className="h-3.5 w-3.5 mr-1.5" /> Tamam
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={addStage} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Aşama Ekle
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>İptal</Button>
                  <Button onClick={handleSave} disabled={isSaving}>
                    <Check className="h-3.5 w-3.5 mr-1.5" />{isSaving ? "Kaydediliyor..." : "Kaydet"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
