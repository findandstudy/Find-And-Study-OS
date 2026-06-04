import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Check } from "lucide-react";

interface SearchableSelectProps {
  value: string;
  /** Preferred callback. `onValueChange` is accepted as an alias. */
  onChange?: (value: string) => void;
  /** Alias for `onChange` (Radix-style naming). */
  onValueChange?: (value: string) => void;
  options: { value: string; label: string; node?: ReactNode; icon?: ReactNode; group?: string }[];
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Search...",
  className = "",
  searchable = true,
  clearable = false,
  disabled = false,
}: SearchableSelectProps) {
  const emitChange = onChange ?? onValueChange ?? (() => {});
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openUp, setOpenUp] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Use "click" (not "mousedown") so that grabbing/dragging a scrollbar
    // — inside the popover or in an ancestor scroll container such as a
    // dialog body — does not dismiss the dropdown. Native scrollbar
    // interactions fire mousedown but never a click event, while real
    // outside clicks still close the menu as expected.
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (popRef.current && popRef.current.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    function update() {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = spaceBelow < 320;
      setOpenUp(up);
      setPos({
        top: up ? rect.top + window.scrollY : rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center justify-between w-full h-10 px-3 rounded-md border text-sm transition-colors ${
          disabled
            ? "border-input bg-muted/50 text-muted-foreground cursor-not-allowed"
            : "border-input bg-background hover:bg-accent/30"
        }`}
      >
        <span className={`truncate text-left ${selected ? "text-foreground" : "text-muted-foreground"}`}>
          {selected
            ? (selected.node ?? (
                <span className="inline-flex items-center gap-1.5">
                  {selected.icon}
                  {selected.label}
                </span>
              ))
            : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {clearable && value && !disabled && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); emitChange(""); }}
              className="hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            width: Math.max(pos.width, 240),
            transform: openUp ? "translateY(calc(-100% - 4px))" : "translateY(4px)",
          }}
          className="z-[1000] bg-popover border border-border rounded-md shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95"
        >
          {searchable && options.length > 6 && (
            <div className="p-2 border-b border-border">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-8 px-2 text-sm rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground text-center">No results</div>
            ) : (
              (() => {
                const groups = new Map<string, typeof filtered>();
                for (const opt of filtered) {
                  const g = opt.group || "";
                  if (!groups.has(g)) groups.set(g, []);
                  groups.get(g)!.push(opt);
                }
                return Array.from(groups.entries()).map(([group, items]) => (
                  <div key={group}>
                    {group && (
                      <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{group}</div>
                    )}
                    {items.map(opt => {
                      const isSelected = opt.value === value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { emitChange(opt.value); setOpen(false); }}
                          className={`flex items-center justify-between gap-2 w-full px-2.5 py-2 text-sm rounded-md transition-colors text-left ${
                            isSelected ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-foreground"
                          }`}
                        >
                          <span className="truncate flex-1">
                            {opt.node ?? (
                              <span className="inline-flex items-center gap-1.5">
                                {opt.icon}
                                {opt.label}
                              </span>
                            )}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ));
              })()
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
