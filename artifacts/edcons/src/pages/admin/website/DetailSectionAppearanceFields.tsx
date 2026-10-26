import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DetailSectionPresentation } from "@/lib/website/detailLayoutContract";

type Copy = (en: string, tr: string) => string;
type PresentationKey = keyof DetailSectionPresentation;

const clean = (value: DetailSectionPresentation): DetailSectionPresentation =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "")) as DetailSectionPresentation;

export function DetailSectionAppearanceFields({ value, onChange, copy, inherited = false }: {
  value: DetailSectionPresentation;
  onChange: (value: DetailSectionPresentation) => void;
  copy: Copy;
  inherited?: boolean;
}) {
  const patch = (key: PresentationKey, next: DetailSectionPresentation[PresentationKey]) =>
    onChange(clean({ ...value, [key]: next }));
  const choice = (key: PresentationKey, current: string | undefined, fallback: string, options: Array<[string, string, string]>) => (
    <div className="space-y-1.5">
      <Label>{options[0][2]}</Label>
      <Select value={current ?? fallback} onValueChange={(next) => patch(key, next === fallback ? undefined : next as never)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.slice(1).map(([option, en, tr]) => <SelectItem key={option} value={option}>{copy(en, tr)}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
  const colour = (key: "backgroundColor" | "textColor" | "accentColor" | "overlayColor", label: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input type="color" className="h-10 w-12 shrink-0 cursor-pointer p-1" value={value[key] ?? "#ffffff"} onChange={(event) => patch(key, event.target.value.toUpperCase())} aria-label={`${label} picker`} />
        <Input value={value[key] ?? ""} maxLength={7} placeholder={inherited ? copy("Inherit", "Devral") : copy("Template default", "Şablon varsayılanı")} onChange={(event) => patch(key, event.target.value.trim() || undefined)} />
        {value[key] && <Button type="button" variant="ghost" size="sm" onClick={() => patch(key, undefined)}>{copy("Clear", "Temizle")}</Button>}
      </div>
    </div>
  );
  return <div className="space-y-4 rounded-xl border p-4">
    <div className="flex items-start justify-between gap-3">
      <div><h5 className="text-sm font-semibold">{copy("Section appearance", "Bölüm görünümü")}</h5><p className="mt-1 text-xs text-muted-foreground">{inherited ? copy("Only this page and language are changed. Empty values inherit the shared template.", "Yalnız bu sayfa ve dil değişir. Boş değerler ortak şablondan devralınır.") : copy("These defaults apply to every page using this detail template.", "Bu varsayılanlar bu detay şablonunu kullanan tüm sayfalara uygulanır.")}</p></div>
      {!!Object.keys(value).length && <Button type="button" variant="outline" size="sm" onClick={() => onChange({})}><RotateCcw className="me-1 h-3.5 w-3.5" />{copy("Reset", "Sıfırla")}</Button>}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {choice("tone", value.tone, "default", [["", "", copy("Colour treatment", "Renk düzeni")], ["default", "Template default", "Şablon varsayılanı"], ["sky", "Soft blue", "Yumuşak mavi"], ["sand", "Warm sand", "Sıcak kum"], ["dark", "Dark emphasis", "Koyu vurgu"]])}
      {choice("width", value.width, "contained", [["", "", copy("Content width", "İçerik genişliği")], ["contained", "Contained", "Sınırlı"], ["wide", "Wide", "Geniş"], ["full", "Full width", "Tam genişlik"]])}
      {choice("spacing", value.spacing, "comfortable", [["", "", copy("Vertical spacing", "Dikey boşluk")], ["comfortable", "Comfortable", "Rahat"], ["compact", "Compact", "Kompakt"], ["spacious", "Spacious", "Ferah"]])}
      {choice("align", value.align, "start", [["", "", copy("Content alignment", "İçerik hizası")], ["start", "Start", "Başlangıç"], ["center", "Centred", "Ortalanmış"]])}
      {choice("minHeight", value.minHeight, "auto", [["", "", copy("Minimum height", "Minimum yükseklik")], ["auto", "Automatic", "Otomatik"], ["compact", "Compact", "Kompakt"], ["medium", "Medium", "Orta"], ["tall", "Tall", "Yüksek"]])}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{colour("backgroundColor", copy("Background colour", "Arka plan rengi"))}{colour("textColor", copy("Text colour", "Metin rengi"))}{colour("accentColor", copy("Accent colour", "Vurgu rengi"))}{colour("overlayColor", copy("Image overlay colour", "Görsel kaplama rengi"))}</div>
    <div className="space-y-1.5"><Label>{copy("Background image", "Arka plan görseli")}</Label><Input value={value.backgroundImageUrl ?? ""} placeholder="/assets/... or https://..." onChange={(event) => patch("backgroundImageUrl", event.target.value.trim() || undefined)} /><p className="text-[11px] text-muted-foreground">{copy("Use a site path or credential-free HTTPS URL.", "Site yolu veya kimlik bilgisi içermeyen HTTPS URL kullanın.")}</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      {choice("backgroundImageFit", value.backgroundImageFit, "cover", [["", "", copy("Image fit", "Görsel yerleşimi")], ["cover", "Cover", "Kapla"], ["contain", "Contain", "Sığdır"], ["auto", "Original size", "Özgün boyut"]])}
      {choice("backgroundImagePosition", value.backgroundImagePosition, "center", [["", "", copy("Image position", "Görsel konumu")], ["center", "Centre", "Orta"], ["top", "Top", "Üst"], ["bottom", "Bottom", "Alt"], ["left", "Left", "Sol"], ["right", "Right", "Sağ"]])}
      {choice("backgroundImageRepeat", value.backgroundImageRepeat, "no-repeat", [["", "", copy("Image repeat", "Görsel tekrarı")], ["no-repeat", "No repeat", "Tekrarlama"], ["repeat", "Repeat", "Tekrarla"], ["repeat-x", "Repeat horizontally", "Yatay tekrarla"], ["repeat-y", "Repeat vertically", "Dikey tekrarla"]])}
    </div>
    <div className="space-y-1.5"><div className="flex justify-between"><Label>{copy("Overlay opacity", "Kaplama opaklığı")}</Label><span className="text-xs text-muted-foreground">{value.overlayOpacity ?? 0}%</span></div><Input type="range" min={0} max={100} step={1} value={value.overlayOpacity ?? 0} onChange={(event) => patch("overlayOpacity", Number(event.target.value) || undefined)} /></div>
  </div>;
}
