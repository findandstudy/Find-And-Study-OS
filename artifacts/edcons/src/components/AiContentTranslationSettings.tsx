import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { BrainCircuit, KeyRound, Loader2, Save, ShieldCheck, Zap } from "lucide-react";
import { AI_MODEL_OPTIONS, DEFAULT_AI_MODELS, modelOptionsForPolicy, type AiProviderKey } from "./aiModelCatalog";

const KINDS = ["country", "city", "university", "program", "managed", "blog"];
const LOCALES = ["en","tr","ar","fr","ru","fa","zh","hi","es","id","ur","tk","ky","kk","uz","tg","bn","pt","ne","vi","ko","uk","it"];

type Settings = {
  enabled: boolean; provider: "auto" | "openai" | "claude"; modelOverride: string; candidateModel: string; candidateTrafficPercent: number; fallbackModel: string; temperature: number;
  qualityMode: "fast" | "balanced" | "premium"; allowedKinds: string[]; allowedLocales: string[];
  maxPairsPerRequest: number; dailyRequestLimit: number; dailyEstimatedTokenLimit: number; editorialGuidance: string;
  automaticTranslationEnabled: boolean; automaticRunHourUtc: number; automaticBatchSize: number;
  workerConcurrency: number; maxAttempts: number; reviewRequired: true; publicationPolicy: "draft_only";
};

type IntegrationRow = { key: string; name: string; category: string; isEnabled: boolean; config?: Record<string, unknown>; requiresCredentialReset?: boolean };

function ModelPicker({ value, provider, disabled, optional = false, onChange }: { value: string; provider: Settings["provider"]; disabled: boolean; optional?: boolean; onChange: (value: string) => void }) {
  const options = modelOptionsForPolicy(provider);
  const legacyValue = value && !options.some(option => option.value === value) ? value : "";
  const sentinel = optional ? "__none__" : "__default__";
  return <Select disabled={disabled || provider === "auto"} value={value || sentinel} onValueChange={next => onChange(next === sentinel ? "" : next)}>
    <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value={sentinel}>{optional ? "Model yok" : "Entegrasyon varsayılanını kullan"}</SelectItem>
      {legacyValue ? <SelectItem value={legacyValue}>Mevcut eski model · {legacyValue}</SelectItem> : null}
      {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.description}</SelectItem>)}
    </SelectContent>
  </Select>;
}

