import { useState, useEffect, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import type {
  AiAgentConfig,
  AiAgentConfigUpdate,
  AiAgentTestResult,
  AiAgentTestRequestHistoryItem,
  KnowledgeSourceProgramScope,
  ProgramScope,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import KnowledgeSourcesRag from "@/components/admin/KnowledgeSourcesRag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Save,
  Play,
  AlertTriangle,
  Plus,
  Trash2,
  Database,
} from "lucide-react";

type HistoryDirection = "inbound" | "outbound";

type EscalationTopicKey = "contract" | "payment" | "commission" | "partner";
const ESCALATION_TOPICS: EscalationTopicKey[] = [
  "contract",
  "payment",
  "commission",
  "partner",
];
const TEST_LANGUAGES = ["tr", "en", "ar", "ru", "fr"] as const;
type TestLanguage = (typeof TEST_LANGUAGES)[number];

// Parse a textarea of comma/newline-separated keywords into a clean array.
function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function AiAgent() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [config, setConfig] = useState<AiAgentConfig | null>(null);
  const [keywordText, setKeywordText] = useState<Record<EscalationTopicKey, string>>({
    contract: "",
    payment: "",
    commission: "",
    partner: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Knowledge Sources — program_scope (FAZ 1 scaffold).
  const [programScopeSource, setProgramScopeSource] =
    useState<KnowledgeSourceProgramScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    countries: string[];
    universityTypes: string[];
  }>({ countries: [], universityTypes: [] });

  // Test console state.
  const [testMessage, setTestMessage] = useState("");
  const [testLanguage, setTestLanguage] = useState<TestLanguage | "auto">("auto");
  const [testHistory, setTestHistory] = useState<AiAgentTestRequestHistoryItem[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiAgentTestResult | null>(null);

  const addHistoryTurn = () =>
    setTestHistory((prev) => [...prev, { direction: "inbound", content: "" }]);
  const updateHistoryTurn = (
    index: number,
    patch: Partial<AiAgentTestRequestHistoryItem>,
  ) =>
    setTestHistory((prev) =>
      prev.map((turn, i) => (i === index ? { ...turn, ...patch } : turn)),
    );
  const removeHistoryTurn = (index: number) =>
    setTestHistory((prev) => prev.filter((_, i) => i !== index));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { config: cfg } = await customFetch<{ config: AiAgentConfig }>(
        "/api/inbox/ai-agent/config",
      );
      setConfig(cfg);
      setKeywordText({
        contract: (cfg.escalationKeywords.contract ?? []).join(", "),
        payment: (cfg.escalationKeywords.payment ?? []).join(", "),
        commission: (cfg.escalationKeywords.commission ?? []).join(", "),
        partner: (cfg.escalationKeywords.partner ?? []).join(", "),
      });
    } catch {
      toast({ title: t("aiAgentAdmin.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  const loadProgramScope = useCallback(async () => {
    setScopeLoading(true);
    try {
      const [{ source }, filters] = await Promise.all([
        customFetch<{ source: KnowledgeSourceProgramScope }>(
          "/api/inbox/knowledge-sources/program-scope",
        ),
        customFetch<{ countries?: string[]; universityTypes?: string[] }>(
          "/api/course-finder/filters",
        ).catch(() => ({ countries: [], universityTypes: [] })),
      ]);
      setProgramScopeSource(source);
      setFilterOptions({
        countries: filters.countries ?? [],
        universityTypes: filters.universityTypes ?? [],
      });
    } catch {
      toast({ title: t("aiAgentAdmin.knowledgeSources.loadError"), variant: "destructive" });
    } finally {
      setScopeLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
    loadProgramScope();
  }, [load, loadProgramScope]);

  const patch = (p: Partial<AiAgentConfig>) =>
    setConfig((prev) => (prev ? { ...prev, ...p } : prev));

  const patchScope = (p: Partial<ProgramScope>) =>
    setProgramScopeSource((prev) =>
      prev ? { ...prev, scope: { ...prev.scope, ...p } } : prev,
    );

  const saveProgramScope = async () => {
    if (!programScopeSource) return;
    setScopeSaving(true);
    try {
      const { source } = await customFetch<{ source: KnowledgeSourceProgramScope }>(
        "/api/inbox/knowledge-sources/program-scope",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            isActive: programScopeSource.isActive,
            scope: programScopeSource.scope,
          }),
        },
      );
      setProgramScopeSource(source);
      toast({ title: t("aiAgentAdmin.knowledgeSources.saveSuccess") });
    } catch {
      toast({ title: t("aiAgentAdmin.knowledgeSources.saveError"), variant: "destructive" });
    } finally {
      setScopeSaving(false);
    }
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const body: AiAgentConfigUpdate = {
        enabled: config.enabled,
        defaultOnForNew: config.defaultOnForNew,
        model: config.model,
        temperature: config.temperature,
        maxConsecutiveReplies: config.maxConsecutiveReplies,
        handoffMessage: config.handoffMessage,
        knowledgeBase: config.knowledgeBase,
        escalationKeywords: {
          contract: parseKeywords(keywordText.contract),
          payment: parseKeywords(keywordText.payment),
          commission: parseKeywords(keywordText.commission),
          partner: parseKeywords(keywordText.partner),
        },
      };
      const { config: cfg } = await customFetch<{ config: AiAgentConfig }>(
        "/api/inbox/ai-agent/config",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setConfig(cfg);
      toast({ title: t("aiAgentAdmin.saveSuccess") });
    } catch {
      toast({ title: t("aiAgentAdmin.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!testMessage.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const body: {
        message: string;
        language?: TestLanguage;
        history?: AiAgentTestRequestHistoryItem[];
      } = {
        message: testMessage.trim(),
      };
      if (testLanguage !== "auto") body.language = testLanguage;
      const cleanHistory = testHistory
        .map((turn) => ({ ...turn, content: turn.content.trim() }))
        .filter((turn) => turn.content.length > 0);
      if (cleanHistory.length > 0) body.history = cleanHistory;
      const { result } = await customFetch<{ result: AiAgentTestResult }>(
        "/api/inbox/ai-agent/test",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      setTestResult(result);
    } catch {
      toast({ title: t("aiAgentAdmin.testError"), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="space-y-4 py-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("aiAgentAdmin.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("aiAgentAdmin.subtitle")}
            </p>
          </div>
        </div>
        <Button onClick={save} disabled={saving} className="shrink-0">
          <Save className="h-4 w-4 mr-2" />
          {saving ? t("aiAgentAdmin.saving") : t("aiAgentAdmin.save")}
        </Button>
      </div>

      {/* Global settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("aiAgentAdmin.globalTitle")}
          </CardTitle>
          <CardDescription>{t("aiAgentAdmin.globalHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t("aiAgentAdmin.enabledLabel")}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("aiAgentAdmin.enabledHint")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={config.enabled}
                onCheckedChange={(v) => patch({ enabled: v })}
              />
              <Badge variant={config.enabled ? "default" : "secondary"}>
                {config.enabled ? t("aiAgentAdmin.statusOn") : t("aiAgentAdmin.statusOff")}
              </Badge>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">
                {t("aiAgentAdmin.defaultOnForNewLabel")}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("aiAgentAdmin.defaultOnForNewHint")}
              </p>
            </div>
            <Switch
              checked={config.defaultOnForNew}
              onCheckedChange={(v) => patch({ defaultOnForNew: v })}
            />
          </div>

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="model">{t("aiAgentAdmin.modelLabel")}</Label>
              <Input
                id="model"
                value={config.model}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="temperature">
                {t("aiAgentAdmin.temperatureLabel")}
              </Label>
              <Input
                id="temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(e) =>
                  patch({ temperature: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxReplies">
                {t("aiAgentAdmin.maxConsecutiveRepliesLabel")}
              </Label>
              <Input
                id="maxReplies"
                type="number"
                min={0}
                max={100}
                step={1}
                value={config.maxConsecutiveReplies}
                onChange={(e) =>
                  patch({
                    maxConsecutiveReplies: Math.trunc(Number(e.target.value)),
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="handoff">
              {t("aiAgentAdmin.handoffMessageLabel")}
            </Label>
            <Textarea
              id="handoff"
              rows={2}
              value={config.handoffMessage}
              onChange={(e) => patch({ handoffMessage: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t("aiAgentAdmin.handoffMessageHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Knowledge base */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("aiAgentAdmin.knowledgeBaseTitle")}
          </CardTitle>
          <CardDescription>
            {t("aiAgentAdmin.knowledgeBaseHint")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={14}
            className="font-mono text-sm"
            value={config.knowledgeBase}
            onChange={(e) => patch({ knowledgeBase: e.target.value })}
            placeholder={t("aiAgentAdmin.knowledgeBasePlaceholder")}
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            {config.knowledgeBase.length} / 20000
          </p>
        </CardContent>
      </Card>

      {/* Knowledge Sources — program_scope (FAZ 1 scaffold) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">
              {t("aiAgentAdmin.knowledgeSources.title")}
            </CardTitle>
          </div>
          <CardDescription>
            {t("aiAgentAdmin.knowledgeSources.hint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {scopeLoading || !programScopeSource ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
                <div>
                  <p className="font-medium text-sm">
                    {t("aiAgentAdmin.knowledgeSources.programScopeLabel")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("aiAgentAdmin.knowledgeSources.programScopeHint")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={programScopeSource.isActive && programScopeSource.scope.enabled}
                    onCheckedChange={(v) => {
                      setProgramScopeSource((prev) =>
                        prev
                          ? { ...prev, isActive: v, scope: { ...prev.scope, enabled: v } }
                          : prev,
                      );
                    }}
                  />
                  <Badge
                    variant={
                      programScopeSource.isActive && programScopeSource.scope.enabled
                        ? "default"
                        : "secondary"
                    }
                  >
                    {programScopeSource.isActive && programScopeSource.scope.enabled
                      ? t("aiAgentAdmin.statusOn")
                      : t("aiAgentAdmin.statusOff")}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{t("aiAgentAdmin.knowledgeSources.countriesLabel")}</Label>
                  <MultiSelectFilter
                    values={
                      programScopeSource.scope.countries === "all"
                        ? []
                        : programScopeSource.scope.countries
                    }
                    onChange={(vals) =>
                      patchScope({ countries: vals.length ? vals : "all" })
                    }
                    options={filterOptions.countries.map((c) => ({ value: c, label: c }))}
                    placeholder={t("aiAgentAdmin.knowledgeSources.allCountries")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {programScopeSource.scope.countries === "all"
                      ? t("aiAgentAdmin.knowledgeSources.allCountries")
                      : t("aiAgentAdmin.knowledgeSources.selectedCount", {
                          count: programScopeSource.scope.countries.length,
                        })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("aiAgentAdmin.knowledgeSources.universityTypesLabel")}</Label>
                  <MultiSelectFilter
                    values={
                      programScopeSource.scope.universityTypes === "all"
                        ? []
                        : programScopeSource.scope.universityTypes
                    }
                    onChange={(vals) =>
                      patchScope({ universityTypes: vals.length ? vals : "all" })
                    }
                    options={filterOptions.universityTypes.map((c) => ({ value: c, label: c }))}
                    placeholder={t("aiAgentAdmin.knowledgeSources.allUniversityTypes")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {programScopeSource.scope.universityTypes === "all"
                      ? t("aiAgentAdmin.knowledgeSources.allUniversityTypes")
                      : t("aiAgentAdmin.knowledgeSources.selectedCount", {
                          count: programScopeSource.scope.universityTypes.length,
                        })}
                  </p>
                </div>
              </div>

              {programScopeSource.lastSyncedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("aiAgentAdmin.knowledgeSources.lastSyncedAt", {
                    date: new Date(programScopeSource.lastSyncedAt).toLocaleString(),
                  })}
                </p>
              )}

              <div className="flex justify-end">
                <Button onClick={saveProgramScope} disabled={scopeSaving} size="sm">
                  <Save className="h-4 w-4 mr-2" />
                  {scopeSaving
                    ? t("aiAgentAdmin.saving")
                    : t("aiAgentAdmin.knowledgeSources.save")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Knowledge Sources — external RAG (FAZ 2) */}
      <KnowledgeSourcesRag />

      {/* Escalation keywords */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("aiAgentAdmin.escalationTitle")}
          </CardTitle>
          <CardDescription>
            {t("aiAgentAdmin.escalationHint")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ESCALATION_TOPICS.map((topic) => (
            <div key={topic} className="space-y-1.5">
              <Label htmlFor={`kw-${topic}`}>
                {t(`aiAgentAdmin.topic.${topic}`)}
              </Label>
              <Textarea
                id={`kw-${topic}`}
                rows={3}
                value={keywordText[topic]}
                onChange={(e) =>
                  setKeywordText((prev) => ({ ...prev, [topic]: e.target.value }))
                }
                placeholder={t("aiAgentAdmin.escalationPlaceholder")}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Test console */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("aiAgentAdmin.testTitle")}
          </CardTitle>
          <CardDescription>{t("aiAgentAdmin.testHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>{t("aiAgentAdmin.testHistoryLabel")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("aiAgentAdmin.testHistoryHint")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addHistoryTurn}
                className="shrink-0"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {t("aiAgentAdmin.testHistoryAdd")}
              </Button>
            </div>
            {testHistory.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                {t("aiAgentAdmin.testHistoryEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                {testHistory.map((turn, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Select
                      value={turn.direction}
                      onValueChange={(v) =>
                        updateHistoryTurn(index, {
                          direction: v as HistoryDirection,
                        })
                      }
                    >
                      <SelectTrigger className="w-32 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inbound">
                          {t("aiAgentAdmin.testHistoryInbound")}
                        </SelectItem>
                        <SelectItem value="outbound">
                          {t("aiAgentAdmin.testHistoryOutbound")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={turn.content}
                      onChange={(e) =>
                        updateHistoryTurn(index, { content: e.target.value })
                      }
                      placeholder={t("aiAgentAdmin.testHistoryContentPlaceholder")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeHistoryTurn(index)}
                      className="shrink-0"
                      aria-label={t("aiAgentAdmin.testHistoryRemove")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="testMessage">
              {t("aiAgentAdmin.testMessageLabel")}
            </Label>
            <Textarea
              id="testMessage"
              rows={3}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder={t("aiAgentAdmin.testMessagePlaceholder")}
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1.5 w-40">
              <Label>{t("aiAgentAdmin.testLanguageLabel")}</Label>
              <Select
                value={testLanguage}
                onValueChange={(v) => setTestLanguage(v as TestLanguage | "auto")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {t("aiAgentAdmin.testLanguageAuto")}
                  </SelectItem>
                  {TEST_LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={runTest}
              disabled={testing || !testMessage.trim()}
              variant="secondary"
            >
              <Play className="h-4 w-4 mr-2" />
              {testing ? t("aiAgentAdmin.testRunning") : t("aiAgentAdmin.testRun")}
            </Button>
          </div>

          {testResult && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">
                  {t("aiAgentAdmin.testDetectedLanguage")}:{" "}
                  {testResult.language.toUpperCase()}
                </Badge>
                {testResult.escalation.escalated ? (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t("aiAgentAdmin.testEscalated")}
                    {testResult.escalation.topic
                      ? `: ${t(`aiAgentAdmin.topic.${testResult.escalation.topic}` as string)}`
                      : ""}
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    {t("aiAgentAdmin.testNoEscalation")}
                  </Badge>
                )}
                <Badge variant="outline">{testResult.model}</Badge>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {t("aiAgentAdmin.testReplyLabel")}
                </p>
                {testResult.reply ? (
                  <p className="text-sm whitespace-pre-wrap">{testResult.reply}</p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    {t("aiAgentAdmin.testNoReply")}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("aiAgentAdmin.testNoSendNote")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
