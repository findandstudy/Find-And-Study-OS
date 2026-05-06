import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X, Check } from "lucide-react";

interface MultiSelectFilterProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  className?: string;
  searchable?: boolean;
  dropDirection?: "up" | "down" | "auto";
}

export function MultiSelectFilter({ values, onChange, options, placeholder, className = "", searchable = true, dropDirection = "auto" }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openUp, setOpenUp] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (popRef.current && popRef.current.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    function update() {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = dropDirection === "up" || (dropDirection === "auto" && spaceBelow < 300);
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
  }, [open, dropDirection]);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    onChange(values.includes(val) ? values.filter(v => v !== val) : [...values, val]);
  };

  const displayText = values.length === 0
    ? placeholder
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label || values[0])
      : `${values.length} selected`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-between w-full h-9 px-3 rounded-lg border text-sm transition-colors ${
          values.length > 0
            ? "bg-primary/10 border-primary/30 hover:bg-primary/15"
            : "border-input bg-background hover:bg-accent/50"
        }`}
      >
        <span className={`truncate text-left ${values.length === 0 ? "text-muted-foreground" : "text-primary font-medium"}`}>
          {displayText}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {values.length > 0 && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onChange([]); }}
              className="hover:text-destructive transition-colors"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: "absolute",
            top: pos.top,
            left: pos.left,
            width: Math.max(pos.width, 180),
            transform: openUp ? "translateY(calc(-100% - 4px))" : "translateY(4px)",
          }}
          className="z-[1000] bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95"
        >
          {searchable && options.length > 6 && (
            <div className="p-2 border-b border-border">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full h-7 px-2 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">No results</div>
            ) : (
              filtered.map(opt => {
                const selected = values.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs rounded-md transition-colors text-left ${
                      selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent text-foreground"
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      selected ? "bg-primary border-primary" : "border-muted-foreground/40"
                    }`}>
                      {selected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {values.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); }}
                className="w-full px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive rounded-md hover:bg-accent transition-colors text-left"
              >
                Clear all
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
