import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Play, Save, ArrowLeft } from "lucide-react";

type ScopeDef = { key: string; label: string; description: string };
type ToolDef = { key: string; label: string; description: string; sideEffect: boolean };

type PersonaForm = {
  name: string;
  slug: string;
  personaType: "advisor" | "operator";
  description: string;
  avatarUrl: string;
  provider: "anthropic" | "openai";
  model: string;
  systemPrompt: string;
  guidelines: string;
  negativePrompt: string;
  temperature: number;
  maxTokens: number;
  allowedDataScopes: string[];
  toolsEnabled: string[];
  triggerMode: "manual" | "scheduled" | "event_driven";
  scheduleCron: string;
  outputTargets: string[];
  monthlyCostCapUsd: string;
  isActive: boolean;
};

const empty: PersonaForm = {
  name: "",
  slug: "",
  personaType: "advisor",
  description: "",
  avatarUrl: "",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  systemPrompt: "",
  guidelines: "",
  negativePrompt: "",
  temperature: 0.7,
  maxTokens: 2048,
  allowedDataScopes: [],
  toolsEnabled: [],
  triggerMode: "manual",
  scheduleCron: "",
  outputTargets: [],
  monthlyCostCapUsd: "",
  isActive: false,
};

const OUTPUT_TARGETS = ["notification", "report", "blog_draft", "internal_msg"];

