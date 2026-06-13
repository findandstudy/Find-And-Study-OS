/**
 * PortalUniversitiesTab.tsx — SUB-STEP D
 *
 * Features:
 *  - Paginated university list with search
 *  - isActive toggle per row (PATCH /portal-universities/:id/active)
 *  - hasCredentials badge (green / red) — no actual creds shown
 *  - Test Login button per row (POST /portal-universities/:id/test-login)
 *  - Add University dialog (POST /portal-universities) — picks adapter from registry
 *  - Edit Defaults dialog (PATCH /portal-universities/:id) — defaults JSONB
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  FlaskConical,
  KeySquare,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortalUniversity {
  id: number;
  universityKey: string;
  universityName: string;
  adapterKey: string;
  defaults: Record<string, unknown> | null;
  isActive: boolean;
  hasCredentials: boolean;
  createdAt: string;
}

interface RegistryAdapter {
  key: string;
  label: string;
  kind: "code" | "declarative";
  hasCredentials: boolean;
}

interface UniversityListResponse {
  data: PortalUniversity[];
  total: number;
}

interface UniversityDefaults {
  intakeType?: string;
  semester?: string;
  degreeLevel?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ö/g, "o").replace(/ı/g, "i").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// AddUniversityDialog
// ---------------------------------------------------------------------------

interface AddDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (uni: PortalUniversity) => void;
  registryAdapters: RegistryAdapter[];
}

function AddUniversityDialog({ open, onClose, onCreated, registryAdapters }: AddDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [key, setKey]   = useState("");
  const [adapterKey, setAdapterKey] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving]     = useState(false);
  const [keyEdited, setKeyEdited] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) { setName(""); setKey(""); setAdapterKey(""); setIsActive(true); setKeyEdited(false); }
  }, [open]);

  // Auto-slug key from name unless user edited it manually
  useEffect(() => {
    if (!keyEdited) setKey(slugify(name));
  }, [name, keyEdited]);

  const submit = async () => {
    if (!name.trim() || !key.trim() || !adapterKey) return;
    setSaving(true);
    try {
      const uni = await customFetch<PortalUniversity>("/api/portal-universities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ universityName: name.trim(), universityKey: key.trim(), adapterKey, isActive }),
      });
      toast({ title: t("portalAutomation.unis.addDialog.saveSuccess") });
      onCreated(uni);
      onClose();
    } catch (err: unknown) {
      const body = (err as any)?.body;
      if (body?.error === "DUPLICATE_KEY") {
        toast({ title: t("portalAutomation.unis.addDialog.duplicateKey"), variant: "destructive" });
      } else {
        toast({ title: t("portalAutomation.unis.addDialog.saveError"), variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = name.trim() && key.trim() && adapterKey && !saving;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("portalAutomation.unis.addDialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* University name */}
          <div className="space-y-1.5">
            <Label htmlFor="uni-name">{t("portalAutomation.unis.addDialog.nameLabel")}</Label>
            <Input
              id="uni-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="İstanbul Üniversitesi"
              autoFocus
            />
          </div>

          {/* University key */}
          <div className="space-y-1.5">
            <Label htmlFor="uni-key">{t("portalAutomation.unis.addDialog.keyLabel")}</Label>
            <Input
              id="uni-key"
              value={key}
              onChange={(e) => { setKey(e.target.value); setKeyEdited(true); }}
              placeholder="istanbul_universitesi"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t("portalAutomation.unis.addDialog.keyHint")}
            </p>
          </div>

          {/* Adapter */}
          <div className="space-y-1.5">
            <Label>{t("portalAutomation.unis.addDialog.adapterLabel")}</Label>
            {registryAdapters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("portalAutomation.unis.addDialog.noAdapters")}
              </p>
            ) : (
              <Select value={adapterKey} onValueChange={setAdapterKey}>
                <SelectTrigger>
                  <SelectValue placeholder={t("portalAutomation.unis.addDialog.adapterLabel")} />
                </SelectTrigger>
                <SelectContent>
                  {registryAdapters.map((a) => (
                    <SelectItem key={a.key} value={a.key}>
                      <span className="font-medium">{a.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground font-mono">
                        ({a.key})
                      </span>
                      <Badge
                        variant={a.kind === "code" ? "default" : "secondary"}
                        className="ml-2 text-[10px] py-0 h-4"
                      >
                        {a.kind}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {t("portalAutomation.unis.addDialog.adapterHint")}
            </p>
          </div>

          {/* isActive */}
          <div className="flex items-center gap-3">
            <Switch id="uni-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="uni-active">{t("portalAutomation.unis.addDialog.isActiveLabel")}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving
              ? t("portalAutomation.unis.addDialog.saving")
              : t("portalAutomation.unis.addDialog.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// EditDefaultsDialog
// ---------------------------------------------------------------------------

interface EditDefaultsDialogProps {
  uni: PortalUniversity | null;
  onClose: () => void;
  onSaved: (updated: PortalUniversity) => void;
}

const INTAKE_OPTIONS = ["fall", "spring", "summer", "rolling"] as const;
const DEGREE_OPTIONS = ["bachelor", "master", "phd"] as const;

function EditDefaultsDialog({ uni, onClose, onSaved }: EditDefaultsDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const defaults = (uni?.defaults ?? {}) as UniversityDefaults;

  const [intakeType,  setIntakeType]  = useState(defaults.intakeType  ?? "");
  const [semester,    setSemester]    = useState(defaults.semester     ?? "");
  const [degreeLevel, setDegreeLevel] = useState(defaults.degreeLevel  ?? "");
  const [saving, setSaving] = useState(false);

  // Sync when uni changes
  useEffect(() => {
    const d = (uni?.defaults ?? {}) as UniversityDefaults;
    setIntakeType(d.intakeType ?? "");
    setSemester(d.semester ?? "");
    setDegreeLevel(d.degreeLevel ?? "");
  }, [uni]);

  const save = async () => {
    if (!uni) return;
    setSaving(true);
    const newDefaults: UniversityDefaults = {};
    if (intakeType)  newDefaults.intakeType  = intakeType;
    if (semester)    newDefaults.semester    = semester;
    if (degreeLevel) newDefaults.degreeLevel = degreeLevel;

    try {
      const updated = await customFetch<PortalUniversity>(`/api/portal-universities/${uni.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaults: Object.keys(newDefaults).length ? newDefaults : null,
        }),
      });
      toast({ title: t("portalAutomation.unis.defaultsDialog.saveSuccess") });
      onSaved(updated);
      onClose();
    } catch {
      toast({ title: t("portalAutomation.unis.defaultsDialog.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const intakeLabel = (val: string) => {
    const map: Record<string, string> = {
      fall: t("portalAutomation.unis.defaultsDialog.intakeFall"),
      spring: t("portalAutomation.unis.defaultsDialog.intakeSpring"),
      summer: t("portalAutomation.unis.defaultsDialog.intakeSummer"),
      rolling: t("portalAutomation.unis.defaultsDialog.intakeRolling"),
    };
    return map[val] ?? val;
  };

  const degreeLabel = (val: string) => {
    const map: Record<string, string> = {
      bachelor: t("portalAutomation.unis.defaultsDialog.degreeBachelor"),
      master: t("portalAutomation.unis.defaultsDialog.degreeMaster"),
      phd: t("portalAutomation.unis.defaultsDialog.degreePhd"),
    };
    return map[val] ?? val;
  };

  return (
    <Dialog open={!!uni} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("portalAutomation.unis.defaultsDialog.title")}
            {uni && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {uni.universityName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("portalAutomation.unis.defaultsDialog.description")}
        </p>

        <div className="space-y-4 py-1">
          {/* Intake type */}
          <div className="space-y-1.5">
            <Label>{t("portalAutomation.unis.defaultsDialog.intakeLabel")}</Label>
            <Select value={intakeType || "__none__"} onValueChange={(v) => setIntakeType(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t("portalAutomation.unis.defaultsDialog.intakeNone")}
                </SelectItem>
                {INTAKE_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{intakeLabel(o)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Semester */}
          <div className="space-y-1.5">
            <Label htmlFor="def-semester">{t("portalAutomation.unis.defaultsDialog.semesterLabel")}</Label>
            <Input
              id="def-semester"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder={t("portalAutomation.unis.defaultsDialog.semesterPlaceholder")}
            />
          </div>

          {/* Degree level */}
          <div className="space-y-1.5">
            <Label>{t("portalAutomation.unis.defaultsDialog.degreeLevelLabel")}</Label>
            <Select value={degreeLevel || "__none__"} onValueChange={(v) => setDegreeLevel(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t("portalAutomation.unis.defaultsDialog.degreeLevelNone")}
                </SelectItem>
                {DEGREE_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{degreeLabel(o)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving
              ? t("portalAutomation.unis.defaultsDialog.saving")
              : t("portalAutomation.unis.defaultsDialog.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CredentialsDialog — write-only; never shows plaintext credentials
// ---------------------------------------------------------------------------

interface CredentialsDialogProps {
  uni: PortalUniversity | null;
  onClose: () => void;
  onSaved:  (portalKey: string) => void;
  onCleared:(portalKey: string) => void;
}

function CredentialsDialog({ uni, onClose, onSaved, onCleared }: CredentialsDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [extra,    setExtra]    = useState("");
  const [saving,   setSaving]   = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [extraError, setExtraError] = useState("");

  useEffect(() => {
    if (uni) {
      setUsername("");
      setPassword("");
      setShowPw(false);
      setExtra("");
      setExtraError("");
      setConfirmClear(false);
    }
  }, [uni]);

  const validateExtra = (v: string): boolean => {
    if (!v.trim()) { setExtraError(""); return true; }
    try { JSON.parse(v); setExtraError(""); return true; }
    catch { setExtraError(t("portalAutomation.unis.credsDialog.extraInvalidJson")); return false; }
  };

  const handleSave = async () => {
    if (!uni || !username.trim() || !password.trim()) return;
    if (!validateExtra(extra)) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { username: username.trim(), password: password.trim() };
      if (extra.trim()) body.extra = JSON.parse(extra.trim());
      await customFetch(`/api/portal-universities/${uni.universityKey}/credentials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: t("portalAutomation.unis.credsDialog.saveSuccess") });
      onSaved(uni.universityKey);
      onClose();
    } catch {
      toast({ title: t("portalAutomation.unis.credsDialog.saveError"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!uni || !confirmClear) { setConfirmClear(true); return; }
    setClearing(true);
    try {
      await customFetch(`/api/portal-universities/${uni.universityKey}/credentials`, {
        method: "DELETE",
      });
      toast({ title: t("portalAutomation.unis.credsDialog.clearSuccess") });
      onCleared(uni.universityKey);
      onClose();
    } catch {
      toast({ title: t("portalAutomation.unis.credsDialog.clearError"), variant: "destructive" });
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };

  const canSave = username.trim() && password.trim() && !saving && !clearing;

  return (
    <Dialog open={!!uni} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("portalAutomation.unis.credsDialog.title")}
            {uni && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {uni.universityName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("portalAutomation.unis.credsDialog.description")}
        </p>

        <div className="space-y-4 py-1">
          {/* Username */}
          <div className="space-y-1.5">
            <Label htmlFor="cred-username">
              {t("portalAutomation.unis.credsDialog.usernameLabel")}
            </Label>
            <Input
              id="cred-username"
              autoComplete="off"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="portal@example.com"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="cred-password">
              {t("portalAutomation.unis.credsDialog.passwordLabel")}
            </Label>
            <div className="relative">
              <Input
                id="cred-password"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Extra JSON (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="cred-extra">
              {t("portalAutomation.unis.credsDialog.extraLabel")}
            </Label>
            <Textarea
              id="cred-extra"
              value={extra}
              onChange={(e) => { setExtra(e.target.value); validateExtra(e.target.value); }}
              placeholder='{"token": "..."}'
              rows={3}
              className="font-mono text-xs resize-none"
            />
            {extraError ? (
              <p className="text-xs text-destructive">{extraError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("portalAutomation.unis.credsDialog.extraHint")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {/* Clear credentials (only when creds exist) */}
          {uni?.hasCredentials && (
            <Button
              variant={confirmClear ? "destructive" : "outline"}
              size="sm"
              disabled={saving || clearing}
              onClick={handleClear}
              className="sm:mr-auto gap-1.5"
            >
              {clearing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
              {clearing
                ? t("portalAutomation.unis.credsDialog.clearing")
                : confirmClear
                  ? t("portalAutomation.unis.credsDialog.clearConfirm")
                  : t("portalAutomation.unis.credsDialog.clearButton")}
            </Button>
          )}

          <Button variant="outline" onClick={onClose} disabled={saving || clearing}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {saving
              ? t("portalAutomation.unis.credsDialog.saving")
              : t("portalAutomation.unis.credsDialog.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// UniversityRow
// ---------------------------------------------------------------------------

interface RowProps {
  uni: PortalUniversity;
  onToggle: (id: number, active: boolean) => Promise<void>;
  onTestLogin: (id: number) => Promise<void>;
  onEditDefaults: (uni: PortalUniversity) => void;
  onManageCreds: (uni: PortalUniversity) => void;
  togglingId: number | null;
  testingId:  number | null;
}

function UniversityRow({ uni, onToggle, onTestLogin, onEditDefaults, onManageCreds, togglingId, testingId }: RowProps) {
  const { t } = useI18n();
  const isToggling = togglingId === uni.id;
  const isTesting  = testingId  === uni.id;
  const defaults   = (uni.defaults ?? {}) as UniversityDefaults;
  const hasDefaults = !!(defaults.intakeType || defaults.semester || defaults.degreeLevel);

  return (
    <Card className="rounded-xl overflow-hidden">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground truncate">
                {uni.universityName}
              </span>
              {/* Credentials badge */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      {uni.hasCredentials ? (
                        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs py-0">
                          <CheckCircle2 className="w-3 h-3" />
                          {t("portalAutomation.unis.credentialsOk")}
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 text-xs py-0">
                          <XCircle className="w-3 h-3" />
                          {t("portalAutomation.unis.credentialsMissing")}
                        </Badge>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {uni.hasCredentials
                      ? t("portalAutomation.unis.credentialsOk")
                      : t("portalAutomation.unis.credentialsMissing")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {/* Sub-info */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {uni.universityKey}
              </code>
              <span className="text-[11px] text-muted-foreground">·</span>
              <Badge variant="outline" className="text-[11px] py-0 h-4 gap-1">
                <KeySquare className="w-2.5 h-2.5" />
                {uni.adapterKey}
              </Badge>
              {hasDefaults && (
                <>
                  <span className="text-[11px] text-muted-foreground">·</span>
                  <span className="text-[11px] text-muted-foreground">
                    {[defaults.intakeType, defaults.semester, defaults.degreeLevel]
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* isActive toggle */}
            <div className="flex items-center gap-1.5">
              {isToggling
                ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                : (
                  <Switch
                    checked={uni.isActive}
                    onCheckedChange={(v) => onToggle(uni.id, v)}
                    aria-label={t("portalAutomation.unis.activeLabel")}
                  />
                )}
              <span className="text-xs text-muted-foreground">
                {t("portalAutomation.unis.activeLabel")}
              </span>
            </div>

            {/* Defaults button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => onEditDefaults(uni)}
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    {t("portalAutomation.unis.defaultsButton")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("portalAutomation.unis.defaultsDialog.description")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Credentials button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 gap-1.5 ${!uni.hasCredentials ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950" : ""}`}
                    onClick={() => onManageCreds(uni)}
                  >
                    <KeySquare className="w-3.5 h-3.5" />
                    {t("portalAutomation.unis.credsButton")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("portalAutomation.unis.credsDialog.description")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Test Login button */}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => onTestLogin(uni.id)}
              disabled={isTesting}
            >
              {isTesting
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FlaskConical className="w-3.5 h-3.5" />}
              {isTesting
                ? t("portalAutomation.unis.testLoginTesting")
                : t("portalAutomation.unis.testLoginButton")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function PortalUniversitiesTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [unis, setUnis]       = useState<PortalUniversity[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const searchTimer           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [testingId,  setTestingId]  = useState<number | null>(null);

  const [addOpen, setAddOpen]         = useState(false);
  const [editTarget, setEditTarget]   = useState<PortalUniversity | null>(null);
  const [credsTarget, setCredsTarget] = useState<PortalUniversity | null>(null);
  const [registryAdapters, setRegistryAdapters] = useState<RegistryAdapter[]>([]);

  // Load universities
  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q.trim()) params.set("search", q.trim());
      const res = await customFetch<UniversityListResponse>(
        `/api/portal-universities?${params}`,
      );
      setUnis(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      toast({ title: t("portalAutomation.unis.loadError"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  // Load registry adapters (for Add dialog)
  const loadAdapters = useCallback(async () => {
    try {
      const res = await customFetch<{ registry: RegistryAdapter[]; db: unknown[] }>(
        "/api/portal-adapters",
      );
      setRegistryAdapters(res.registry ?? []);
    } catch {
      // Non-fatal — adapter list just won't populate the select
    }
  }, []);

  useEffect(() => { load(""); loadAdapters(); }, [load, loadAdapters]);

  // Debounced search
  const handleSearch = (q: string) => {
    setSearch(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(q), 350);
  };

  // Toggle isActive
  const handleToggle = async (id: number, active: boolean) => {
    setTogglingId(id);
    try {
      const updated = await customFetch<PortalUniversity>(
        `/api/portal-universities/${id}/active`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: active }),
        },
      );
      setUnis((prev) => prev.map((u) => (u.id === id ? { ...u, ...updated } : u)));
      toast({ title: t("portalAutomation.unis.toggleSuccess") });
    } catch {
      toast({ title: t("portalAutomation.unis.toggleError"), variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  };

  // Test login
  const handleTestLogin = async (id: number) => {
    setTestingId(id);
    try {
      const res = await customFetch<{ ok: boolean; message: string }>(
        `/api/portal-universities/${id}/test-login`,
        { method: "POST" },
      );
      if (res.ok) {
        toast({ title: t("portalAutomation.unis.testLoginSuccess"), description: res.message });
      } else {
        toast({
          title: t("portalAutomation.unis.testLoginFailed"),
          description: res.message,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: t("portalAutomation.unis.testLoginFailed"), variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  };

  // After creation — prepend to list
  const handleCreated = (uni: PortalUniversity) => {
    setUnis((prev) => [uni, ...prev]);
    setTotal((n) => n + 1);
  };

  // After defaults saved — merge into list
  const handleDefaultsSaved = (updated: PortalUniversity) => {
    setUnis((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
  };

  // After credentials saved — mark hasCredentials=true
  const handleCredsSaved = (portalKey: string) => {
    setUnis((prev) => prev.map((u) => u.universityKey === portalKey ? { ...u, hasCredentials: true } : u));
  };

  // After credentials cleared — mark hasCredentials=false
  const handleCredsCleared = (portalKey: string) => {
    setUnis((prev) => prev.map((u) => u.universityKey === portalKey ? { ...u, hasCredentials: false } : u));
  };

  return (
    <div className="space-y-4 py-2">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("portalAutomation.unis.searchPlaceholder")}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Button
          className="gap-2 shrink-0"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="w-4 h-4" />
          {t("portalAutomation.unis.addButton")}
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : unis.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {t("portalAutomation.unis.noData")}
        </div>
      ) : (
        <div className="space-y-3">
          {unis.map((uni) => (
            <UniversityRow
              key={uni.id}
              uni={uni}
              onToggle={handleToggle}
              onTestLogin={handleTestLogin}
              onEditDefaults={setEditTarget}
              onManageCreds={setCredsTarget}
              togglingId={togglingId}
              testingId={testingId}
            />
          ))}
          {total > unis.length && (
            <p className="text-xs text-center text-muted-foreground pt-1">
              {unis.length} / {total}
            </p>
          )}
        </div>
      )}

      {/* Add University dialog */}
      <AddUniversityDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
        registryAdapters={registryAdapters}
      />

      {/* Edit Defaults dialog */}
      <EditDefaultsDialog
        uni={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={handleDefaultsSaved}
      />

      {/* Credentials dialog */}
      <CredentialsDialog
        uni={credsTarget}
        onClose={() => setCredsTarget(null)}
        onSaved={handleCredsSaved}
        onCleared={handleCredsCleared}
      />
    </div>
  );
}
