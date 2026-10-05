import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CountryFlag } from "@/components/CountryFlag";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export type StudentMatchingProfile = {
  nationalityCode?: string;
  educationCountryCode?: string;
  completedEducationLevel?: string;
  targetEducationLevel?: string;
  gradeValue?: number;
  gradeScale?: string;
  languageTest?: string;
  languageOverall?: number;
  preferredCountryCodes: string[];
  preferredFields: string[];
  selectedProgramId?: number;
};

type Country = { code: string; name: string; flagEmoji?: string | null };
type ProgramMatch = {
  id: number; name: string; universityName: string; country: string; countryCode?: string | null;
  degree?: string | null; field?: string | null; status: "compatible" | "review_required";
  reasons: Array<{ code: string; outcome: string; detail?: string }>;
};
type MatchResponse = {
  destinations: Array<{ code: string; name: string; compatible: number; reviewRequired: number }>;
  programs: ProgramMatch[];
  meta: { compatible: number; reviewRequired: number; excluded: number; truncated: boolean };
};

const copy = {
  en: {
    title: "Tell us about your study goal", intro: "We will show real catalogue options before you create an account.",
    nationality: "Nationality", education: "Completed education", target: "Target level", gradeScale: "Grade system",
    grade: "Your grade", language: "Language test", score: "Overall score", notTaken: "Not taken yet",
    find: "Find matching options", searching: "Checking the catalogue…", destinations: "Available destinations",
    programs: "Suggested programs", compatible: "Known requirements match", review: "Some requirements need checking",
    noResults: "No explainable match was found. Change an answer or continue for adviser support.",
    back: "Change answers", continue: "Continue to create account", select: "Choose", selected: "Selected",
    disclaimer: "Suggestions are not an admission guarantee. Declared grades and scores must be verified during application.",
  },
  tr: {
    title: "Eğitim hedefini tanıyalım", intro: "Hesap açmadan önce gerçek katalogdan seçenekleri göstereceğiz.",
    nationality: "Uyruk", education: "Tamamlanan eğitim", target: "Hedef seviye", gradeScale: "Not sistemi",
    grade: "Notun", language: "Dil sınavı", score: "Genel puan", notTaken: "Henüz girmedim",
    find: "Uygun seçenekleri bul", searching: "Katalog kontrol ediliyor…", destinations: "Uygun destinasyonlar",
    programs: "Önerilen programlar", compatible: "Bilinen koşullar uyumlu", review: "Bazı koşullar kontrol edilmeli",
    noResults: "Açıklanabilir bir eşleşme bulunamadı. Cevabını değiştir veya danışman desteği için devam et.",
    back: "Cevapları değiştir", continue: "Hesap oluşturmaya devam et", select: "Seç", selected: "Seçildi",
    disclaimer: "Öneriler kabul garantisi değildir. Beyan edilen not ve puanlar başvuruda doğrulanmalıdır.",
  },
} as const;

