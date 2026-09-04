/**
 * AdapterSpecsSection.tsx — declarative adapter SPEC management (opt-in engine)
 *
 * Manages the richer, VERSIONED portal_adapter_specs alongside the flat
 * portal_adapters table. Admins can:
 *   - upload + validate a spec JSON (POST /adapter-specs/validate, /adapter-specs)
 *   - enable / disable / rollback versions (PATCH /adapter-specs/{key})
 *   - view the full version history (GET /adapter-specs/{key}/versions)
 *
 * jsHook trust is super_admin-only: uploading a spec containing jsHook steps,
 * and approving jsHook execution, are both gated to super_admin in the UI and
 * re-enforced on the server.
 */

import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Loader2, Upload, CheckCircle2, XCircle, History,
  ShieldCheck, ShieldAlert, RotateCcw,
} from "lucide-react";
import { PortalEmptyState } from "@/components/admin/PortalTabStates";

// ---------------------------------------------------------------------------
// Types (mirror the OpenAPI schemas)
// ---------------------------------------------------------------------------

interface SpecSummary {
  key: string;
  name: string;
  latestVersion: number;
  enabledVersion: number | null;
  versionCount: number;
  source: "builtin" | "uploaded";
  jsHookApproved: boolean;
  hasJsHook: boolean;
  privilegedApproved: boolean;
  privileged: boolean;
  latestSha256: string;
  latestActivationBlockers: string[];
  updatedAt: string;
}

