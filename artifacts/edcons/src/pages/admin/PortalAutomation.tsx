/**
 * PortalAutomation.tsx — Admin: Portal Otomasyonu sekmeli yönetim sayfası
 *
 * Tabs:
 *  - Otomasyon Kuralları  (SUB-STEP C — tam uygulama)
 *  - Üniversiteler        (SUB-STEP D skeleton)
 *  - Program Haritalama   (SUB-STEP E skeleton)
 *  - Adapter Yönetimi     (SUB-STEP F skeleton)
 */

import { useState, useEffect, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { usePipelineStages } from "@/hooks/use-pipeline-stages";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Construction, Save, Timer } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import PortalUniversitiesTab from "./PortalUniversitiesTab";
import PortalProgramMappingTab from "./PortalProgramMappingTab";
import PortalAdaptersTab from "./PortalAdaptersTab";
import PortalSubmissionsTab from "./PortalSubmissionsTab";
import PortalAuditTab from "./PortalAuditTab";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortalSettings {
  id?: number;
  isEnabled: boolean;
  triggerStages: string[];
  mode: "dry" | "real";
  scope: "only_applied" | "selected" | "all";
  selectedUniversityKeys: string[];
  concurrency: number;
  maxRetries: number;
  autoProcessEnabled: boolean;
  autoProcessIntervalMinutes: number;
}

interface PortalUniversity {
  id: number;
  universityKey: string;
  universityName: string;
  adapterKey: string;
  isActive: boolean;
}

const DEFAULTS: PortalSettings = {
  isEnabled: false,
  triggerStages: [],
  mode: "dry",
  scope: "only_applied",
  selectedUniversityKeys: [],
  concurrency: 2,
  maxRetries: 2,
  autoProcessEnabled: false,
  autoProcessIntervalMinutes: 20,
};

