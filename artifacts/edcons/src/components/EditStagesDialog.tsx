import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Check, GripVertical, AlertCircle } from "lucide-react";
import type { PipelineStage } from "@/hooks/use-pipeline-stages";
import { useToast } from "@/hooks/use-toast";

interface EditStagesDialogProps {
  open: boolean;
  onClose: () => void;
  stages: PipelineStage[];
  onSave: (stages: PipelineStage[]) => Promise<void>;
  isSaving: boolean;
  entityLabel: string;
}

export function EditStagesDialog({ open, onClose, stages, onSave, isSaving, entityLabel }: EditStagesDialogProps) {
  const [localStages, setLocalStages] = useState<PipelineStage[]>([]);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setLocalStages(stages.map(s => ({ ...s })));
      setError("");
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
    }]);
  }

  function removeStage(index: number) {
    if (localStages.length <= 1) {
      setError("At least one stage is required");
      return;
    }
    setLocalStages(localStages.filter((_, i) => i !== index));
  }

  function updateStage(index: number, field: keyof PipelineStage, value: string) {
    setLocalStages(prev => prev.map((s, i) => {
      if (i !== index) return s;
      if (field === "key") {
        return { ...s, key: value.toLowerCase().replace(/[^a-z0-9_]/g, "_") };
      }
      if (field === "variant") {
        return { ...s, variant: value === "none" ? null : value };
      }
      return { ...s, [field]: value };
    }));
    setError("");
  }

  function moveStage(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= localStages.length) return;
    const arr = [...localStages];
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setLocalStages(arr);
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

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{entityLabel} Pipeline Stages</DialogTitle>
        </DialogHeader>
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
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                stage.variant === "won" ? "bg-emerald-500" :
                stage.variant === "lost" ? "bg-rose-500" :
                "bg-muted-foreground/40"
              }`} />
              <Input
                value={stage.label}
                onChange={e => updateStage(idx, "label", e.target.value)}
                className="h-8 text-sm flex-1"
                placeholder="Stage name"
              />
              <Input
                value={stage.key}
                onChange={e => updateStage(idx, "key", e.target.value)}
                className="h-8 text-xs font-mono w-24 shrink-0"
                placeholder="key"
                readOnly={!!stage.id}
                title={stage.id ? "Key cannot be changed for existing stages" : ""}
              />
              <Select value={stage.variant || "none"} onValueChange={v => updateStage(idx, "variant", v)}>
                <SelectTrigger className="h-8 w-20 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
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
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t">
          <Button variant="outline" size="sm" onClick={addStage} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add Stage
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              <Check className="h-3.5 w-3.5 mr-1.5" />{isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
