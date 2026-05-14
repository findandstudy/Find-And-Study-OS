const FLAG_CDN = "https://flagcdn.com";

interface CountryFlagProps {
  code: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  className?: string;
  rounded?: boolean;
  alt?: string;
}

const SIZES = {
  sm: { w: 16, h: 12, cls: "w-4 h-3" },
  md: { w: 20, h: 15, cls: "w-5 h-[15px]" },
  lg: { w: 24, h: 18, cls: "w-6 h-[18px]" },
  xl: { w: 32, h: 24, cls: "w-8 h-6" },
  "2xl": { w: 64, h: 48, cls: "w-16 h-12" },
  "3xl": { w: 108, h: 81, cls: "w-[108px] h-[81px]" },
};

export function CountryFlag({ code, size = "md", className = "", rounded = false, alt }: CountryFlagProps) {
  if (!code) return null;
  const lc = code.toLowerCase();
  const s = SIZES[size];
  return (
    <img
      src={`${FLAG_CDN}/${s.w}x${s.h}/${lc}.png`}
      srcSet={`${FLAG_CDN}/${s.w * 2}x${s.h * 2}/${lc}.png 2x`}
      alt={alt ?? code.toUpperCase()}
      className={`inline-block ${rounded ? "rounded-md" : "rounded-[2px]"} object-cover shadow-sm ${s.cls} ${className}`}
      loading="lazy"
    />
  );
}

export function countryCodeFromEmoji(emoji: string): string | null {
  const codePoints = [...emoji]
    .map(c => c.codePointAt(0))
    .filter((cp): cp is number => cp !== undefined && cp >= 0x1F1E6 && cp <= 0x1F1FF);
  if (codePoints.length !== 2) return null;
  return String.fromCharCode(codePoints[0] - 0x1F1E6 + 65, codePoints[1] - 0x1F1E6 + 65);
}