// ---------------------------------------------------------------------------
// ComingSoon placeholder
// ---------------------------------------------------------------------------
function ComingSoon() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
      <Construction className="w-12 h-12 opacity-40" />
      <p className="text-lg font-medium">{t("portalAutomation.comingSoon")}</p>
      <p className="text-sm">{t("portalAutomation.comingSoonHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Otomasyon Kuralları tab
// ---------------------------------------------------------------------------
function AutomationRulesTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { stages, isLoading: stagesLoading } = usePipelineStages("application");

  const [settings, setSettings] = useState<PortalSettings>(DEFAULTS);
  const [universities, setUniversities] = useState<PortalUniversity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load settings + universities in parallel
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, uniData] = await Promise.all([
        customFetch<PortalSettings>("/api/portal-automation/settings"),
        customFetch<{ data: PortalUniversity[]; total: number }>(
          "/api/portal-universities?limit=200&onlyActive=true",
        ).catch(() => ({ data: [] as PortalUniversity[], total: 0 })),
      ]);
      setSettings({ ...DEFAULTS, ...settingsData });
      setUniversities(uniData.data ?? []);
    } catch {
      toast({
        title: t("portalAutomation.rules.loadError"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  // Save settings
  const save = async () => {
    setSaving(true);
    try {
      await customFetch("/api/portal-automation/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          isEnabled: settings.isEnabled,
          triggerStages: settings.triggerStages,
          mode: settings.mode,
          scope: settings.scope,
          selectedUniversityKeys: settings.selectedUniversityKeys,
          concurrency: settings.concurrency,
          maxRetries: settings.maxRetries,
          autoProcessEnabled: settings.autoProcessEnabled,
          autoProcessIntervalMinutes: settings.autoProcessIntervalMinutes,
        }),
      });
      toast({ title: t("portalAutomation.rules.saveSuccess") });
    } catch {
      toast({ title: t("portalAutomation.rules.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleStage = (key: string, checked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      triggerStages: checked
        ? [...prev.triggerStages, key]
        : prev.triggerStages.filter((s) => s !== key),
    }));
  };

  const toggleUniversity = (key: string, checked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      selectedUniversityKeys: checked
        ? [...prev.selectedUniversityKeys, key]
        : prev.selectedUniversityKeys.filter((k) => k !== key),
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4 py-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">

      {/* ── isEnabled ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">{t("portalAutomation.rules.enabledLabel")}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("portalAutomation.rules.enabledDescription")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="pa-enabled"
                checked={settings.isEnabled}
                onCheckedChange={(v) => setSettings((p) => ({ ...p, isEnabled: v }))}
              />
              <Badge
                variant={settings.isEnabled ? "default" : "secondary"}
                className="text-xs"
              >
                {settings.isEnabled ? "ON" : "OFF"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Trigger Stages ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("portalAutomation.rules.triggerStagesLabel")}</CardTitle>
          <CardDescription>{t("portalAutomation.rules.triggerStagesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {stagesLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-48" />)}
            </div>
          ) : stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stages.map((stage) => (
                <div key={stage.key} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`stage-${stage.key}`}
                    checked={settings.triggerStages.includes(stage.key)}
                    onCheckedChange={(c) => toggleStage(stage.key, c === true)}
                  />
                  <Label
                    htmlFor={`stage-${stage.key}`}
                    className="text-sm cursor-pointer select-none"
                  >
                    {stage.label}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Submission Mode ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("portalAutomation.rules.modeLabel")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={settings.mode}
            onValueChange={(v) => setSettings((p) => ({ ...p, mode: v as "dry" | "real" }))}
            className="space-y-3"
          >
            {(["dry", "real"] as const).map((m) => (
              <div key={m} className="flex items-start gap-3">
                <RadioGroupItem value={m} id={`mode-${m}`} className="mt-0.5" />
                <Label htmlFor={`mode-${m}`} className="cursor-pointer">
                  <span className="font-medium text-sm">
                    {t(`portalAutomation.rules.mode${m === "dry" ? "Dry" : "Real"}`)}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(`portalAutomation.rules.mode${m === "dry" ? "Dry" : "Real"}Hint`)}
                  </p>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* ── Target Scope ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("portalAutomation.rules.scopeLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={settings.scope}
            onValueChange={(v) =>
              setSettings((p) => ({ ...p, scope: v as PortalSettings["scope"] }))
            }
            className="space-y-3"
          >
            {(
              [
                ["only_applied", "scopeOnlyApplied"],
                ["selected",     "scopeSelected"],
                ["all",          "scopeAll"],
              ] as const
            ).map(([val, tKey]) => (
              <div key={val} className="flex items-center gap-3">
                <RadioGroupItem value={val} id={`scope-${val}`} />
                <Label htmlFor={`scope-${val}`} className="text-sm cursor-pointer">
                  {t(`portalAutomation.rules.${tKey}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {/* University picker — visible only when scope=selected */}
          {settings.scope === "selected" && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-1">
                  {t("portalAutomation.rules.selectedUniversitiesLabel")}
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  {t("portalAutomation.rules.selectedUniversitiesHint")}
                </p>
                {universities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("portalAutomation.rules.noUniversities")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                    {universities.map((uni) => (
                      <div key={uni.universityKey} className="flex items-center gap-2.5">
                        <Checkbox
                          id={`uni-${uni.universityKey}`}
                          checked={settings.selectedUniversityKeys.includes(uni.universityKey)}
                          onCheckedChange={(c) =>
                            toggleUniversity(uni.universityKey, c === true)
                          }
                        />
                        <Label
                          htmlFor={`uni-${uni.universityKey}`}
                          className="text-sm cursor-pointer select-none leading-tight"
                        >
                          {uni.universityName}
                          <span className="ml-1 text-xs text-muted-foreground font-mono">
                            ({uni.universityKey})
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Scheduled Auto-Process ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="w-4 h-4 text-muted-foreground" />
            {t("portalAutomation.rules.autoProcess.title")}
          </CardTitle>
          <CardDescription>
            {t("portalAutomation.rules.autoProcess.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">{t("portalAutomation.rules.autoProcess.enabledLabel")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("portalAutomation.rules.autoProcess.enabledDescription")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="pa-auto-process-enabled"
                checked={settings.autoProcessEnabled}
                onCheckedChange={(v) => setSettings((p) => ({ ...p, autoProcessEnabled: v }))}
              />
              <Badge
                variant={settings.autoProcessEnabled ? "default" : "secondary"}
                className="text-xs"
              >
                {settings.autoProcessEnabled ? "ON" : "OFF"}
              </Badge>
            </div>
          </div>

          {/* Interval dropdown — only meaningful when enabled */}
          <div className="flex items-center gap-3 flex-wrap">
            <Label htmlFor="pa-auto-interval" className="text-sm font-medium shrink-0">
              {t("portalAutomation.rules.autoProcess.intervalLabel")}
            </Label>
            <Select
              value={String(settings.autoProcessIntervalMinutes)}
              onValueChange={(v) =>
                setSettings((p) => ({ ...p, autoProcessIntervalMinutes: Number(v) }))
              }
            >
              <SelectTrigger id="pa-auto-interval" className="w-48 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">{t("portalAutomation.rules.autoProcess.interval10")}</SelectItem>
                <SelectItem value="20">{t("portalAutomation.rules.autoProcess.interval20")}</SelectItem>
                <SelectItem value="30">{t("portalAutomation.rules.autoProcess.interval30")}</SelectItem>
                <SelectItem value="60">{t("portalAutomation.rules.autoProcess.interval60")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Save button ─────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />
          {saving
            ? t("portalAutomation.rules.saving")
            : t("portalAutomation.rules.saveButton")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------
export default function PortalAutomation() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {t("portalAutomation.pageTitle")}
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="rules">{t("portalAutomation.tabs.rules")}</TabsTrigger>
          <TabsTrigger value="universities">{t("portalAutomation.tabs.universities")}</TabsTrigger>
          <TabsTrigger value="programMapping">{t("portalAutomation.tabs.programMapping")}</TabsTrigger>
          <TabsTrigger value="adapters">{t("portalAutomation.tabs.adapters")}</TabsTrigger>
          <TabsTrigger value="submissions">{t("portalAutomation.tabs.submissions")}</TabsTrigger>
          <TabsTrigger value="auditLog">{t("portalAutomation.tabs.auditLog")}</TabsTrigger>
        </TabsList>

        <TabsContent value="rules">
          <AutomationRulesTab />
        </TabsContent>

        <TabsContent value="universities">
          <PortalUniversitiesTab />
        </TabsContent>

        <TabsContent value="programMapping">
          <PortalProgramMappingTab />
        </TabsContent>

        <TabsContent value="adapters">
          <PortalAdaptersTab />
        </TabsContent>

        <TabsContent value="submissions">
          <PortalSubmissionsTab />
        </TabsContent>

        <TabsContent value="auditLog">
          <PortalAuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