function ProviderConnectionCard({ provider, row, canEdit, onSaved }: { provider: AiProviderKey; row?: IntegrationRow; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_AI_MODELS[provider]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [savedCredentialReady, setSavedCredentialReady] = useState(false);
  useEffect(() => {
    setApiKey(typeof row?.config?.apiKey === "string" ? row.config.apiKey : "");
    setModel(typeof row?.config?.model === "string" && row.config.model.trim() ? row.config.model : DEFAULT_AI_MODELS[provider]);
    setEnabled(Boolean(row?.isEnabled));
    setSavedCredentialReady(false);
  }, [provider, row]);
  const label = provider === "openai" ? "OpenAI" : "Anthropic Claude";
  const requiresCredentialReset = Boolean(row?.requiresCredentialReset && !savedCredentialReady);
  const requestWithTimeout = async <T,>(url: string, init: RequestInit, timeoutMs = 20_000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try { return await customFetch<T>(url, { ...init, signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) throw new Error("İstek zaman aşımına uğradı; tekrar deneyin."); throw error; }
    finally { window.clearTimeout(timer); }
  };
  const saveConnection = async () => {
    setBusy("save");
    try {
      const saved = await requestWithTimeout<IntegrationRow>(`/api/integrations/${provider}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: label, category: "ai", isEnabled: enabled, config: { apiKey: apiKey.trim(), model } }) });
      setApiKey(typeof saved.config?.apiKey === "string" ? saved.config.apiKey : "");
      setSavedCredentialReady(!saved.requiresCredentialReset);
      toast({ title: `${label} bağlantısı kaydedildi`, description: "API anahtarı şifreli saklanır ve yalnız maskeli gösterilir." });
      void onSaved();
    } catch (error: any) { toast({ title: "Bağlantı kaydedilemedi", description: error?.body?.message || error?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const testConnection = async () => {
    setBusy("test");
    try {
      const result: any = await requestWithTimeout(`/api/integrations/${provider}/test`, { method: "POST" }, 30_000);
      const skipped = result?.status === "simulated" || result?.status === "not_supported";
      toast({ title: skipped ? "Bağlantı testi çalıştırılmadı" : result?.success ? `${label} bağlantısı doğrulandı` : "Bağlantı testi başarısız", description: result?.message, variant: !skipped && !result?.success ? "destructive" : undefined });
    } catch (error: any) { toast({ title: "Bağlantı testi başarısız", description: error?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  return <div className="rounded-xl border bg-background p-4 space-y-4">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{label}</p><p className={`text-xs ${requiresCredentialReset ? "text-amber-700" : "text-muted-foreground"}`}>{requiresCredentialReset ? "API anahtarı yeniden girilmeli" : (savedCredentialReady || row?.config?.apiKey) ? "API anahtarı yapılandırıldı · gizli değer maskeli" : "API anahtarı gerekli"}</p></div><Switch checked={enabled} disabled={!canEdit || busy !== null} onCheckedChange={setEnabled} /></div>
    <div className="space-y-2"><Label>{label} API anahtarı</Label><Input type="password" autoComplete="new-password" disabled={!canEdit || busy !== null} value={apiKey} onChange={event => { setApiKey(event.target.value); setSavedCredentialReady(false); }} placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."} /><p className="text-[11px] text-muted-foreground">Maskeli değeri değiştirmeden bırakırsanız kayıtlı anahtar korunur.</p></div>
    <div className="space-y-2"><Label>Varsayılan model</Label><Select disabled={!canEdit || busy !== null} value={model} onValueChange={setModel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{!AI_MODEL_OPTIONS[provider].some(option => option.value === model) ? <SelectItem value={model}>Mevcut eski model · {model}</SelectItem> : null}{AI_MODEL_OPTIONS[provider].map(option => <SelectItem key={option.value} value={option.value}>{option.label} · {option.description}</SelectItem>)}</SelectContent></Select></div>
    {canEdit ? <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={testConnection} disabled={!row || requiresCredentialReset || busy !== null}>{busy === "test" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}Test et</Button><Button type="button" onClick={saveConnection} disabled={!apiKey.trim() || !model || busy !== null}>{busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Bağlantıyı kaydet</Button></div> : null}
  </div>;
}

export function AiContentTranslationSettings({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const query = useQuery<any>({ queryKey: ["/api/website/ai/content-settings"], queryFn: () => customFetch("/api/website/ai/content-settings") });
  const integrationsQuery = useQuery<any>({ queryKey: ["/api/integrations", "ai-content-connections"], queryFn: () => customFetch("/api/integrations") });
  const [value, setValue] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (query.data?.settings) setValue(query.data.settings); }, [query.data]);
  const patch = (next: Partial<Settings>) => setValue(current => current ? { ...current, ...next } : current);
  const toggle = (key: "allowedKinds" | "allowedLocales", item: string) => setValue(current => current ? ({ ...current, [key]: current[key].includes(item) ? current[key].filter(v => v !== item) : [...current[key], item] }) : current);
  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      const response: any = await customFetch("/api/website/ai/content-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      setValue(response.settings); await query.refetch();
      toast({ title: "AI içerik ayarları kaydedildi", description: "Politika artık dinamik sayfa üretimi ve çevirilerde uygulanıyor." });
    } catch (error: any) { toast({ title: "Ayarlar kaydedilemedi", description: error?.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  if (query.isLoading || !value) return <Card className="p-6"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />AI içerik ayarları yükleniyor…</div></Card>;
  const usage = query.data?.usage || {};
  return <Card id="ai-content-translation-settings" className="border-none shadow-lg shadow-black/5 overflow-hidden">
    <div className="p-6 border-b bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent flex flex-wrap items-start justify-between gap-4">
      <div className="flex gap-3"><div className="h-10 w-10 rounded-xl bg-violet-600 text-white grid place-items-center"><BrainCircuit className="h-5 w-5" /></div><div><h2 className="font-display font-bold text-xl">AI İçerik ve Çeviri</h2><p className="text-sm text-muted-foreground">Dinamik sayfalar, yönetilen sayfalar, şablonlar ve blog için ortak üretim politikası.</p></div></div>
      <div className="flex items-center gap-3"><Badge variant="outline"><ShieldCheck className="h-3.5 w-3.5 mr-1" />Yalnız taslak · insan incelemesi</Badge><Switch checked={value.enabled} disabled={!canEdit} onCheckedChange={enabled => patch({ enabled })} /></div>
    </div>
    <div className="p-6 space-y-7">
      <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5 space-y-4">
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 text-violet-700" /><div><h3 className="font-semibold">AI sağlayıcı bağlantıları</h3><p className="text-sm text-muted-foreground">API anahtarını, varsayılan modeli ve aktif sağlayıcıyı buradan yönetin. Aynı şifreli entegrasyon kayıtları kullanılır.</p></div></div>
        {integrationsQuery.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Sağlayıcılar yükleniyor…</div> : <div className="grid lg:grid-cols-2 gap-4">{(["openai", "claude"] as const).map(provider => <ProviderConnectionCard key={provider} provider={provider} canEdit={canEdit} row={(integrationsQuery.data?.data as IntegrationRow[] | undefined)?.find(item => item.key === provider)} onSaved={() => integrationsQuery.refetch()} />)}</div>}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="space-y-2"><Label>Sağlayıcı</Label><Select disabled={!canEdit} value={value.provider} onValueChange={(provider: any) => patch({ provider, modelOverride: "", candidateModel: "", candidateTrafficPercent: 0, fallbackModel: "" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Otomatik</SelectItem><SelectItem value="openai">Yalnız OpenAI</SelectItem><SelectItem value="claude">Yalnız Anthropic Claude</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label>Birincil model</Label><ModelPicker disabled={!canEdit} provider={value.provider} value={value.modelOverride} onChange={modelOverride => patch({ modelOverride })} /></div>
        <div className="space-y-2"><Label>Aday model</Label><ModelPicker optional disabled={!canEdit} provider={value.provider} value={value.candidateModel} onChange={candidateModel => patch({ candidateModel, candidateTrafficPercent: candidateModel ? value.candidateTrafficPercent : 0 })} /><div className="flex items-center gap-2"><Input disabled={!canEdit || !value.candidateModel} className="w-20" type="number" min={0} max={25} value={value.candidateTrafficPercent} onChange={e => patch({ candidateTrafficPercent: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">%</span></div></div>
        <div className="space-y-2"><Label>Yedek model</Label><ModelPicker optional disabled={!canEdit} provider={value.provider} value={value.fallbackModel} onChange={fallbackModel => patch({ fallbackModel })} /></div>
        <div className="space-y-2"><Label>Kalite modu</Label><Select disabled={!canEdit} value={value.qualityMode} onValueChange={(qualityMode: any) => patch({ qualityMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fast">Hızlı</SelectItem><SelectItem value="balanced">Dengeli</SelectItem><SelectItem value="premium">Premium</SelectItem></SelectContent></Select></div>
      </div>
      <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="space-y-2"><Label>Yaratıcılık (0–1)</Label><Input disabled={!canEdit} type="number" min={0} max={1} step={0.1} value={value.temperature} onChange={e => patch({ temperature: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>İstek başına sayfa</Label><Input disabled={!canEdit} type="number" min={1} max={50} value={value.maxPairsPerRequest} onChange={e => patch({ maxPairsPerRequest: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>Günlük istek sınırı</Label><Input disabled={!canEdit} type="number" min={1} value={value.dailyRequestLimit} onChange={e => patch({ dailyRequestLimit: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>Günlük tahmini token</Label><Input disabled={!canEdit} type="number" min={1000} step={1000} value={value.dailyEstimatedTokenLimit} onChange={e => patch({ dailyEstimatedTokenLimit: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>Kuyruk eşzamanlılığı</Label><Input disabled={!canEdit} type="number" min={1} max={4} value={value.workerConcurrency} onChange={e => patch({ workerConcurrency: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>Yeniden deneme</Label><Input disabled={!canEdit} type="number" min={1} max={8} value={value.maxAttempts} onChange={e => patch({ maxAttempts: Number(e.target.value) })} /></div>
      </div>
      <div className="space-y-2"><Label>Editoryal yönlendirme</Label><Textarea disabled={!canEdit} maxLength={1000} value={value.editorialGuidance} onChange={e => patch({ editorialGuidance: e.target.value })} placeholder="Ton, terminoloji, hedef kitle ve anlatım kuralları…" /><p className="text-xs text-muted-foreground">{value.editorialGuidance.length}/1000</p></div>
      <div className="grid lg:grid-cols-2 gap-6"><div><Label>Etkin içerik alanları</Label><div className="mt-2 flex flex-wrap gap-2">{KINDS.map(kind => <Button key={kind} type="button" size="sm" variant={value.allowedKinds.includes(kind) ? "default" : "outline"} disabled={!canEdit} onClick={() => toggle("allowedKinds", kind)} className="capitalize">{kind}</Button>)}</div></div><div><Label>Etkin hedef diller</Label><div className="mt-2 flex flex-wrap gap-2">{LOCALES.map(locale => <Button key={locale} type="button" size="sm" variant={value.allowedLocales.includes(locale) ? "default" : "outline"} disabled={!canEdit} onClick={() => toggle("allowedLocales", locale)} className="h-8 min-w-10 uppercase">{locale}</Button>)}</div></div></div>
      <div className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-4"><div><p className="font-semibold">Planlı taslak çeviri</p><p className="text-xs text-muted-foreground">Yalnız incelemeye açık taslak üretir; otomatik yayın yapmaz.</p></div><div className="flex items-center gap-3"><Label className="text-xs">Parti</Label><Input disabled={!canEdit || !value.automaticTranslationEnabled} className="w-20" type="number" min={1} max={50} value={value.automaticBatchSize} onChange={e => patch({ automaticBatchSize: Number(e.target.value) })} /><Input disabled={!canEdit || !value.automaticTranslationEnabled} className="w-20" type="number" min={0} max={23} value={value.automaticRunHourUtc} onChange={e => patch({ automaticRunHourUtc: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">UTC</span><Switch disabled={!canEdit} checked={value.automaticTranslationEnabled} onCheckedChange={automaticTranslationEnabled => patch({ automaticTranslationEnabled })} /></div></div>
      <div className="rounded-xl bg-muted/50 p-4 grid sm:grid-cols-4 gap-3 text-sm"><div><p className="text-muted-foreground">Son 30 gün</p><p className="font-bold">{usage.requests || 0} istek</p></div><div><p className="text-muted-foreground">Tahmini token</p><p className="font-bold">{Number(usage.estimatedTokens || 0).toLocaleString()}</p></div><div><p className="text-muted-foreground">Başarılı</p><p className="font-bold text-emerald-600">{usage.succeeded || 0}</p></div><div><p className="text-muted-foreground">Başarısız</p><p className="font-bold text-destructive">{usage.failed || 0}</p></div></div>
      {canEdit ? <div className="flex justify-end"><Button onClick={save} disabled={saving || !value.allowedKinds.length || !value.allowedLocales.length}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}AI politikasını kaydet</Button></div> : <p className="text-xs text-muted-foreground">Bu politikayı yalnız doğrudan Super Admin oturumu değiştirebilir.</p>}
    </div>
  </Card>;
}