export default function AiPersonaDetail() {
  const [, paramsNew] = useRoute("/admin/ai-personas/new");
  const [matchEdit, paramsEdit] = useRoute("/admin/ai-personas/:id");
  const [, setLocation] = useLocation();
  const id = matchEdit && paramsEdit?.id !== "new" ? Number(paramsEdit?.id) : null;
  const { toast } = useToast();

  const [form, setForm] = useState<PersonaForm>(empty);
  const [scopes, setScopes] = useState<ScopeDef[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [runInput, setRunInput] = useState("");

  const update = <K extends keyof PersonaForm>(k: K, v: PersonaForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const toggleArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([
          customFetch<{ scopes: ScopeDef[] }>("/api/ai-personas/registry/scopes"),
          customFetch<{ tools: ToolDef[] }>("/api/ai-personas/registry/tools"),
        ]);
        setScopes(s.scopes);
        setTools(t.tools);
      } catch (e) {
        toast({ title: "Registry hatası", description: (e as Error).message, variant: "destructive" });
      }
    })();
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const { persona } = await customFetch<{ persona: any }>(`/api/ai-personas/${id}`);
        setForm({
          name: persona.name ?? "",
          slug: persona.slug ?? "",
          personaType: persona.personaType,
          description: persona.description ?? "",
          avatarUrl: persona.avatarUrl ?? "",
          provider: persona.provider,
          model: persona.model ?? "",
          systemPrompt: persona.systemPrompt ?? "",
          guidelines: persona.guidelines ?? "",
          negativePrompt: persona.negativePrompt ?? "",
          temperature: Number(persona.temperature ?? 0.7),
          maxTokens: persona.maxTokens ?? 2048,
          allowedDataScopes: persona.allowedDataScopes ?? [],
          toolsEnabled: persona.toolsEnabled ?? [],
          triggerMode: persona.triggerMode ?? "manual",
          scheduleCron: persona.scheduleCron ?? "",
          outputTargets: persona.outputTargets ?? [],
          monthlyCostCapUsd:
            persona.monthlyCostCapUsd == null ? "" : String(persona.monthlyCostCapUsd),
          isActive: !!persona.isActive,
        });
        await loadRuns();
      } catch (e) {
        toast({ title: "Yükleme hatası", description: (e as Error).message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const loadRuns = async () => {
    if (!id) return;
    try {
      const data = await customFetch<{ runs: any[] }>(`/api/ai-personas/${id}/runs`);
      setRuns(data.runs);
    } catch {}
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        monthlyCostCapUsd:
          form.monthlyCostCapUsd.trim() === "" ? null : Number(form.monthlyCostCapUsd),
      };
      if (id) {
        await customFetch(`/api/ai-personas/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: "Kaydedildi" });
      } else {
        const { persona } = await customFetch<{ persona: any }>("/api/ai-personas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: "Oluşturuldu" });
        setLocation(`/admin/ai-personas/${persona.id}`);
      }
    } catch (e) {
      toast({ title: "Kaydetme hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!id) {
      toast({ title: "Önce kaydet", variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      const res = await customFetch<any>(`/api/ai-personas/${id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: runInput || undefined }),
      });
      toast({
        title: `Çalıştırıldı: ${res.status}`,
        description: res.error || `Run #${res.runId}`,
      });
      await loadRuns();
    } catch (e) {
      toast({ title: "Çalıştırma hatası", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/ai-personas")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Geri
          </Button>
          <h1 className="text-xl font-semibold">
            {id ? `Persona #${id}` : "Yeni Persona"}
          </h1>
          {form.personaType && (
            <Badge variant={form.personaType === "operator" ? "destructive" : "secondary"}>
              {form.personaType}
            </Badge>
          )}
        </div>
        <Button onClick={save} disabled={saving || loading}>
          <Save className="h-4 w-4 mr-2" /> {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">Genel</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="abilities">Yetenekler</TabsTrigger>
          <TabsTrigger value="trigger">Tetik</TabsTrigger>
          <TabsTrigger value="output">Çıktı</TabsTrigger>
          <TabsTrigger value="budget">Bütçe</TabsTrigger>
          <TabsTrigger value="history" disabled={!id}>Geçmiş</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>İsim</Label>
                  <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
                </div>
                <div>
                  <Label>Slug</Label>
                  <Input value={form.slug} onChange={(e) => update("slug", e.target.value)} placeholder="blog-yazari-zeynep" />
                </div>
                <div>
                  <Label>Tip</Label>
                  <Select value={form.personaType} onValueChange={(v) => update("personaType", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advisor">advisor — yan etkisiz</SelectItem>
                      <SelectItem value="operator">operator — onay kuyruğu</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Avatar URL</Label>
                  <Input value={form.avatarUrl} onChange={(e) => update("avatarUrl", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Açıklama</Label>
                <Textarea value={form.description} onChange={(e) => update("description", e.target.value)} rows={2} />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={form.isActive} onCheckedChange={(v) => update("isActive", v)} />
                <Label className="!m-0">Aktif</Label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompt" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">System Prompt</CardTitle></CardHeader>
            <CardContent>
              <Textarea rows={6} value={form.systemPrompt} onChange={(e) => update("systemPrompt", e.target.value)} placeholder="Bu persona'nın kim olduğu, üslubu, amacı…" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Guidelines</CardTitle></CardHeader>
            <CardContent>
              <Textarea rows={5} value={form.guidelines} onChange={(e) => update("guidelines", e.target.value)} placeholder="Markdown kurallar, format vs." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Negative Prompt</CardTitle></CardHeader>
            <CardContent>
              <Textarea rows={4} value={form.negativePrompt} onChange={(e) => update("negativePrompt", e.target.value)} placeholder="Yapma: …" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model" className="space-y-4 mt-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6">
              <div>
                <Label>Provider</Label>
                <Select value={form.provider} onValueChange={(v) => update("provider", v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                    <SelectItem value="openai">OpenAI (Faz 2)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => update("model", e.target.value)} placeholder="claude-sonnet-4-5" />
              </div>
              <div>
                <Label>Temperature ({form.temperature})</Label>
                <Input type="number" step="0.1" min={0} max={2} value={form.temperature} onChange={(e) => update("temperature", Number(e.target.value))} />
              </div>
              <div>
                <Label>Max Tokens</Label>
                <Input type="number" value={form.maxTokens} onChange={(e) => update("maxTokens", Number(e.target.value))} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="abilities" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Data Scopes (read-only context)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {scopes.length === 0 && <div className="text-sm text-muted-foreground">Registry yükleniyor…</div>}
              {scopes.map((s) => (
                <label key={s.key} className="flex items-start gap-3 cursor-pointer border rounded p-2 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.allowedDataScopes.includes(s.key)}
                    onChange={() => update("allowedDataScopes", toggleArr(form.allowedDataScopes, s.key))}
                  />
                  <div>
                    <div className="font-medium text-sm">{s.label} <span className="text-muted-foreground">({s.key})</span></div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  </div>
                </label>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Tools (aksiyonlar)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {tools.map((t) => {
                const disabled = form.personaType === "advisor" && t.sideEffect;
                return (
                  <label key={t.key} className={`flex items-start gap-3 cursor-pointer border rounded p-2 ${disabled ? "opacity-50" : "hover:bg-muted/50"}`}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={disabled}
                      checked={form.toolsEnabled.includes(t.key)}
                      onChange={() => update("toolsEnabled", toggleArr(form.toolsEnabled, t.key))}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {t.label} <span className="text-muted-foreground">({t.key})</span>
                        {t.sideEffect && <Badge variant="destructive" className="text-[10px]">side-effect</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                      {disabled && <div className="text-xs text-amber-600 mt-1">Advisor persona side-effect tool seçemez.</div>}
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trigger" className="space-y-4 mt-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div>
                <Label>Tetik modu</Label>
                <Select value={form.triggerMode} onValueChange={(v) => update("triggerMode", v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">manual</SelectItem>
                    <SelectItem value="scheduled">scheduled (Faz 2)</SelectItem>
                    <SelectItem value="event_driven">event_driven (Faz 2)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.triggerMode === "scheduled" && (
                <div>
                  <Label>Cron</Label>
                  <Input value={form.scheduleCron} onChange={(e) => update("scheduleCron", e.target.value)} placeholder="0 9 * * MON" />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="output" className="space-y-4 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Output Targets</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {OUTPUT_TARGETS.map((o) => (
                <label key={o} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.outputTargets.includes(o)}
                    onChange={() => update("outputTargets", toggleArr(form.outputTargets, o))}
                  />
                  <span className="text-sm">{o}</span>
                </label>
              ))}
              <div className="text-xs text-muted-foreground pt-2">
                Bilgi amaçlı; gerçek dispatch <strong>tools_enabled</strong> üzerinden yapılır.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 space-y-2">
              <Label>Aylık maliyet üst limiti (USD) — boş = limitsiz</Label>
              <Input
                value={form.monthlyCostCapUsd}
                onChange={(e) => update("monthlyCostCapUsd", e.target.value)}
                placeholder="örn. 25.00"
              />
              <div className="text-xs text-muted-foreground">
                Cost cap aşılırsa run <code>blocked_by_cap</code> statüsüyle durdurulur.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Son çalıştırmalar</CardTitle>
                <div className="flex gap-2">
                  <Input
                    className="w-72"
                    placeholder="Opsiyonel kullanıcı talebi (USER_DATA bloğuna girer)"
                    value={runInput}
                    onChange={(e) => setRunInput(e.target.value)}
                  />
                  <Button onClick={runNow} disabled={running || !form.isActive} title={!form.isActive ? "Önce aktif et" : ""}>
                    <Play className="h-4 w-4 mr-1" /> {running ? "Çalışıyor…" : "Şimdi çalıştır"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {runs.length === 0 && <div className="text-sm text-muted-foreground">Henüz çalıştırma yok.</div>}
              {runs.map((r) => (
                <div key={r.id} className="border rounded p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === "success" ? "secondary" : "destructive"}>{r.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      #{r.id} · {new Date(r.createdAt).toLocaleString()} · {r.latencyMs ?? "—"}ms · tokens {r.promptTokens ?? 0}/{r.completionTokens ?? 0}
                      {r.costUsd && ` · $${r.costUsd}`}
                    </span>
                  </div>
                  {r.errorMessage && <div className="text-red-600 text-xs">{r.errorMessage}</div>}
                  {r.outputPayload?.output && (
                    <pre className="bg-muted p-2 rounded text-xs whitespace-pre-wrap max-h-48 overflow-auto">{r.outputPayload.output}</pre>
                  )}
                  {r.outputPayload?.warnings?.length > 0 && (
                    <div className="text-amber-600 text-xs">⚠ {r.outputPayload.warnings.join(", ")}</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