interface SpecVersion {
  version: number;
  name: string;
  enabled: boolean;
  source: "builtin" | "uploaded";
  jsHookApproved: boolean;
  hasJsHook: boolean;
  privilegedApproved: boolean;
  privileged: boolean;
  sha256: string;
  activationBlockers: string[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface SpecIssue {
  path: string;
  message: string;
}

interface ValidationResponse {
  ok: boolean;
  key?: string;
  name?: string;
  hasJsHook?: boolean;
  privileged?: boolean;
  sha256?: string;
  byteLength?: number;
  activationBlockers?: string[];
  activationRequiresSeparateStep?: boolean;
  error?: string;
  message?: string;
  issues?: SpecIssue[];
}

// ---------------------------------------------------------------------------
// Upload + validate dialog
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  open: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function AdapterSpecDialog({ open, isSuperAdmin, onClose, onSaved }: UploadDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [json, setJson] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setJson("");
      setResult(null);
    }
  }, [open]);

  const parseJson = (): Record<string, unknown> | undefined => {
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text);
      setJson(text);
      setResult(null);
    } catch {
      toast({ title: t("portalAutomation.adapterSpecs.invalidJson"), variant: "destructive" });
    }
  };

  const validate = async () => {
    const spec = parseJson();
    if (spec === undefined) {
      toast({ title: t("portalAutomation.adapterSpecs.invalidJson"), variant: "destructive" });
      return;
    }
    setValidating(true);
    try {
      const res = await customFetch<ValidationResponse>(
        "/api/portal-automation/adapter-specs/validate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec }),
        },
      );
      setResult(res);
    } catch {
      toast({ title: t("portalAutomation.adapterSpecs.validateError"), variant: "destructive" });
    } finally {
      setValidating(false);
    }
  };

  const save = async () => {
    const spec = parseJson();
    if (spec === undefined) {
      toast({ title: t("portalAutomation.adapterSpecs.invalidJson"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch("/api/portal-automation/adapter-specs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      toast({ title: t("portalAutomation.adapterSpecs.saveSuccess") });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const body = (err as { body?: { error?: string } })?.body;
      if (body?.error === "PRIVILEGED_APPROVAL_REQUIRED") {
        toast({ title: t("portalAutomation.adapterSpecs.privilegedApprovalRequired"), variant: "destructive" });
      } else if (body?.error === "JSHOOK_FORBIDDEN") {
        toast({ title: t("portalAutomation.adapterSpecs.jsHookForbidden"), variant: "destructive" });
      } else if (body?.error === "INVALID_SPEC") {
        toast({ title: t("portalAutomation.adapterSpecs.invalidSpec"), variant: "destructive" });
      } else {
        toast({ title: t("portalAutomation.adapterSpecs.saveError"), variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const specHasJsHook = result?.ok === true && result.hasJsHook === true;
  const canSave = json.trim().length > 0 && !saving && result?.ok === true;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("portalAutomation.adapterSpecs.uploadTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={t("portalAutomation.adapterSpecs.workflowLabel")}>
            {["workflowUpload", "workflowApprove", "workflowActivate"].map((key, index) => (
              <div key={key} className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {index + 1}
                </div>
                <div className="text-xs font-medium">{t(`portalAutomation.adapterSpecs.${key}`)}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="spec-json">{t("portalAutomation.adapterSpecs.jsonLabel")}</Label>
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("portalAutomation.adapterSpecs.uploadFile")}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t("portalAutomation.adapterSpecs.uploadFile")}
                </Button>
              </>
            </div>
            <Textarea
              id="spec-json"
              value={json}
              onChange={(e) => { setJson(e.target.value); setResult(null); }}
              placeholder={t("portalAutomation.adapterSpecs.jsonPlaceholder")}
              className="font-mono text-xs min-h-[220px] resize-y"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              {t("portalAutomation.adapterSpecs.jsonHint")}
            </p>
          </div>

          {/* Validation result */}
          {result && (
            result.ok ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("portalAutomation.adapterSpecs.validOk", { key: result.key ?? "", name: result.name ?? "" })}
                </div>
                {result.hasJsHook && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t("portalAutomation.adapterSpecs.containsJsHook")}
                  </div>
                )}
                {result.privileged && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t("portalAutomation.adapterSpecs.containsPrivileged")}
                  </div>
                )}
                {result.sha256 && (
                  <div className="pt-1 text-xs text-muted-foreground">
                    {t("portalAutomation.adapterSpecs.fingerprint")}: {" "}
                    <code className="font-mono" title={result.sha256}>{result.sha256.slice(0, 16)}…</code>
                    {result.byteLength !== undefined && (
                      <span> · {result.byteLength.toLocaleString()} B</span>
                    )}
                  </div>
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  {t("portalAutomation.adapterSpecs.savedInactiveHint")}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                  <XCircle className="h-4 w-4" />
                  {t("portalAutomation.adapterSpecs.validFailed")}
                </div>
                <ul className="text-xs text-red-600 dark:text-red-300 space-y-0.5 pl-5 list-disc">
                  {(result.issues ?? []).slice(0, 12).map((iss, i) => (
                    <li key={i}>
                      <code className="font-mono">{iss.path}</code>: {iss.message}
                    </li>
                  ))}
                  {(result.issues ?? []).length === 0 && result.error && (
                    <li>{result.error}</li>
                  )}
                </ul>
              </div>
            )
          )}

          {specHasJsHook && !isSuperAdmin && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t("portalAutomation.adapterSpecs.jsHookSuperAdminOnly")}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving || validating}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={validate} disabled={validating || !json.trim()}>
            {validating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("portalAutomation.adapterSpecs.validateButton")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("portalAutomation.adapterSpecs.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Version history dialog
// ---------------------------------------------------------------------------

interface VersionsDialogProps {
  specKey: string | null;
  isSuperAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function VersionsDialog({ specKey, isSuperAdmin, onClose, onChanged }: VersionsDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [versions, setVersions] = useState<SpecVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!specKey) return;
    setLoading(true);
    try {
      const res = await customFetch<{ key: string; versions: SpecVersion[] }>(
        `/api/portal-automation/adapter-specs/${encodeURIComponent(specKey)}/versions`,
      );
      setVersions(res.versions ?? []);
    } catch {
      toast({ title: t("portalAutomation.adapterSpecs.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [specKey, t, toast]);

  useEffect(() => { if (specKey) load(); }, [specKey, load]);

  const patch = async (body: Record<string, unknown>, version: number) => {
    if (!specKey) return;
    setBusyVersion(version);
    try {
      await customFetch(`/api/portal-automation/adapter-specs/${encodeURIComponent(specKey)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      onChanged();
    } catch (err: unknown) {
      const error = (err as { body?: { error?: string } })?.body?.error;
      toast({
        title:
          error === "PRIVILEGED_APPROVAL_REQUIRED" || error === "JSHOOK_APPROVAL_REQUIRED"
            ? t("portalAutomation.adapterSpecs.approvalRequired")
            : t("portalAutomation.adapterSpecs.patchError"),
        variant: "destructive",
      });
    } finally {
      setBusyVersion(null);
    }
  };

  return (
    <Dialog open={!!specKey} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("portalAutomation.adapterSpecs.versionsTitle", { key: specKey ?? "" })}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {t("portalAutomation.adapterSpecs.noVersions")}
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border overflow-hidden">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center gap-3 px-4 py-3 bg-card flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">v{v.version}</span>
                    {v.enabled && (
                      <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 text-[11px] py-0 h-4">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {t("portalAutomation.adapterSpecs.enabledBadge")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[11px] py-0 h-4">{v.source}</Badge>
                    {v.hasJsHook && (
                      <Badge className="gap-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 text-[11px] py-0 h-4">
                        <ShieldAlert className="w-2.5 h-2.5" />
                        {v.jsHookApproved
                          ? t("portalAutomation.adapterSpecs.jsHookApprovedBadge")
                          : t("portalAutomation.adapterSpecs.jsHookBadge")}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <code className="text-[10px] text-muted-foreground" title={v.sha256}>
                      SHA-256 {v.sha256.slice(0, 12)}…
                    </code>
                    {v.activationBlockers.map((blocker) => (
                      <Badge key={blocker} variant="outline" className="h-4 border-amber-300 text-[10px] text-amber-700 dark:text-amber-400">
                        {t(`portalAutomation.adapterSpecs.blockers.${blocker}`)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {isSuperAdmin && v.privileged && (
                    <Button
                      variant={v.privilegedApproved ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      disabled={busyVersion !== null}
                      onClick={() => patch({
                        approvalVersion: v.version,
                        privilegedApproved: !v.privilegedApproved,
                      }, v.version)}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      {v.privilegedApproved
                        ? t("portalAutomation.adapterSpecs.revokePrivileged")
                        : t("portalAutomation.adapterSpecs.approvePrivileged")}
                    </Button>
                  )}
                  {isSuperAdmin && v.hasJsHook && (
                    <Button
                      variant={v.jsHookApproved ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      disabled={busyVersion !== null}
                      onClick={() => patch({
                        approvalVersion: v.version,
                        jsHookApproved: !v.jsHookApproved,
                      }, v.version)}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      {v.jsHookApproved
                        ? t("portalAutomation.adapterSpecs.revokeJsHook")
                        : t("portalAutomation.adapterSpecs.approveJsHook")}
                    </Button>
                  )}
                  {!v.enabled && (
                    <Button
                      variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
                      disabled={busyVersion !== null || v.activationBlockers.length > 0}
                      title={v.activationBlockers.length > 0
                        ? t("portalAutomation.adapterSpecs.approvalRequired")
                        : undefined}
                      onClick={() => patch({ rollbackTo: v.version }, v.version)}
                    >
                      {busyVersion === v.version
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <RotateCcw className="w-3 h-3" />}
                      {t("portalAutomation.adapterSpecs.enableVersion")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export default function AdapterSpecsSection() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionsKey, setVersionsKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customFetch<{ specs: SpecSummary[] }>(
        "/api/portal-automation/adapter-specs",
      );
      setSpecs(res.specs ?? []);
    } catch {
      toast({ title: t("portalAutomation.adapterSpecs.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  const toggleEnabled = async (spec: SpecSummary, enabled: boolean) => {
    setBusyKey(spec.key);
    try {
      const body = enabled
        ? { enableVersion: spec.latestVersion }
        : { disable: true };
      await customFetch(`/api/portal-automation/adapter-specs/${encodeURIComponent(spec.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } catch {
      toast({ title: t("portalAutomation.adapterSpecs.patchError"), variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {t("portalAutomation.adapterSpecs.sectionTitle")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("portalAutomation.adapterSpecs.sectionDescription")}
            </CardDescription>
          </div>
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            {t("portalAutomation.adapterSpecs.uploadButton")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : specs.length === 0 ? (
          <PortalEmptyState
            icon={History}
            title={t("portalAutomation.adapterSpecs.emptyTitle")}
            description={t("portalAutomation.adapterSpecs.emptyDescription")}
            action={
              <Button size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                {t("portalAutomation.adapterSpecs.uploadButton")}
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border rounded-lg border overflow-hidden">
            {specs.map((s) => (
              <div key={s.key} className="flex items-center gap-3 px-4 py-3 bg-card flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge variant="outline" className="text-[11px] py-0 h-4">{s.source}</Badge>
                    {s.enabledVersion !== null ? (
                      <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 text-[11px] py-0 h-4">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {t("portalAutomation.adapterSpecs.enabledVersionBadge", { version: s.enabledVersion })}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[11px] py-0 h-4 text-muted-foreground">
                        {t("portalAutomation.adapterSpecs.disabledBadge")}
                      </Badge>
                    )}
                    {s.hasJsHook && (
                      <Badge className="gap-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 text-[11px] py-0 h-4">
                        <ShieldAlert className="w-2.5 h-2.5" />
                        {s.jsHookApproved
                          ? t("portalAutomation.adapterSpecs.jsHookApprovedBadge")
                          : t("portalAutomation.adapterSpecs.jsHookBadge")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-[11px] text-muted-foreground">{s.key}</code>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <span className="text-[11px] text-muted-foreground">
                      {t("portalAutomation.adapterSpecs.versionCount", { count: s.versionCount })}
                    </span>
                    <span className="text-[11px] text-muted-foreground">·</span>
                    <code className="text-[10px] text-muted-foreground" title={s.latestSha256}>
                      SHA-256 {s.latestSha256.slice(0, 12)}…
                    </code>
                  </div>
                  {s.latestActivationBlockers.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      {s.latestActivationBlockers.map((blocker) => (
                        <Badge key={blocker} variant="outline" className="h-4 border-amber-300 text-[10px] text-amber-700 dark:text-amber-400">
                          {t(`portalAutomation.adapterSpecs.blockers.${blocker}`)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={s.enabledVersion !== null}
                    disabled={
                      busyKey === s.key ||
                      (s.enabledVersion === null && s.latestActivationBlockers.length > 0)
                    }
                    title={
                      s.enabledVersion === null && s.latestActivationBlockers.length > 0
                        ? t("portalAutomation.adapterSpecs.approvalRequired")
                        : undefined
                    }
                    onCheckedChange={(v) => toggleEnabled(s, v)}
                    aria-label={t("portalAutomation.adapterSpecs.toggleEnabled")}
                  />
                  <Button
                    variant="ghost" size="sm" className="h-8 gap-1.5 text-xs"
                    onClick={() => setVersionsKey(s.key)}
                  >
                    <History className="w-3.5 h-3.5" />
                    {t("portalAutomation.adapterSpecs.versionsButton")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AdapterSpecDialog
        open={uploadOpen}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setUploadOpen(false)}
        onSaved={load}
      />
      <VersionsDialog
        specKey={versionsKey}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setVersionsKey(null)}
        onChanged={load}
      />
    </Card>
  );
}