export function StudentMatchingOnboarding({ language, onComplete }: {
  language: string;
  onComplete: (profile: StudentMatchingProfile) => void;
}) {
  const c = language === "tr" ? copy.tr : copy.en;
  const [countries, setCountries] = useState<Country[]>([]);
  const [profile, setProfile] = useState<StudentMatchingProfile>({ preferredCountryCodes: [], preferredFields: [] });
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${BASE_URL}/api/public/countries`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("countries")))
      .then(payload => setCountries(Array.isArray(payload?.data) ? payload.data : []))
      .catch(error => { if (error?.name !== "AbortError") setError("Country list is temporarily unavailable."); });
    return () => controller.abort();
  }, []);

  const canSearch = Boolean(profile.nationalityCode && profile.completedEducationLevel && profile.targetEducationLevel);
  const selectedProgram = useMemo(() => result?.programs.find(program => program.id === profile.selectedProgramId), [result, profile.selectedProgramId]);

  async function findMatches() {
    if (!canSearch) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${BASE_URL}/api/public/student-registration/matches`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Matching failed");
      setResult(payload);
    } catch (error) { setError(error instanceof Error ? error.message : "Matching failed"); }
    finally { setLoading(false); }
  }

  if (result) return <div className="space-y-5" aria-live="polite">
    <div><h2 className="text-2xl font-display font-bold">{c.destinations}</h2><p className="text-sm text-muted-foreground mt-1">{c.disclaimer}</p></div>
    {result.destinations.length > 0 && <div className="flex flex-wrap gap-2">{result.destinations.map(destination => <button type="button" key={destination.code}
      aria-pressed={profile.preferredCountryCodes.includes(destination.code)}
      onClick={() => setProfile(current => ({ ...current, preferredCountryCodes: current.preferredCountryCodes.includes(destination.code) ? current.preferredCountryCodes.filter(item => item !== destination.code) : [destination.code] }))}
      className={`rounded-xl border px-3 py-2 text-sm flex items-center gap-2 ${profile.preferredCountryCodes.includes(destination.code) ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
      <CountryFlag code={destination.code} size="sm" /> {destination.name} <span className="text-xs text-muted-foreground">{destination.compatible + destination.reviewRequired}</span>
    </button>)}</div>}
    <div className="space-y-2 max-h-[310px] overflow-y-auto pr-1">
      <h3 className="font-semibold">{c.programs}</h3>
      {(() => {
        const visiblePrograms = result.programs.filter(program => profile.preferredCountryCodes.length === 0 || (program.countryCode && profile.preferredCountryCodes.includes(program.countryCode))).slice(0, 20);
        return visiblePrograms.length === 0 ? <p className="rounded-xl border p-4 text-sm text-muted-foreground">{c.noResults}</p> : visiblePrograms.map(program => <div key={program.id} className={`rounded-xl border p-3 ${profile.selectedProgramId === program.id ? "border-primary bg-primary/5" : ""}`}>
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-sm">{program.name}</p><p className="text-xs text-muted-foreground">{program.universityName} · {program.country}</p></div>
            <Button type="button" size="sm" variant={profile.selectedProgramId === program.id ? "default" : "outline"} onClick={() => setProfile(current => ({ ...current, selectedProgramId: program.id }))}>{profile.selectedProgramId === program.id ? c.selected : c.select}</Button></div>
          <p className={`text-xs mt-2 flex items-center gap-1 ${program.status === "compatible" ? "text-emerald-700" : "text-amber-700"}`}><CheckCircle2 className="h-3.5 w-3.5" />{program.status === "compatible" ? c.compatible : c.review}</p>
        </div>);
      })()}
    </div>
    <div className="grid grid-cols-2 gap-3"><Button type="button" variant="outline" onClick={() => { setResult(null); setProfile(current => ({ ...current, selectedProgramId: undefined, preferredCountryCodes: [] })); }}><ArrowLeft className="h-4 w-4 mr-2" />{c.back}</Button>
      <Button type="button" onClick={() => onComplete(profile)}>{c.continue}<ArrowRight className="h-4 w-4 ml-2" /></Button></div>
    {selectedProgram && <p className="sr-only">{selectedProgram.name} {c.selected}</p>}
  </div>;

  return <div className="space-y-5">
    <div><h2 className="text-2xl font-display font-bold">{c.title}</h2><p className="text-sm text-muted-foreground mt-1">{c.intro}</p></div>
    <div className="h-1.5 rounded-full bg-muted"><div className="h-full w-1/2 rounded-full bg-primary" /></div>
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><Label>{c.nationality}</Label><Select value={profile.nationalityCode ?? ""} onValueChange={nationalityCode => setProfile(current => ({ ...current, nationalityCode }))}><SelectTrigger className="mt-1"><SelectValue placeholder={c.nationality} /></SelectTrigger><SelectContent>{countries.map(country => <SelectItem key={country.code} value={country.code}>{country.name}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>{c.education}</Label><Select value={profile.completedEducationLevel ?? ""} onValueChange={completedEducationLevel => setProfile(current => ({ ...current, completedEducationLevel }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high_school">High school</SelectItem><SelectItem value="bachelor">Bachelor</SelectItem><SelectItem value="master">Master</SelectItem></SelectContent></Select></div>
      <div><Label>{c.target}</Label><Select value={profile.targetEducationLevel ?? ""} onValueChange={targetEducationLevel => setProfile(current => ({ ...current, targetEducationLevel }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bachelor">Bachelor</SelectItem><SelectItem value="master">Master</SelectItem><SelectItem value="doctorate">Doctorate</SelectItem><SelectItem value="diploma">Diploma</SelectItem></SelectContent></Select></div>
      <div><Label>{c.gradeScale}</Label><Select value={profile.gradeScale ?? "unknown"} onValueChange={gradeScale => setProfile(current => ({ ...current, gradeScale: gradeScale === "unknown" ? undefined : gradeScale, gradeValue: gradeScale === "unknown" ? undefined : current.gradeValue }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="percent_100">100</SelectItem><SelectItem value="gpa_4">4.0</SelectItem><SelectItem value="gpa_5">5.0</SelectItem><SelectItem value="gpa_10">10.0</SelectItem></SelectContent></Select></div>
      <div><Label>{c.grade}</Label><Input className="mt-1" type="number" step="0.01" disabled={!profile.gradeScale} value={profile.gradeValue ?? ""} onChange={event => setProfile(current => ({ ...current, gradeValue: event.target.value ? Number(event.target.value) : undefined }))} /></div>
      <div><Label>{c.language}</Label><Select value={profile.languageTest ?? "none"} onValueChange={languageTest => setProfile(current => ({ ...current, languageTest: languageTest === "none" ? undefined : languageTest, languageOverall: languageTest === "none" ? undefined : current.languageOverall }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{c.notTaken}</SelectItem>{["ielts", "toefl", "pte", "duolingo"].map(test => <SelectItem key={test} value={test}>{test.toUpperCase()}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>{c.score}</Label><Input className="mt-1" type="number" step="0.5" disabled={!profile.languageTest} value={profile.languageOverall ?? ""} onChange={event => setProfile(current => ({ ...current, languageOverall: event.target.value ? Number(event.target.value) : undefined }))} /></div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <Button type="button" size="lg" className="w-full" disabled={!canSearch || loading} onClick={findMatches}>{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}{loading ? c.searching : c.find}</Button>
    <p className="text-xs text-muted-foreground text-center">{c.disclaimer}</p>
  </div>;
}
