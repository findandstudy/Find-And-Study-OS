import * as React from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountryFlag } from "@/components/CountryFlag";

const COUNTRY_CODES = [
  { code: "TR", dial: "+90", name: "Turkey" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
  { code: "DE", dial: "+49", name: "Germany" },
  { code: "FR", dial: "+33", name: "France" },
  { code: "IT", dial: "+39", name: "Italy" },
  { code: "ES", dial: "+34", name: "Spain" },
  { code: "NL", dial: "+31", name: "Netherlands" },
  { code: "BE", dial: "+32", name: "Belgium" },
  { code: "AT", dial: "+43", name: "Austria" },
  { code: "CH", dial: "+41", name: "Switzerland" },
  { code: "SE", dial: "+46", name: "Sweden" },
  { code: "NO", dial: "+47", name: "Norway" },
  { code: "DK", dial: "+45", name: "Denmark" },
  { code: "FI", dial: "+358", name: "Finland" },
  { code: "PL", dial: "+48", name: "Poland" },
  { code: "CZ", dial: "+420", name: "Czech Republic" },
  { code: "RO", dial: "+40", name: "Romania" },
  { code: "HU", dial: "+36", name: "Hungary" },
  { code: "GR", dial: "+30", name: "Greece" },
  { code: "PT", dial: "+351", name: "Portugal" },
  { code: "IE", dial: "+353", name: "Ireland" },
  { code: "RU", dial: "+7", name: "Russia" },
  { code: "UA", dial: "+380", name: "Ukraine" },
  { code: "SA", dial: "+966", name: "Saudi Arabia" },
  { code: "AE", dial: "+971", name: "UAE" },
  { code: "QA", dial: "+974", name: "Qatar" },
  { code: "KW", dial: "+965", name: "Kuwait" },
  { code: "BH", dial: "+973", name: "Bahrain" },
  { code: "OM", dial: "+968", name: "Oman" },
  { code: "JO", dial: "+962", name: "Jordan" },
  { code: "LB", dial: "+961", name: "Lebanon" },
  { code: "IQ", dial: "+964", name: "Iraq" },
  { code: "SY", dial: "+963", name: "Syria" },
  { code: "EG", dial: "+20", name: "Egypt" },
  { code: "MA", dial: "+212", name: "Morocco" },
  { code: "TN", dial: "+216", name: "Tunisia" },
  { code: "DZ", dial: "+213", name: "Algeria" },
  { code: "LY", dial: "+218", name: "Libya" },
  { code: "IR", dial: "+98", name: "Iran" },
  { code: "PK", dial: "+92", name: "Pakistan" },
  { code: "AF", dial: "+93", name: "Afghanistan" },
  { code: "IN", dial: "+91", name: "India" },
  { code: "BD", dial: "+880", name: "Bangladesh" },
  { code: "LK", dial: "+94", name: "Sri Lanka" },
  { code: "NP", dial: "+977", name: "Nepal" },
  { code: "CN", dial: "+86", name: "China" },
  { code: "JP", dial: "+81", name: "Japan" },
  { code: "KR", dial: "+82", name: "South Korea" },
  { code: "ID", dial: "+62", name: "Indonesia" },
  { code: "MY", dial: "+60", name: "Malaysia" },
  { code: "TH", dial: "+66", name: "Thailand" },
  { code: "VN", dial: "+84", name: "Vietnam" },
  { code: "PH", dial: "+63", name: "Philippines" },
  { code: "SG", dial: "+65", name: "Singapore" },
  { code: "AU", dial: "+61", name: "Australia" },
  { code: "NZ", dial: "+64", name: "New Zealand" },
  { code: "CA", dial: "+1", name: "Canada" },
  { code: "MX", dial: "+52", name: "Mexico" },
  { code: "BR", dial: "+55", name: "Brazil" },
  { code: "AR", dial: "+54", name: "Argentina" },
  { code: "CL", dial: "+56", name: "Chile" },
  { code: "CO", dial: "+57", name: "Colombia" },
  { code: "PE", dial: "+51", name: "Peru" },
  { code: "NG", dial: "+234", name: "Nigeria" },
  { code: "GH", dial: "+233", name: "Ghana" },
  { code: "KE", dial: "+254", name: "Kenya" },
  { code: "ZA", dial: "+27", name: "South Africa" },
  { code: "ET", dial: "+251", name: "Ethiopia" },
  { code: "TZ", dial: "+255", name: "Tanzania" },
  { code: "AZ", dial: "+994", name: "Azerbaijan" },
  { code: "GE", dial: "+995", name: "Georgia" },
  { code: "KZ", dial: "+7", name: "Kazakhstan" },
  { code: "UZ", dial: "+998", name: "Uzbekistan" },
  { code: "TM", dial: "+993", name: "Turkmenistan" },
  { code: "KG", dial: "+996", name: "Kyrgyzstan" },
  { code: "IL", dial: "+972", name: "Israel" },
  { code: "CY", dial: "+357", name: "Cyprus" },
];

function parsePhone(fullPhone: string): { dialCode: string; number: string } {
  if (!fullPhone) return { dialCode: "+90", number: "" };
  const cleaned = fullPhone.replace(/\s+/g, "");
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (cleaned.startsWith(c.dial)) {
      return { dialCode: c.dial, number: cleaned.slice(c.dial.length) };
    }
  }
  return { dialCode: "+90", number: cleaned.replace(/^\+/, "") };
}

interface PhoneInputProps {
  value: string;
  onChange: (fullPhone: string) => void;
  className?: string;
}

export function PhoneInput({ value, onChange, className }: PhoneInputProps) {
  const parsed = useMemo(() => parsePhone(value), [value]);
  const [dialCode, setDialCode] = useState(parsed.dialCode);
  const [number, setNumber] = useState(parsed.number);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = parsePhone(value);
    setDialCode(p.dialCode);
    setNumber(p.number);
  }, [value]);

  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [open]);

  const selectedCountry = COUNTRY_CODES.find(c => c.dial === dialCode) || COUNTRY_CODES[0];

  const filtered = search
    ? COUNTRY_CODES.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.dial.includes(search) ||
        c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRY_CODES;

  function handleDialChange(dial: string) {
    setDialCode(dial);
    setOpen(false);
    onChange(`${dial}${number}`);
  }

  function handleNumberChange(num: string) {
    const cleaned = num.replace(/[^\d]/g, "");
    setNumber(cleaned);
    onChange(`${dialCode}${cleaned}`);
  }

  return (
    <div ref={containerRef} className={cn("relative flex", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 h-9 rounded-l-xl border border-r-0 border-input bg-secondary/40 hover:bg-secondary/60 transition-colors text-sm shrink-0"
      >
        <CountryFlag code={selectedCountry.code} size="sm" />
        <span className="text-muted-foreground font-mono text-xs">{dialCode}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
      <input
        type="tel"
        value={number}
        onChange={e => handleNumberChange(e.target.value)}
        placeholder="555 123 4567"
        className="flex h-9 w-full rounded-r-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-[280px] rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground mr-1.5 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search country…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-[240px] overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">No results</div>
            )}
            {filtered.map(c => (
              <button
                key={`${c.code}-${c.dial}`}
                type="button"
                onClick={() => handleDialChange(c.dial)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                  dialCode === c.dial && c.code === selectedCountry.code && "bg-accent/50"
                )}
              >
                <CountryFlag code={c.code} size="sm" />
                <span className="flex-1 text-left truncate">{c.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{c.dial}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
