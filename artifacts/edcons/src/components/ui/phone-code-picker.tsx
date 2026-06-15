import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/CountryFlag";
import { PHONE_CODES } from "@/lib/nationalities";

const regionNames = typeof Intl !== "undefined" && (Intl as any).DisplayNames
  ? new (Intl as any).DisplayNames(["en"], { type: "region" })
  : null;

function countryName(iso: string): string {
  try {
    return regionNames?.of(iso) || iso;
  } catch {
    return iso;
  }
}

type Item = { code: string; iso: string; name: string };

const ALL_ITEMS: Item[] = PHONE_CODES
  .map(p => ({ code: p.code, iso: p.country, name: countryName(p.country) }))
  .sort((a, b) => parseInt(a.code.replace("+", ""), 10) - parseInt(b.code.replace("+", ""), 10));

interface Props {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  triggerClassName?: string;
}

export function PhoneCodePicker({ value, onChange, className, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => {
    if (!value) return null;
    if (pickedIso) {
      const m = ALL_ITEMS.find(i => i.iso === pickedIso && i.code === value);
      if (m) return m;
    }
    return ALL_ITEMS.find(i => i.code === value) || null;
  }, [value, pickedIso]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const cleanQ = q.replace(/^\+/, "");
    return ALL_ITEMS.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.iso.toLowerCase().includes(q) ||
      i.code.replace(/^\+/, "").startsWith(cleanQ)
    );
  }, [search]);

  function pick(item: Item) {
    setPickedIso(item.iso);
    onChange(item.code);
    setOpen(false);
  }

  function renderItem(item: Item) {
    const isSelected = !!selected && item.code === value && item.iso === selected.iso;
    return (
      <button
        key={`${item.iso}-${item.code}`}
        type="button"
        onClick={() => pick(item)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-accent/50"
        )}
      >
        <CountryFlag code={item.iso} size="sm" />
        <span className="flex-1 truncate">{item.name}</span>
        <span className="text-muted-foreground font-mono text-xs">{item.code}</span>
        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
      </button>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 h-10 rounded-xl border border-input bg-background px-2.5 text-sm hover:bg-accent/40 transition-colors w-full",
          triggerClassName
        )}
      >
        {selected ? (
          <>
            <CountryFlag code={selected.iso} size="sm" />
            <span className="text-foreground font-mono text-xs flex-1 text-left">{selected.code}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs flex-1 text-left">Code</span>
        )}
        <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-[300px] rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country or code…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground" tabIndex={-1}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {filtered ? (
              filtered.length === 0
                ? <div className="py-6 text-center text-sm text-muted-foreground">No results</div>
                : filtered.map(renderItem)
            ) : (
              ALL_ITEMS.map(renderItem)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
