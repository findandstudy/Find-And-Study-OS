/**
 * PortalProgramMappingTab.tsx — SUB-STEP E
 *
 * Per-university program label → CRM program name dictionary editor.
 * GET  /api/portal-program-mapping/:universityKey
 * PUT  /api/portal-program-mapping/:universityKey
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

interface MappingRow {
  id: string;          // local uuid-ish key for React list rendering
  portalLabel: string;
  crmName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRows(mappings: Record<string, string>): MappingRow[] {
  return Object.entries(mappings).map(([portalLabel, crmName], i) => ({
    id: `${i}-${portalLabel}`,
    portalLabel,
    crmName,
  }));
}

function toRecord(rows: MappingRow[]): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const r of rows) {
    const k = r.portalLabel.trim();
    if (k) rec[k] = r.crmName.trim();
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PortalProgramMappingTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [unis, setUnis]           = useState<PortalUniversity[]>([]);
  const [unisLoading, setULdg]    = useState(true);
  const [selectedKey, setSelected] = useState<string>("");

  const [rows, setRows]           = useState<MappingRow[]>([]);
  const [mappingsLoading, setMLdg] = useState(false);
  const [saving, setSaving]       = useState(false);

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

  // Load mappings when university selected
  const loadMappings = useCallback(async (uniKey: string) => {
    if (!uniKey) return;
    setMLdg(true);
    try {
      const res = await customFetch<{ mappings: Record<string, string> }>(
        `/api/portal-program-mapping/${uniKey}`,
      );
      setRows(toRows(res.mappings ?? {}));
    } catch {
      toast({ title: t("portalAutomation.programMapping.loadError"), variant: "destructive" });
    } finally {
      setMLdg(false);
    }
  }, [t, toast]);

  const handleSelectUni = (key: string) => {
    setSelected(key);
    setRows([]);
    loadMappings(key);
  };

  const addRow = () => {
    setRows((prev) => [...prev, { id: `new-${Date.now()}`, portalLabel: "", crmName: "" }]);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: "portalLabel" | "crmName", value: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const save = async () => {
    if (!selectedKey) return;
    setSaving(true);
    try {
      const mappings = toRecord(rows);
      await customFetch(`/api/portal-program-mapping/${selectedKey}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      // Re-normalise rows (deduplicate, trim)
      setRows(toRows(mappings));
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
                      <span className="ml-1.5 text-xs text-muted-foreground">(pasif)</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Mappings editor */}
      {selectedKey && (
        <Card className="rounded-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">
                  {t("portalAutomation.programMapping.mappingsTitle")}
                  {selectedUni && (
                    <span className="ml-2 font-normal text-muted-foreground text-sm">
                      — {selectedUni.universityName}
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="mt-1">
                  {t("portalAutomation.programMapping.mappingsDescription")}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  {t("portalAutomation.programMapping.addPair")}
                </Button>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                  {saving
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Save className="w-3.5 h-3.5" />}
                  {saving
                    ? t("portalAutomation.programMapping.saving")
                    : t("portalAutomation.programMapping.saveButton")}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {mappingsLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("portalAutomation.programMapping.emptyMappings")}
              </p>
            ) : (
              <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-1">
                  <Label className="text-xs text-muted-foreground">
                    {t("portalAutomation.programMapping.portalLabelCol")}
                  </Label>
                  <span />
                  <Label className="text-xs text-muted-foreground">
                    {t("portalAutomation.programMapping.crmNameCol")}
                  </Label>
                  <span />
                </div>
                {/* Rows */}
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"
                  >
                    <Input
                      value={row.portalLabel}
                      onChange={(e) => updateRow(row.id, "portalLabel", e.target.value)}
                      placeholder={t("portalAutomation.programMapping.portalLabelPlaceholder")}
                      className="text-sm"
                    />
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                      value={row.crmName}
                      onChange={(e) => updateRow(row.id, "crmName", e.target.value)}
                      placeholder={t("portalAutomation.programMapping.crmNamePlaceholder")}
                      className="text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 text-destructive hover:text-destructive"
                      onClick={() => removeRow(row.id)}
                      aria-label={t("portalAutomation.programMapping.removePair")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {t("portalAutomation.programMapping.pairsCount", {
                    count: String(rows.length),
                  })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
