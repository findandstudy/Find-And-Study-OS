import { translateUi, useUiLanguage, UiText } from "@/lib/ui-localization";
import { useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/components/ui/button";
import { Trash2, UserPlus, ArrowRightLeft, MessageCircle } from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface StageOption {
  key: string;
  label: string;
}

interface StaffOption {
  id: number;
  name: string;
}

interface BulkActionBarProps {
  selectedCount: number;
  onDelete?: () => void;
  onAssign: (userId: number) => void;
  onMove: (stageKey: string) => void;
  onSendMessage?: () => void;
  stages: StageOption[];
  staffUsers: StaffOption[];
  entityLabel?: string;
  moveLabel?: string;
  assignPrompt?: string;
  movePrompt?: string;
  disabled?: boolean;
}

export function BulkActionBar({
  selectedCount,
  onDelete,
  onAssign,
  onMove,
  onSendMessage,
  stages,
  staffUsers,
  entityLabel = "items",
  moveLabel = "Move Stage",
  assignPrompt,
  movePrompt,
  disabled = false,
}: BulkActionBarProps) {
  const { lang: uiLanguage } = useUiLanguage();
  const { t, lang } = useI18n();
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <span className="me-1 text-sm font-medium text-muted-foreground" aria-live="polite">
        {t("common.selectedCount", { n: new Intl.NumberFormat(lang).format(selectedCount) })}
      </span>

      {onDelete && (
        <Button variant="destructive" size="sm" className="rounded-full h-8 gap-1.5" onClick={onDelete} disabled={disabled}>
          <Trash2 className="w-3.5 h-3.5" /><UiText text={"Delete"} /></Button>
      )}

      {onSendMessage && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full h-8 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          onClick={onSendMessage}
          disabled={disabled}
        >
          <MessageCircle className="w-3.5 h-3.5" /> {translateUi(uiLanguage, "Send Template")} </Button>
      )}

      {staffUsers.length > 0 && (
        <Popover open={assignOpen} onOpenChange={setAssignOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled} className="rounded-full h-8 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50">
              <UserPlus className="w-3.5 h-3.5" /> {translateUi(uiLanguage, "Assign")} </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <p className="text-xs text-muted-foreground mb-2 px-1">{assignPrompt ?? [translateUi(uiLanguage, "Assign"), selectedCount, entityLabel, translateUi(uiLanguage, "to:")].join(" ")}</p>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {staffUsers.map(u => (
                <button
                  key={u.id}
                  disabled={disabled}
                  className="w-full text-start px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                  onClick={() => { onAssign(u.id); setAssignOpen(false); }}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {stages.length > 0 && (
        <Popover open={moveOpen} onOpenChange={setMoveOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled} className="rounded-full h-8 gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50">
              <ArrowRightLeft className="w-3.5 h-3.5" /> {moveLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="end">
            <p className="text-xs text-muted-foreground mb-2 px-1">{movePrompt ?? [moveLabel, translateUi(uiLanguage, "for"), selectedCount, entityLabel].join(" ")}</p>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {stages.map(s => (
                <button
                  key={s.key}
                  disabled={disabled}
                  className="w-full text-start px-2 py-1.5 text-sm rounded hover:bg-muted transition-colors"
                  onClick={() => { onMove(s.key); setMoveOpen(false); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
