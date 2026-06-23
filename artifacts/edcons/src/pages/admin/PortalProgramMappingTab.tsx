/**
 * PortalProgramMappingTab.tsx — SUB-STEP E
 *
 * Per-university matching-data editor (single source of truth). Panel edits are
 * merged OVER the adapter's built-in code defaults on the server (DB wins):
 *   - mappings:         portal label → CRM program name dictionary
 *   - programOverrides: CRM program id → portal option value
 *   - synonyms:         EN↔TR equivalence groups (folded single tokens)
 *   - countryOverrides: nationality/country (lowercase) → portal label
 *
 * GET  /api/portal-program-mapping/:universityKey
 * PUT  /api/portal-program-mapping/:universityKey   (admin/manager only)
 * GET  /api/portal-universities  (for university picker)
 */

import { useState, useEffect, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, Loader2, ArrowRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortalUniversity {
  id: number;
  universityKey: string;
  universityName: string;
  isActive: boolean;
}

interface PairRow {
  id: string;   // local key for React list rendering
  key: string;
  value: string;
}

interface SynonymRow {
  id: string;
  tokens: string;  // comma/space separated tokens for one equivalence group
}

interface MappingResponse {
  mappings?: Record<string, string>;
  programOverrides?: Record<string, string>;
  synonyms?: string[][];
  countryOverrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _rid = 0;
const rid = () => `r${_rid++}-${Date.now()}`;

function toPairRows(rec: Record<string, string> | undefined): PairRow[] {
  return Object.entries(rec ?? {}).map(([key, value]) => ({ id: rid(), key, value }));
}

function pairsToRecord(rows: PairRow[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) rec[k] = r.value.trim();
  }
  return rec;
}

function toSynonymRows(groups: string[][] | undefined): SynonymRow[] {
  return (groups ?? []).map((g) => ({ id: rid(), tokens: g.join(", ") }));
}

/** Parse a "a, b c" row into a deduped lowercase token group; drop groups < 2. */
function synonymRowsToGroups(rows: SynonymRow[]): string[][] {
  const groups: string[][] = [];
  for (const r of rows) {
    const tokens = Array.from(
      new Set(
        r.tokens
          .split(/[,\s]+/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    if (tokens.length >= 2) groups.push(tokens);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Reusable key→value pair editor
// ---------------------------------------------------------------------------

function PairEditor({
  rows, setRows, keyCol, valueCol, keyPlaceholder, valuePlaceholder, addLabel, removeLabel,
}: {
  rows: PairRow[];
  setRows: React.Dispatch<React.SetStateAction<PairRow[]>>;
  keyCol: string;
  valueCol: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  removeLabel: string;
}) {
  const update = (id: string, field: "key" | "value", value: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  const remove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const add = () => setRows((prev) => [...prev, { id: rid(), key: "", value: "" }]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-1">
        <Label className="text-xs text-muted-foreground">{keyCol}</Label>
        <span />
        <Label className="text-xs text-muted-foreground">{valueCol}</Label>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) => update(row.id, "key", e.target.value)}
            placeholder={keyPlaceholder}
            className="text-sm"
          />
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            value={row.value}
            onChange={(e) => update(row.id, "value", e.target.value)}
            placeholder={valuePlaceholder}
            className="text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-destructive hover:text-destructive"
            onClick={() => remove(row.id)}
            aria-label={removeLabel}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
        <Plus className="w-3.5 h-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PortalProgramMappingTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [unis, setUnis]            = useState<PortalUniversity[]>([]);
  const [unisLoading, setULdg]     = useState(true);
  const [selectedKey, setSelected] = useState<string>("");

  const [mappingRows, setMappingRows]   = useState<PairRow[]>([]);
  const [overrideRows, setOverrideRows] = useState<PairRow[]>([]);
  const [synonymRows, setSynonymRows]   = useState<SynonymRow[]>([]);
  const [countryRows, setCountryRows]   = useState<PairRow[]>([]);

  const [dataLoading, setDLdg] = useState(false);
  const [saving, setSaving]    = useState(false);

  // Load university list
  useEffect(() => {
    (async () => {
      try {
        const res = await customFetch<{ data: PortalUniversity[] }>(
          "/api/portal-universities?limit=200",
        );
        setUnis(res.data ?? []);
      } catch {
        toast({ title: t("portalAutomation.unis.loadError"), variant: "destructive" });
      } finally {
        setULdg(false);
      }
    })();
  }, [t, toast]);

  // Load all matching data for the selected university
  const loadData = useCallback(async (uniKey: string) => {
    if (!uniKey) return;
    setDLdg(true);
    try {
      const res = await customFetch<MappingResponse>(`/api/portal-program-mapping/${uniKey}`);
      setMappingRows(toPairRows(res.mappings));
      setOverrideRows(toPairRows(res.programOverrides));
      setSynonymRows(toSynonymRows(res.synonyms));
      setCountryRows(toPairRows(res.countryOverrides));
    } catch {
      toast({ title: t("portalAutomation.programMapping.loadError"), variant: "destructive" });
    } finally {
      setDLdg(false);
    }
  }, [t, toast]);

  const handleSelectUni = (key: string) => {
    setSelected(key);
    setMappingRows([]);
    setOverrideRows([]);
    setSynonymRows([]);
    setCountryRows([]);
    loadData(key);
  };

  const save = async () => {
    if (!selectedKey) return;
    setSaving(true);
    try {
      const mappings         = pairsToRecord(mappingRows);
      const programOverrides = pairsToRecord(overrideRows);
      const synonyms         = synonymRowsToGroups(synonymRows);
      const countryOverrides = pairsToRecord(countryRows);
      await customFetch(`/api/portal-program-mapping/${selectedKey}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mappings, programOverrides, synonyms, countryOverrides }),
      });
      // Re-normalise from the canonical shapes (dedupe, trim, drop short groups)
      setMappingRows(toPairRows(mappings));
      setOverrideRows(toPairRows(programOverrides));
      setSynonymRows(toSynonymRows(synonyms));
      setCountryRows(toPairRows(countryOverrides));
      toast({ title: t("portalAutomation.programMapping.saveSuccess") });
    } catch {
      toast({ title: t("portalAutomation.programMapping.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const selectedUni = unis.find((u) => u.universityKey === selectedKey);

  return (
    <div className="space-y-5 py-2">
      {/* University picker */}
      <Card className="rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("portalAutomation.programMapping.title")}</CardTitle>
          <CardDescription>{t("portalAutomation.programMapping.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {unisLoading ? (
            <Skeleton className="h-10 w-72" />
          ) : unis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("portalAutomation.programMapping.noUniversities")}
            </p>
          ) : (
            <Select value={selectedKey} onValueChange={handleSelectUni}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder={t("portalAutomation.programMapping.selectUniversity")} />
              </SelectTrigger>
              <SelectContent>
                {unis.map((u) => (
                  <SelectItem key={u.universityKey} value={u.universityKey}>
                    {u.universityName}
                    {!u.isActive && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({t("portalAutomation.programMapping.inactiveSuffix")})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {selectedKey && (
        dataLoading ? (
          <Card className="rounded-xl">
            <CardContent className="py-6 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Save bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {selectedUni?.universityName}
              </p>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                {saving
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                {saving
                  ? t("portalAutomation.programMapping.saving")
                  : t("portalAutomation.programMapping.saveButton")}
              </Button>
            </div>

            {/* 1. Label → CRM name mappings */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("portalAutomation.programMapping.mappingsTitle")}
                </CardTitle>
                <CardDescription>
                  {t("portalAutomation.programMapping.mappingsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PairEditor
                  rows={mappingRows}
                  setRows={setMappingRows}
                  keyCol={t("portalAutomation.programMapping.portalLabelCol")}
                  valueCol={t("portalAutomation.programMapping.crmNameCol")}
                  keyPlaceholder={t("portalAutomation.programMapping.portalLabelPlaceholder")}
                  valuePlaceholder={t("portalAutomation.programMapping.crmNamePlaceholder")}
                  addLabel={t("portalAutomation.programMapping.addPair")}
                  removeLabel={t("portalAutomation.programMapping.removePair")}
                />
              </CardContent>
            </Card>

            {/* 2. Program ID overrides */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("portalAutomation.programMapping.overridesTitle")}
                </CardTitle>
                <CardDescription>
                  {t("portalAutomation.programMapping.overridesDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PairEditor
                  rows={overrideRows}
                  setRows={setOverrideRows}
                  keyCol={t("portalAutomation.programMapping.overrideIdCol")}
                  valueCol={t("portalAutomation.programMapping.overrideValueCol")}
                  keyPlaceholder={t("portalAutomation.programMapping.overrideIdPlaceholder")}
                  valuePlaceholder={t("portalAutomation.programMapping.overrideValuePlaceholder")}
                  addLabel={t("portalAutomation.programMapping.addOverride")}
                  removeLabel={t("portalAutomation.programMapping.removeOverride")}
                />
              </CardContent>
            </Card>

            {/* 3. Synonyms */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("portalAutomation.programMapping.synonymsTitle")}
                </CardTitle>
                <CardDescription>
                  {t("portalAutomation.programMapping.synonymsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {synonymRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <Input
                        value={row.tokens}
                        onChange={(e) =>
                          setSynonymRows((prev) =>
                            prev.map((r) => (r.id === row.id ? { ...r, tokens: e.target.value } : r)),
                          )
                        }
                        placeholder={t("portalAutomation.programMapping.synonymsPlaceholder")}
                        className="text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-destructive hover:text-destructive"
                        onClick={() =>
                          setSynonymRows((prev) => prev.filter((r) => r.id !== row.id))
                        }
                        aria-label={t("portalAutomation.programMapping.removeSynonym")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSynonymRows((prev) => [...prev, { id: rid(), tokens: "" }])
                    }
                    className="gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("portalAutomation.programMapping.addSynonym")}
                  </Button>
                  <p className="text-xs text-muted-foreground pt-1">
                    {t("portalAutomation.programMapping.synonymsHint")}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 4. Country overrides */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {t("portalAutomation.programMapping.countriesTitle")}
                </CardTitle>
                <CardDescription>
                  {t("portalAutomation.programMapping.countriesDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PairEditor
                  rows={countryRows}
                  setRows={setCountryRows}
                  keyCol={t("portalAutomation.programMapping.countryKeyCol")}
                  valueCol={t("portalAutomation.programMapping.countryValueCol")}
                  keyPlaceholder={t("portalAutomation.programMapping.countryKeyPlaceholder")}
                  valuePlaceholder={t("portalAutomation.programMapping.countryValuePlaceholder")}
                  addLabel={t("portalAutomation.programMapping.addCountry")}
                  removeLabel={t("portalAutomation.programMapping.removeCountry")}
                />
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}
