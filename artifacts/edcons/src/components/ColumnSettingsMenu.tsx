import { ArrowDown, ArrowUp, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ColumnSettingsItem {
  id: string;
  label: string;
}

export interface ColumnSettingsMenuProps {
  columns: ColumnSettingsItem[];
  order: string[];
  hidden: string[];
  onToggle: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onReset: () => void;
  triggerLabel?: string;
  title?: string;
}

export function ColumnSettingsMenu({
  columns,
  order,
  hidden,
  onToggle,
  onMove,
  onReset,
  triggerLabel = "Sütunlar",
  title = "Sütunları Yönet",
}: ColumnSettingsMenuProps) {
  const labelOf = (id: string) => columns.find((c) => c.id === id)?.label || id;
  const visibleCount = order.filter((id) => !hidden.includes(id)).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full h-8 gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          <span>{triggerLabel}</span>
          <span className="text-xs text-muted-foreground">
            ({visibleCount}/{order.length})
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">{title}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onReset}
            title="Varsayılana sıfırla"
          >
            <RotateCcw className="h-3 w-3" /> Sıfırla
          </Button>
        </div>
        <p className="px-2 pb-2 text-[11px] text-muted-foreground leading-snug">
          Göstermek istediğiniz sütunları seçin ve okları kullanarak sıralayın. Tercihleriniz
          otomatik kaydedilir.
        </p>
        <div className="max-h-80 overflow-auto pr-1">
          {order.map((id, idx) => {
            const isHidden = hidden.includes(id);
            return (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50"
              >
                <Checkbox
                  id={`col-${id}`}
                  checked={!isHidden}
                  onCheckedChange={() => onToggle(id)}
                />
                <label
                  htmlFor={`col-${id}`}
                  className="flex-1 text-sm cursor-pointer select-none truncate"
                >
                  {labelOf(id)}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={idx === 0}
                  onClick={() => onMove(id, -1)}
                  title="Yukarı taşı"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={idx === order.length - 1}
                  onClick={() => onMove(id, 1)}
                  title="Aşağı taşı"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
