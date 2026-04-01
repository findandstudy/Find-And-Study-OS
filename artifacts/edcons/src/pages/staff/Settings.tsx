import { useState, useEffect, useRef, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { useTheme } from "@/contexts/ThemeContext";
import {
  User, Globe, Bell, Shield, Save, Check, Loader2, Phone, Mail,
  Palette, Upload, X, Sun, Moon, Monitor, Image as ImageIcon, Plug,
  Building2, Search as SearchIcon, FileText, Code, ChevronRight, Copy,
  ExternalLink, Eye, Info, AlertTriangle, Instagram, Linkedin,
  Youtube, Facebook, Twitter, Camera, Kanban, Pencil, ChevronDown,
  CalendarDays, Plus, Trash2, GripVertical, Power, Link as LinkIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationRulesManager } from "@/components/NotificationRulesManager";
import { CountryFlag } from "@/components/CountryFlag";
import { IntegrationsManager } from "@/components/IntegrationsManager";
import { usePipelineStages } from "@/hooks/use-pipeline-stages";
import { EditStagesDialog } from "@/components/EditStagesDialog";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const LANGUAGES = [
  { code: "en", label: "English", country: "GB" },
  { code: "tr", label: "Türkçe", country: "TR" },
  { code: "ar", label: "العربية", country: "SA" },
  { code: "fr", label: "Français", country: "FR" },
  { code: "ru", label: "Русский", country: "RU" },
];

const PHONE_CODES = [
  { code: "+90", country: "TR" }, { code: "+1", country: "US" }, { code: "+44", country: "GB" },
  { code: "+49", country: "DE" }, { code: "+33", country: "FR" }, { code: "+39", country: "IT" },
  { code: "+34", country: "ES" }, { code: "+31", country: "NL" }, { code: "+46", country: "SE" },
  { code: "+47", country: "NO" }, { code: "+45", country: "DK" }, { code: "+41", country: "CH" },
  { code: "+43", country: "AT" }, { code: "+48", country: "PL" }, { code: "+7", country: "RU" },
  { code: "+380", country: "UA" }, { code: "+86", country: "CN" }, { code: "+81", country: "JP" },
  { code: "+82", country: "KR" }, { code: "+91", country: "IN" }, { code: "+92", country: "PK" },
  { code: "+93", country: "AF" }, { code: "+966", country: "SA" }, { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" }, { code: "+98", country: "IR" }, { code: "+962", country: "JO" },
  { code: "+961", country: "LB" }, { code: "+20", country: "EG" }, { code: "+212", country: "MA" },
  { code: "+234", country: "NG" }, { code: "+254", country: "KE" }, { code: "+55", country: "BR" },
  { code: "+52", country: "MX" }, { code: "+61", country: "AU" }, { code: "+64", country: "NZ" },
  { code: "+60", country: "MY" }, { code: "+65", country: "SG" }, { code: "+66", country: "TH" },
  { code: "+84", country: "VN" }, { code: "+62", country: "ID" }, { code: "+63", country: "PH" },
  { code: "+880", country: "BD" }, { code: "+94", country: "LK" }, { code: "+977", country: "NP" },
  { code: "+251", country: "ET" }, { code: "+255", country: "TZ" }, { code: "+233", country: "GH" },
];

function parsePhoneCode(fullPhone: string): { phoneCode: string; phone: string } {
  if (!fullPhone) return { phoneCode: "+90", phone: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find(pc => fullPhone.startsWith(pc.code));
  if (matched) return { phoneCode: matched.code, phone: fullPhone.slice(matched.code.length) };
  const intlMatch = fullPhone.match(/^(\+\d{1,4})(.*)/);
  if (intlMatch) return { phoneCode: intlMatch[1], phone: intlMatch[2] };
  return { phoneCode: "+90", phone: fullPhone };
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager",
  staff: "Staff", consultant: "Consultant", accountant: "Accountant", editor: "Editor",
  student: "Student", agent: "Agent", sub_agent: "Sub Agent",
};

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display font-bold text-xl text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
  );
}

function FieldGroup({ label, description, children, className }: { label: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label className="text-sm font-semibold">{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

function ColorField({ label, description, value, onChange, defaultColor }: { label: string; description: string; value: string; onChange: (v: string) => void; defaultColor: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:border-primary/20 transition-colors">
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer overflow-hidden"
          style={{ backgroundColor: value || defaultColor }}
          onClick={() => document.getElementById(`color-${label.replace(/\s/g, "")}`)?.click()} />
        <input id={`color-${label.replace(/\s/g, "")}`} type="color" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          value={value || defaultColor}
          onChange={e => onChange(e.target.value)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder={defaultColor} className="w-28 rounded-lg text-xs font-mono h-8" />
        {value && <button onClick={() => onChange("")} className="text-muted-foreground hover:text-destructive transition-colors"><X className="w-4 h-4" /></button>}
      </div>
    </div>
  );
}

function LogoUploader({ label, description, value, onChange, bgClass, dims }: { label: string; description?: string; value: string; onChange: (v: string) => void; bgClass?: string; dims?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  async function upload(file: File) {
    setUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!(urlRes as any).uploadURL || !(urlRes as any).objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch((urlRes as any).uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const strippedPath = (urlRes as any).objectPath.replace(/^\/objects/, "");
      onChange(`${BASE_URL}/api/storage/objects${strippedPath}`);
      toast({ title: `${label} uploaded` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      {dims && <p className="text-[11px] text-muted-foreground">Recommended: {dims}</p>}
      <div className={`relative w-full h-28 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden ${bgClass || "bg-secondary/20"}`}>
        {value ? (
          <>
            <img src={value} alt={label} className="max-h-20 max-w-full object-contain" />
            <button onClick={() => onChange("")}
              className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive"><X className="w-3 h-3" /></button>
          </>
        ) : (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex flex-col items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors">
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
            <span className="text-[10px] font-medium">{uploading ? "Uploading..." : "Upload"}</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
    </div>
  );
}

function SaveButton({ onClick, saving, label }: { onClick: () => void; saving: boolean; label?: string }) {
  return (
    <Button onClick={onClick} disabled={saving} className="rounded-xl gap-2 px-8">
      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {label || "Save Changes"}
    </Button>
  );
}

type SettingsTab = "profile" | "language" | "notifications" | "security" | "pipeline" | "seasons" | "branding" | "company" | "seo" | "email" | "documents" | "studentDocuments" | "integrations" | "quicklinks" | "webtolead" | "advanced";

interface NavItem { id: SettingsTab; label: string; icon: typeof User; group: "personal" | "organization"; managerOnly?: boolean; superAdminOnly?: boolean }

const NAV_ITEMS: NavItem[] = [
  { id: "profile", label: "Profile", icon: User, group: "personal" },
  { id: "language", label: "Language & Region", icon: Globe, group: "personal" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "personal" },
  { id: "security", label: "Security", icon: Shield, group: "personal" },
  { id: "pipeline", label: "Pipeline Stages", icon: Kanban, group: "organization", managerOnly: true },
  { id: "seasons", label: "Seasons / Intakes", icon: CalendarDays, group: "organization", managerOnly: true },
  { id: "branding", label: "Branding & Appearance", icon: Palette, group: "organization", managerOnly: true },
  { id: "company", label: "Company & Contact", icon: Building2, group: "organization", managerOnly: true },
  { id: "seo", label: "SEO & Social", icon: SearchIcon, group: "organization", managerOnly: true },
  { id: "email", label: "Email Branding", icon: Mail, group: "organization", managerOnly: true },
  { id: "documents", label: "Documents / PDF", icon: FileText, group: "organization", managerOnly: true },
  { id: "studentDocuments", label: "Student Documents", icon: FileText, group: "organization", managerOnly: true },
  { id: "integrations", label: "Integrations", icon: Plug, group: "organization", managerOnly: true },
  { id: "quicklinks", label: "Quick Links", icon: LinkIcon, group: "organization", managerOnly: true },
  { id: "webtolead", label: "Web to Lead", icon: ExternalLink, group: "organization", superAdminOnly: true },
  { id: "advanced", label: "Advanced", icon: Code, group: "organization", managerOnly: true },
];

export default function SettingsPage() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mode, setMode, resolvedTheme, settings: themeSettings, refreshSettings } = useTheme();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [form, setForm] = useState({ firstName: "", lastName: "", phoneCode: "+90", phone: "", avatarUrl: "", email: "", startDate: "", homeAddress: "", passportNumber: "", contractUrl: "", passportUrl: "", emergencyContactName: "", emergencyPhoneCode: "+90", emergencyPhone: "" });
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [notifications, setNotifications] = useState({ newLeads: true, applicationUpdates: true, documentAlerts: true, financeAlerts: false });
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sectionSaving, setSectionSaving] = useState<string | null>(null);

  const isManager = MANAGER_ROLES.includes(user?.role || "");

  useEffect(() => {
    if (user) {
      const parsed = parsePhoneCode((user as any).phone || "");
      const emergencyParsed = parsePhoneCode((user as any).emergencyContactPhone || "");
      setForm({ firstName: user.firstName || "", lastName: user.lastName || "", phoneCode: parsed.phoneCode, phone: parsed.phone, avatarUrl: user.avatarUrl || "", email: user.email || "", startDate: (user as any).startDate || "", homeAddress: (user as any).homeAddress || "", passportNumber: (user as any).passportNumber || "", contractUrl: (user as any).contractUrl || "", passportUrl: (user as any).passportUrl || "", emergencyContactName: (user as any).emergencyContactName || "", emergencyPhoneCode: emergencyParsed.phoneCode, emergencyPhone: emergencyParsed.phone });
    }
  }, [user]);

  useEffect(() => {
    if (isManager) {
      customFetch("/api/settings").then((data: any) => {
        setSettings(data || {});
        setSettingsLoaded(true);
      }).catch(() => setSettingsLoaded(true));
    }
  }, [isManager]);

  function updateSettings(updates: Record<string, any>) {
    setSettings(prev => ({ ...prev, ...updates }));
  }

  async function saveSection(section: string, fields: Record<string, any>) {
    setSectionSaving(section);
    try {
      const res = await customFetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      setSettings(prev => ({ ...prev, ...(res as any) }));
      if (section === "branding") await refreshSettings();
      toast({ title: `${section.charAt(0).toUpperCase() + section.slice(1)} saved` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSectionSaving(null); }
  }

  async function handleAvatarUpload(file: File) {
    setAvatarUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!(urlRes as any).uploadURL || !(urlRes as any).objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch((urlRes as any).uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const strippedPath = (urlRes as any).objectPath.replace(/^\/objects/, "");
      const avatarUrl = `${BASE_URL}/api/storage/objects${strippedPath}`;
      setForm(f => ({ ...f, avatarUrl }));
      await customFetch(`/api/users/${user!.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile photo updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setAvatarUploading(false); }
  }

  const contractInputRef = useRef<HTMLInputElement>(null);
  const [contractUploading, setContractUploading] = useState(false);

  async function handleContractUpload(file: File) {
    setContractUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!(urlRes as any).uploadURL || !(urlRes as any).objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch((urlRes as any).uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const strippedPath = (urlRes as any).objectPath.replace(/^\/objects/, "");
      const contractUrl = `${BASE_URL}/api/storage/objects${strippedPath}`;
      setForm(f => ({ ...f, contractUrl }));
      toast({ title: "Contract uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setContractUploading(false); }
  }

  const passportInputRef = useRef<HTMLInputElement>(null);
  const [passportUploading, setPassportUploading] = useState(false);

  async function handlePassportUpload(file: File) {
    setPassportUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!(urlRes as any).uploadURL || !(urlRes as any).objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch((urlRes as any).uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const strippedPath = (urlRes as any).objectPath.replace(/^\/objects/, "");
      const passportUrl = `${BASE_URL}/api/storage/objects${strippedPath}`;
      setForm(f => ({ ...f, passportUrl }));
      toast({ title: "Passport uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setPassportUploading(false); }
  }

  async function handleRemoveAvatar() {
    try {
      setForm(f => ({ ...f, avatarUrl: "" }));
      await customFetch(`/api/users/${user!.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile photo removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function handleSaveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, phone: form.phone ? `${form.phoneCode}${form.phone}` : undefined, avatarUrl: form.avatarUrl || null, email: form.email || undefined, startDate: form.startDate || null, homeAddress: form.homeAddress || null, passportNumber: form.passportNumber || null, contractUrl: form.contractUrl || null, passportUrl: form.passportUrl || null, emergencyContactName: form.emergencyContactName || null, emergencyContactPhone: form.emergencyPhone ? `${form.emergencyPhoneCode}${form.emergencyPhone}` : null }),
      });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleChangePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) {
      toast({ title: "Please fill in all password fields", variant: "destructive" });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      toast({ title: "New password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      await customFetch(`/api/users/me/change-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: "Password changed successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to change password", variant: "destructive" });
    } finally { setPwSaving(false); }
  }

  async function handleSaveLang(code: string) {
    if (!user) return;
    setLang(code as any);
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: code }),
      });
      toast({ title: "Language updated" });
    } catch {}
  }

  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || user?.email?.[0] || "?"}`.toUpperCase();
  const isSuperAdmin = user?.role === "super_admin";
  const visibleNav = NAV_ITEMS.filter(n => {
    if (n.superAdminOnly) return isSuperAdmin;
    if (n.managerOnly) return isManager;
    return true;
  });

  function renderContent() {
    switch (activeTab) {
      case "profile": return ProfileTab();
      case "language": return LanguageTab();
      case "notifications": return NotificationsTab();
      case "security": return SecurityTab();
      case "pipeline": return isManager ? <PipelineTabContent /> : null;
      case "seasons": return isManager ? <SeasonsTabContent /> : null;
      case "branding": return isManager ? BrandingTab() : null;
      case "company": return isManager ? CompanyTab() : null;
      case "seo": return isManager ? SeoTab() : null;
      case "email": return isManager ? EmailBrandingTab() : null;
      case "documents": return isManager ? DocumentsTab() : null;
      case "studentDocuments": return isManager ? <StudentDocumentsTab /> : null;
      case "integrations": return isManager ? IntegrationsTab() : null;
      case "quicklinks": return isManager ? <QuickLinksTab /> : null;
      case "webtolead": return isSuperAdmin ? <WebToLeadTab /> : null;
      case "advanced": return isManager ? AdvancedTab() : null;
      default: return null;
    }
  }

  function ProfileTab() {
    return (<>
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <SectionHeader title="Personal Information" description="Update your profile details and contact information." />
        <div className="flex items-center gap-5 mb-8 p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/10">
          <div className="relative group shrink-0">
            {form.avatarUrl ? (
              <img src={form.avatarUrl} alt="" className="w-20 h-20 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg">{initials}</div>
            )}
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
            >
              {avatarUploading ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <Camera className="w-6 h-6 text-white" />}
            </button>
            {form.avatarUrl && (
              <button onClick={handleRemoveAvatar} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90">
                <X className="w-3 h-3" />
              </button>
            )}
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); e.target.value = ""; }} />
          </div>
          <div>
            <p className="font-display font-bold text-lg text-foreground">{user?.firstName} {user?.lastName}</p>
            <p className="text-muted-foreground text-sm">{user?.email}</p>
            <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs mt-2 capitalize">{ROLE_LABELS[user?.role || ""] || user?.role}</Badge>
            <p className="text-xs text-muted-foreground mt-1">Hover to change photo</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-5">
          <FieldGroup label="First Name"><Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="rounded-xl" /></FieldGroup>
          <FieldGroup label="Last Name"><Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="rounded-xl" /></FieldGroup>
          <FieldGroup label="Email" className="sm:col-span-2">
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Phone" className="sm:col-span-2">
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 gap-1.5 px-2.5 min-w-[100px] shrink-0 rounded-xl">
                    <CountryFlag code={PHONE_CODES.find(p => p.code === form.phoneCode)?.country || "TR"} size="sm" />
                    <span className="text-xs">{form.phoneCode}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-60 overflow-y-auto w-36">
                  {PHONE_CODES.map(pc => (
                    <DropdownMenuItem key={pc.code} onClick={() => setForm(f => ({ ...f, phoneCode: pc.code }))} className="gap-2 text-xs">
                      <CountryFlag code={pc.country} size="sm" /> {pc.code}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="555 123 4567" className="rounded-xl flex-1" />
            </div>
          </FieldGroup>
        </div>
      </Card>
      <Card className="border-none shadow-lg shadow-black/5 p-6 mt-6">
        <SectionHeader title="Work & Identity" description="Employment details, address, and identity documents." />
        <div className="grid sm:grid-cols-2 gap-5">
          <FieldGroup label="Start Date">
            <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Passport Number">
            <Input value={form.passportNumber} onChange={e => setForm(f => ({ ...f, passportNumber: e.target.value }))} placeholder="Enter passport number" className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Home Address" className="sm:col-span-2">
            <Input value={form.homeAddress} onChange={e => setForm(f => ({ ...f, homeAddress: e.target.value }))} placeholder="Enter your home address" className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Employment Contract">
            <div className="flex items-center gap-3">
              {form.contractUrl ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <a href={form.contractUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate">View Contract</a>
                  <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, contractUrl: "" }))}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No contract uploaded</p>
              )}
              <Button variant="outline" size="sm" onClick={() => contractInputRef.current?.click()} disabled={contractUploading}>
                {contractUploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                {form.contractUrl ? "Replace" : "Upload"}
              </Button>
              <input ref={contractInputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleContractUpload(f); e.target.value = ""; }} />
            </div>
          </FieldGroup>
          <FieldGroup label="Passport Document">
            <div className="flex items-center gap-3">
              {form.passportUrl ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <a href={form.passportUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate">View Passport</a>
                  <Button variant="ghost" size="sm" onClick={() => setForm(f => ({ ...f, passportUrl: "" }))}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No passport uploaded</p>
              )}
              <Button variant="outline" size="sm" onClick={() => passportInputRef.current?.click()} disabled={passportUploading}>
                {passportUploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                {form.passportUrl ? "Replace" : "Upload"}
              </Button>
              <input ref={passportInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePassportUpload(f); e.target.value = ""; }} />
            </div>
          </FieldGroup>
        </div>
        <div className="mt-6"><SaveButton onClick={handleSaveProfile} saving={saving} /></div>
      </Card>
      <Card className="border-none shadow-lg shadow-black/5 p-6 mt-6">
        <SectionHeader title="Emergency Contact" description="Contact information for a relative or emergency contact person." />
        <div className="grid sm:grid-cols-3 gap-5">
          <FieldGroup label="Full Name" className="sm:col-span-2">
            <Input value={form.emergencyContactName} onChange={e => setForm(f => ({ ...f, emergencyContactName: e.target.value }))} placeholder="Enter emergency contact name" className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Phone Number">
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 gap-1.5 px-2.5 min-w-[100px] shrink-0 rounded-xl">
                    <CountryFlag code={PHONE_CODES.find(p => p.code === form.emergencyPhoneCode)?.country || "TR"} size="sm" />
                    <span className="text-xs">{form.emergencyPhoneCode}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-60 overflow-y-auto w-36">
                  {PHONE_CODES.map(pc => (
                    <DropdownMenuItem key={pc.code} onClick={() => setForm(f => ({ ...f, emergencyPhoneCode: pc.code }))} className="gap-2 text-xs">
                      <CountryFlag code={pc.country} size="sm" /> {pc.code}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Input value={form.emergencyPhone} onChange={e => setForm(f => ({ ...f, emergencyPhone: e.target.value }))} placeholder="555 123 4567" className="rounded-xl flex-1" />
            </div>
          </FieldGroup>
        </div>
        <div className="mt-6"><SaveButton onClick={handleSaveProfile} saving={saving} /></div>
      </Card>
      <Card className="border-none shadow-lg shadow-black/5 p-6 mt-6">
        <SectionHeader title="Change Password" description="Update your account password. You'll need your current password to make changes." />
        <div className="space-y-4 max-w-md">
          <FieldGroup label="Current Password">
            <Input type="password" value={pwForm.currentPassword} onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} placeholder="Enter current password" className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="New Password">
            <Input type="password" value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="Enter new password" className="rounded-xl" />
          </FieldGroup>
          <FieldGroup label="Confirm New Password">
            <Input type="password" value={pwForm.confirmPassword} onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="Confirm new password" className="rounded-xl" />
          </FieldGroup>
        </div>
        <div className="mt-6">
          <Button onClick={handleChangePassword} disabled={pwSaving || !pwForm.currentPassword || !pwForm.newPassword || !pwForm.confirmPassword} className="rounded-xl gap-2">
            {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Change Password
          </Button>
        </div>
      </Card>
    </>);
  }

  function LanguageTab() {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <SectionHeader title="Language & Region" description="Choose your preferred interface language." />
        <div className="grid sm:grid-cols-2 gap-3">
          {LANGUAGES.map(l => (
            <button key={l.code} onClick={() => handleSaveLang(l.code)}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50
                ${lang === l.code ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border hover:bg-secondary/30"}`}>
              <CountryFlag code={l.country} size="xl" />
              <div className="flex-1">
                <p className="font-bold text-foreground">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.code.toUpperCase()}</p>
              </div>
              {lang === l.code && <Check className="w-5 h-5 text-primary" />}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-sm mt-4">RTL (right-to-left) is automatically applied for Arabic.</p>
      </Card>
    );
  }

  function NotificationsTab() {
    return <NotificationRulesManager isAdmin={isManager} notifications={notifications} setNotifications={setNotifications} />;
  }

  function SecurityTab() {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <SectionHeader title="Security & Access" description="Manage your authentication and active sessions." />
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2"><Shield className="w-5 h-5" /> Secure Authentication</p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">Your account is secured with email and password authentication.</p>
          </div>
          <div className="p-5 rounded-xl border border-border/50 space-y-2">
            <p className="font-semibold text-foreground">Account Details</p>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Role</span><Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs capitalize">{ROLE_LABELS[user?.role || ""] || user?.role}</Badge></div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Account ID</span><span className="font-mono text-foreground">#{user?.id}</span></div>
          </div>
          <div className="p-5 rounded-xl border border-border/50">
            <p className="font-semibold text-foreground mb-3">Active Sessions</p>
            <div className="flex items-center justify-between">
              <div><p className="text-sm text-foreground">Current session</p><p className="text-xs text-muted-foreground">This device</p></div>
              <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">Active</Badge>
            </div>
          </div>
          <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/5 hover:border-destructive/30" asChild>
            <a href="/api/auth/logout">Sign Out</a>
          </Button>
        </div>
      </Card>
    );
  }

  function PipelineTabContent() {
    return <PipelineTab qc={qc} />;
  }

  function SeasonsTabContent() {
    return (
      <div className="space-y-6">
        <YearsManagement />
        <SeasonsTab />
      </div>
    );
  }

  function BrandingTab() {
    const s = settings;
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Appearance Mode" description="Choose between light, dark, or system-following theme." />
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: "light" as const, label: "Light", icon: Sun, desc: "Light background" },
              { value: "dark" as const, label: "Dark", icon: Moon, desc: "Dark background" },
              { value: "system" as const, label: "System", icon: Monitor, desc: "Follows device" },
            ]).map(opt => (
              <button key={opt.value} onClick={() => setMode(opt.value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all hover:border-primary/50
                  ${mode === opt.value ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:bg-secondary/30"}`}>
                <opt.icon className={`w-6 h-6 ${mode === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                <span className="font-semibold text-sm">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="System Logos" description="Upload your company logos for different contexts. Use PNG or SVG with transparent backgrounds." />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <LogoUploader label="Light Mode Logo" dims="300x80px, PNG/SVG" value={s.logoUrl || ""} onChange={v => updateSettings({ logoUrl: v })} bgClass="bg-white" />
            <LogoUploader label="Dark Mode Logo" dims="300x80px, PNG/SVG" value={s.logoDarkUrl || ""} onChange={v => updateSettings({ logoDarkUrl: v })} bgClass="bg-gray-900" />
            <LogoUploader label="Square Logo" dims="200x200px" value={s.logoSquareUrl || ""} onChange={v => updateSettings({ logoSquareUrl: v })} />
            <LogoUploader label="Favicon" dims="32x32px, ICO/PNG" value={s.faviconUrl || ""} onChange={v => updateSettings({ faviconUrl: v })} />
            <LogoUploader label="Apple Touch Icon" dims="180x180px, PNG" value={s.appleTouchIconUrl || ""} onChange={v => updateSettings({ appleTouchIconUrl: v })} />
            <LogoUploader label="PWA / App Icon" dims="512x512px, PNG" value={s.pwaIconUrl || ""} onChange={v => updateSettings({ pwaIconUrl: v })} />
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Theme Colors" description="Customize the color palette. Leave empty to use system defaults." />
          <div className="space-y-3">
            <ColorField label="Primary Color" description="Navigation, links, and accents" value={s.themePrimary || ""} onChange={v => updateSettings({ themePrimary: v })} defaultColor="#3B82F6" />
            <ColorField label="Secondary Color" description="Secondary elements and backgrounds" value={s.themeSecondary || ""} onChange={v => updateSettings({ themeSecondary: v })} defaultColor="#6B7280" />
            <ColorField label="Accent Color" description="Highlights and special elements" value={s.themeAccent || ""} onChange={v => updateSettings({ themeAccent: v })} defaultColor="#8B5CF6" />
            <ColorField label="Button Color" description="Primary action buttons" value={s.themeButton || ""} onChange={v => updateSettings({ themeButton: v })} defaultColor="#3B82F6" />
            <ColorField label="Hover Color" description="Button and link hover state" value={s.themeHover || ""} onChange={v => updateSettings({ themeHover: v })} defaultColor="#2563EB" />
            <ColorField label="Link Color" description="Hyperlinks and text links" value={s.themeLinkColor || ""} onChange={v => updateSettings({ themeLinkColor: v })} defaultColor="#2563EB" />
            <ColorField label="Success" description="Success states and positive feedback" value={s.themeSuccess || ""} onChange={v => updateSettings({ themeSuccess: v })} defaultColor="#22C55E" />
            <ColorField label="Warning" description="Warning states and caution indicators" value={s.themeWarning || ""} onChange={v => updateSettings({ themeWarning: v })} defaultColor="#F59E0B" />
            <ColorField label="Danger" description="Error states and destructive actions" value={s.themeDanger || ""} onChange={v => updateSettings({ themeDanger: v })} defaultColor="#EF4444" />
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Brand Preview" description="See how your branding appears across the system." />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-border/50 bg-background">
              <p className="text-xs font-semibold text-muted-foreground mb-3">Sidebar Logo</p>
              <div className="h-12 bg-secondary/30 rounded-lg flex items-center px-4">
                {s.logoUrl ? <img src={s.logoUrl} className="max-h-8 object-contain" alt="" /> : <span className="text-sm font-bold text-muted-foreground">Your Logo</span>}
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/50 bg-background">
              <p className="text-xs font-semibold text-muted-foreground mb-3">Button Preview</p>
              <div className="flex gap-2">
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: s.themeButton || s.themePrimary || "#3B82F6" }}>Primary</button>
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: s.themeSuccess || "#22C55E" }}>Success</button>
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: s.themeDanger || "#EF4444" }}>Danger</button>
              </div>
            </div>
            <div className="p-4 rounded-xl border border-border/50 bg-gray-900 sm:col-span-2">
              <p className="text-xs font-semibold text-gray-400 mb-3">Dark Mode Logo</p>
              <div className="h-12 bg-gray-800 rounded-lg flex items-center px-4">
                {s.logoDarkUrl ? <img src={s.logoDarkUrl} className="max-h-8 object-contain" alt="" /> : <span className="text-sm font-bold text-gray-500">Dark Logo</span>}
              </div>
            </div>
          </div>
        </Card>

        <SaveButton onClick={() => saveSection("branding", {
          logoUrl: s.logoUrl || null, logoDarkUrl: s.logoDarkUrl || null,
          logoSquareUrl: s.logoSquareUrl || null, faviconUrl: s.faviconUrl || null,
          appleTouchIconUrl: s.appleTouchIconUrl || null, pwaIconUrl: s.pwaIconUrl || null,
          themePrimary: s.themePrimary || null, themeSecondary: s.themeSecondary || null,
          themeAccent: s.themeAccent || null, themeButton: s.themeButton || null,
          themeHover: s.themeHover || null, themeLinkColor: s.themeLinkColor || null,
          themeSuccess: s.themeSuccess || null, themeWarning: s.themeWarning || null,
          themeDanger: s.themeDanger || null,
        })} saving={sectionSaving === "branding"} label="Save Branding" />
      </div>
    );
  }

  function CompanyTab() {
    const s = settings;
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Company Information" description="Core business details used across the platform, emails, PDFs, and public pages." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Legal Company Name" description="Official registered company name"><Input value={s.legalCompanyName || ""} onChange={e => updateSettings({ legalCompanyName: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Public Brand Name" description="The name shown to clients and on the website"><Input value={s.publicBrandName || ""} onChange={e => updateSettings({ publicBrandName: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="General Email"><Input value={s.companyEmail || ""} onChange={e => updateSettings({ companyEmail: e.target.value })} type="email" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Support Email"><Input value={s.supportEmail || ""} onChange={e => updateSettings({ supportEmail: e.target.value })} type="email" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Sales Email"><Input value={s.salesEmail || ""} onChange={e => updateSettings({ salesEmail: e.target.value })} type="email" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Phone"><Input value={s.companyPhone || ""} onChange={e => updateSettings({ companyPhone: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Website"><Input value={s.companyWebsite || ""} onChange={e => updateSettings({ companyWebsite: e.target.value })} placeholder="https://findandstudy.com" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="WhatsApp Number"><Input value={s.whatsappNumber || ""} onChange={e => updateSettings({ whatsappNumber: e.target.value })} placeholder="+90 555 123 4567" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Working Hours"><Input value={s.workingHours || ""} onChange={e => updateSettings({ workingHours: e.target.value })} placeholder="Mon-Fri 9:00-18:00" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Address" className="sm:col-span-2"><Input value={s.companyAddress || ""} onChange={e => updateSettings({ companyAddress: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="City"><Input value={s.companyCity || ""} onChange={e => updateSettings({ companyCity: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Country"><Input value={s.companyCountry || ""} onChange={e => updateSettings({ companyCountry: e.target.value })} className="rounded-xl" /></FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Footer & Public Content" description="Texts displayed on the website footer and contact pages." />
          <div className="space-y-5">
            <FieldGroup label="Footer Description" description="Short company description for the website footer">
              <Textarea value={s.footerDescription || ""} onChange={e => updateSettings({ footerDescription: e.target.value })} className="rounded-xl min-h-[70px]" />
            </FieldGroup>
            <FieldGroup label="Footer Copyright Text" description="e.g. © 2025 Find & Study. All rights reserved.">
              <Input value={s.footerCopyright || ""} onChange={e => updateSettings({ footerCopyright: e.target.value })} className="rounded-xl" />
            </FieldGroup>
            <FieldGroup label="Contact CTA Text" description="Call-to-action text on contact sections">
              <Input value={s.contactCtaText || ""} onChange={e => updateSettings({ contactCtaText: e.target.value })} placeholder="Get in touch with us today!" className="rounded-xl" />
            </FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Social Media Links" description="Your social media profile URLs." />
          <div className="grid sm:grid-cols-2 gap-5">
            {[
              { key: "socialInstagram", label: "Instagram", icon: Instagram, placeholder: "https://instagram.com/..." },
              { key: "socialFacebook", label: "Facebook", icon: Facebook, placeholder: "https://facebook.com/..." },
              { key: "socialLinkedin", label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/company/..." },
              { key: "socialTwitter", label: "X / Twitter", icon: Twitter, placeholder: "https://x.com/..." },
              { key: "socialYoutube", label: "YouTube", icon: Youtube, placeholder: "https://youtube.com/@..." },
              { key: "socialTiktok", label: "TikTok", icon: Globe, placeholder: "https://tiktok.com/@..." },
            ].map(item => (
              <FieldGroup key={item.key} label={item.label}>
                <div className="relative">
                  <item.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={s[item.key] || ""} onChange={e => updateSettings({ [item.key]: e.target.value })} placeholder={item.placeholder} className="rounded-xl pl-10" />
                </div>
              </FieldGroup>
            ))}
          </div>
        </Card>

        <SaveButton onClick={() => saveSection("company", {
          legalCompanyName: s.legalCompanyName || null, publicBrandName: s.publicBrandName || null,
          companyEmail: s.companyEmail || null, supportEmail: s.supportEmail || null,
          salesEmail: s.salesEmail || null, companyPhone: s.companyPhone || null,
          companyWebsite: s.companyWebsite || null,
          whatsappNumber: s.whatsappNumber || null, companyAddress: s.companyAddress || null,
          companyCity: s.companyCity || null, companyCountry: s.companyCountry || null,
          workingHours: s.workingHours || null,
          footerDescription: s.footerDescription || null, footerCopyright: s.footerCopyright || null,
          contactCtaText: s.contactCtaText || null,
          socialInstagram: s.socialInstagram || null, socialFacebook: s.socialFacebook || null,
          socialLinkedin: s.socialLinkedin || null, socialTwitter: s.socialTwitter || null,
          socialYoutube: s.socialYoutube || null, socialTiktok: s.socialTiktok || null,
        })} saving={sectionSaving === "company"} label="Save Company Details" />
      </div>
    );
  }

  function SeoTab() {
    const s = settings;
    const titleLen = (s.seoMetaTitle || "").length;
    const descLen = (s.seoMetaDescription || "").length;
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Site Identity" description="Configure your site name and title format for search engines." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Site Name" description="Used in structured data and browser tabs"><Input value={s.siteName || ""} onChange={e => updateSettings({ siteName: e.target.value })} placeholder="Find & Study" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Title Template" description="Use {{pageTitle}} as placeholder"><Input value={s.siteTitleTemplate || ""} onChange={e => updateSettings({ siteTitleTemplate: e.target.value })} placeholder="{{pageTitle}} | Find & Study" className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="Canonical Base URL" className="sm:col-span-2"><Input value={s.canonicalBaseUrl || ""} onChange={e => updateSettings({ canonicalBaseUrl: e.target.value })} placeholder="https://findandstudy.com" className="rounded-xl" /></FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Default Meta Tags" description="Default SEO metadata used when pages don't specify their own." />
          <div className="space-y-5">
            <FieldGroup label="Meta Title" description={`${titleLen}/60 characters recommended`}>
              <Input value={s.seoMetaTitle || ""} onChange={e => updateSettings({ seoMetaTitle: e.target.value })} maxLength={70} className="rounded-xl" />
            </FieldGroup>
            <FieldGroup label="Meta Description" description={`${descLen}/160 characters recommended`}>
              <Textarea value={s.seoMetaDescription || ""} onChange={e => updateSettings({ seoMetaDescription: e.target.value })} maxLength={200} className="rounded-xl min-h-[70px]" />
            </FieldGroup>
            <FieldGroup label="Keywords" description="Comma-separated keywords">
              <Input value={s.seoKeywords || ""} onChange={e => updateSettings({ seoKeywords: e.target.value })} placeholder="education, consultancy, study abroad" className="rounded-xl" />
            </FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Robots & Indexing" />
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50">
              <div><p className="text-sm font-semibold">Allow Search Indexing</p><p className="text-xs text-muted-foreground">Let search engines index your site</p></div>
              <Switch checked={s.robotsIndex !== false} onCheckedChange={v => updateSettings({ robotsIndex: v })} />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50">
              <div><p className="text-sm font-semibold">Allow Link Following</p><p className="text-xs text-muted-foreground">Let search engines follow links on your pages</p></div>
              <Switch checked={s.robotsFollow !== false} onCheckedChange={v => updateSettings({ robotsFollow: v })} />
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl border border-border/50">
              <div><p className="text-sm font-semibold">Staging Noindex</p><p className="text-xs text-muted-foreground">Block indexing on staging/development environments</p></div>
              <Switch checked={s.stagingNoindex === true} onCheckedChange={v => updateSettings({ stagingNoindex: v })} />
            </div>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Open Graph / Social Sharing" description="Control how your site appears when shared on social media." />
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-5">
              <FieldGroup label="OG Title"><Input value={s.ogTitle || ""} onChange={e => updateSettings({ ogTitle: e.target.value })} className="rounded-xl" /></FieldGroup>
              <FieldGroup label="Twitter/X Title"><Input value={s.twitterTitle || ""} onChange={e => updateSettings({ twitterTitle: e.target.value })} className="rounded-xl" /></FieldGroup>
            </div>
            <FieldGroup label="OG Description"><Textarea value={s.ogDescription || ""} onChange={e => updateSettings({ ogDescription: e.target.value })} className="rounded-xl min-h-[60px]" /></FieldGroup>
            <FieldGroup label="Twitter/X Description"><Textarea value={s.twitterDescription || ""} onChange={e => updateSettings({ twitterDescription: e.target.value })} className="rounded-xl min-h-[60px]" /></FieldGroup>
            <div className="grid sm:grid-cols-3 gap-5">
              <LogoUploader label="OG Image" dims="1200x630px" value={s.ogImageUrl || ""} onChange={v => updateSettings({ ogImageUrl: v })} />
              <LogoUploader label="Twitter/X Image" dims="1200x628px" value={s.twitterImageUrl || ""} onChange={v => updateSettings({ twitterImageUrl: v })} />
              <LogoUploader label="Default Share Image" dims="1200x630px" value={s.shareImageUrl || ""} onChange={v => updateSettings({ shareImageUrl: v })} />
            </div>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Search Preview" description="How your site may appear on Google search results." />
          <div className="p-5 rounded-xl border border-border/50 bg-white dark:bg-gray-950 max-w-lg">
            <p className="text-sm text-blue-700 dark:text-blue-400 truncate">{s.canonicalBaseUrl || "https://yoursite.com"}</p>
            <p className="text-lg text-blue-800 dark:text-blue-300 font-medium truncate hover:underline cursor-pointer mt-0.5">{s.seoMetaTitle || s.siteName || "Your Site Title"}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">{s.seoMetaDescription || "Your site description will appear here. Write a compelling description to improve click-through rates."}</p>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Analytics & Tracking" description="Third-party tracking and verification codes." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Google Search Console" description="Verification code"><Input value={s.googleSearchConsoleCode || ""} onChange={e => updateSettings({ googleSearchConsoleCode: e.target.value })} placeholder="google-site-verification=..." className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="Google Analytics (GA4)" description="Measurement ID"><Input value={s.googleAnalyticsId || ""} onChange={e => updateSettings({ googleAnalyticsId: e.target.value })} placeholder="G-XXXXXXXXXX" className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="Meta Pixel ID"><Input value={s.metaPixelId || ""} onChange={e => updateSettings({ metaPixelId: e.target.value })} placeholder="123456789012345" className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="TikTok Pixel ID"><Input value={s.tiktokPixelId || ""} onChange={e => updateSettings({ tiktokPixelId: e.target.value })} className="rounded-xl font-mono text-xs" /></FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Structured Data (Schema.org)" description="Organization data for rich search results." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Organization Name"><Input value={s.orgSchemaName || ""} onChange={e => updateSettings({ orgSchemaName: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Website URL"><Input value={s.orgSchemaUrl || ""} onChange={e => updateSettings({ orgSchemaUrl: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Logo URL"><Input value={s.orgSchemaLogoUrl || ""} onChange={e => updateSettings({ orgSchemaLogoUrl: e.target.value })} className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Social Profiles" description="Comma-separated URLs"><Input value={s.orgSchemaSocials || ""} onChange={e => updateSettings({ orgSchemaSocials: e.target.value })} className="rounded-xl text-xs" /></FieldGroup>
          </div>
        </Card>

        <SaveButton onClick={() => saveSection("seo", {
          siteName: s.siteName || null, siteTitleTemplate: s.siteTitleTemplate || null,
          seoMetaTitle: s.seoMetaTitle || null, seoMetaDescription: s.seoMetaDescription || null,
          canonicalBaseUrl: s.canonicalBaseUrl || null, seoKeywords: s.seoKeywords || null,
          robotsIndex: s.robotsIndex, robotsFollow: s.robotsFollow, stagingNoindex: s.stagingNoindex,
          ogTitle: s.ogTitle || null, ogDescription: s.ogDescription || null, ogImageUrl: s.ogImageUrl || null,
          twitterTitle: s.twitterTitle || null, twitterDescription: s.twitterDescription || null,
          twitterImageUrl: s.twitterImageUrl || null, shareImageUrl: s.shareImageUrl || null,
          googleSearchConsoleCode: s.googleSearchConsoleCode || null, googleAnalyticsId: s.googleAnalyticsId || null,
          metaPixelId: s.metaPixelId || null, tiktokPixelId: s.tiktokPixelId || null,
          orgSchemaName: s.orgSchemaName || null, orgSchemaUrl: s.orgSchemaUrl || null,
          orgSchemaLogoUrl: s.orgSchemaLogoUrl || null, orgSchemaSocials: s.orgSchemaSocials || null,
        })} saving={sectionSaving === "seo"} label="Save SEO Settings" />
      </div>
    );
  }

  function EmailBrandingTab() {
    const s = settings;
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Email Identity" description="Configure the sender details for all outgoing emails." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Sender Name" description="Displayed as the 'From' name"><Input value={s.emailSenderName || ""} onChange={e => updateSettings({ emailSenderName: e.target.value })} placeholder="Find & Study" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Sender Email"><Input value={s.emailSenderEmail || ""} onChange={e => updateSettings({ emailSenderEmail: e.target.value })} type="email" placeholder="info@findandstudy.com" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Reply-To Email" className="sm:col-span-2"><Input value={s.emailReplyTo || ""} onChange={e => updateSettings({ emailReplyTo: e.target.value })} type="email" className="rounded-xl" /></FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Email Branding" description="Customize the look of outgoing emails." />
          <div className="space-y-5">
            <LogoUploader label="Email Header Logo" dims="300x80px, PNG" value={s.emailLogoUrl || ""} onChange={v => updateSettings({ emailLogoUrl: v })} />
            <ColorField label="Email Button Color" description="Primary button color in emails" value={s.emailButtonColor || ""} onChange={v => updateSettings({ emailButtonColor: v })} defaultColor="#143591" />
            <FieldGroup label="Email Footer Text" description="Shown at the bottom of every email">
              <Textarea value={s.emailFooterText || ""} onChange={e => updateSettings({ emailFooterText: e.target.value })} className="rounded-xl min-h-[60px]" placeholder="Find & Study Educational Consulting&#10;Istanbul, Turkey" />
            </FieldGroup>
            <FieldGroup label="Email Signature Block" description="Rich signature text appended to emails">
              <Textarea value={s.emailSignatureBlock || ""} onChange={e => updateSettings({ emailSignatureBlock: e.target.value })} className="rounded-xl min-h-[60px]" />
            </FieldGroup>
            <FieldGroup label="Disclaimer Text" description="Legal disclaimer at the bottom of emails">
              <Textarea value={s.emailDisclaimerText || ""} onChange={e => updateSettings({ emailDisclaimerText: e.target.value })} className="rounded-xl min-h-[50px]" placeholder="This email and any attachments are confidential..." />
            </FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Email Preview" description="How a branded email might look." />
          <div className="max-w-md mx-auto rounded-xl border border-border/50 overflow-hidden bg-white dark:bg-gray-950">
            <div className="px-6 py-4 border-b border-border/30 text-center" style={{ backgroundColor: (s.emailButtonColor || "#143591") + "10" }}>
              {s.emailLogoUrl ? <img src={s.emailLogoUrl} className="max-h-10 mx-auto object-contain" alt="" /> : <p className="font-bold text-lg" style={{ color: s.emailButtonColor || "#143591" }}>{s.emailSenderName || "Your Company"}</p>}
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-800 dark:text-gray-200 mb-4">Hello,</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">This is a preview of how your branded emails will appear to recipients.</p>
              <div className="text-center my-4">
                <button className="px-6 py-2.5 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: s.emailButtonColor || "#143591" }}>View Details</button>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-border/30 bg-gray-50 dark:bg-gray-900">
              <p className="text-[10px] text-gray-500 text-center whitespace-pre-line">{s.emailFooterText || "Your company footer text"}</p>
              {s.emailDisclaimerText && <p className="text-[9px] text-gray-400 text-center mt-2 italic">{s.emailDisclaimerText}</p>}
            </div>
          </div>
        </Card>

        <SaveButton onClick={() => saveSection("email", {
          emailSenderName: s.emailSenderName || null, emailSenderEmail: s.emailSenderEmail || null,
          emailReplyTo: s.emailReplyTo || null, emailLogoUrl: s.emailLogoUrl || null,
          emailFooterText: s.emailFooterText || null, emailSignatureBlock: s.emailSignatureBlock || null,
          emailButtonColor: s.emailButtonColor || null, emailDisclaimerText: s.emailDisclaimerText || null,
        })} saving={sectionSaving === "email"} label="Save Email Branding" />
      </div>
    );
  }

  function DocumentsTab() {
    const s = settings;
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="PDF / Document Branding" description="Customize the identity of generated PDFs and documents." />
          <div className="space-y-5">
            <LogoUploader label="PDF Logo" dims="300x80px, PNG/SVG" value={s.pdfLogoUrl || ""} onChange={v => updateSettings({ pdfLogoUrl: v })} />
            <div className="grid sm:grid-cols-2 gap-5">
              <FieldGroup label="Header Text" description="Displayed at the top of PDF documents">
                <Input value={s.pdfHeaderText || ""} onChange={e => updateSettings({ pdfHeaderText: e.target.value })} placeholder="Find & Study Educational Consulting" className="rounded-xl" />
              </FieldGroup>
              <FieldGroup label="Footer Text" description="Displayed at the bottom of every page">
                <Input value={s.pdfFooterText || ""} onChange={e => updateSettings({ pdfFooterText: e.target.value })} placeholder="© 2025 Find & Study. All rights reserved." className="rounded-xl" />
              </FieldGroup>
              <FieldGroup label="Watermark Text" description="Faint text overlaid on document pages">
                <Input value={s.pdfWatermarkText || ""} onChange={e => updateSettings({ pdfWatermarkText: e.target.value })} placeholder="CONFIDENTIAL" className="rounded-xl" />
              </FieldGroup>
              <FieldGroup label="Signature Label" description="Label above the signature line">
                <Input value={s.pdfSignatureLabel || ""} onChange={e => updateSettings({ pdfSignatureLabel: e.target.value })} placeholder="Authorized Representative" className="rounded-xl" />
              </FieldGroup>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <LogoUploader label="Seal / Stamp Image" dims="200x200px, PNG" value={s.pdfSealImageUrl || ""} onChange={v => updateSettings({ pdfSealImageUrl: v })} />
              <div>
                <ColorField label="Document Primary Color" description="Accent color for PDF headers, borders, and highlights" value={s.pdfPrimaryColor || ""} onChange={v => updateSettings({ pdfPrimaryColor: v })} defaultColor="#143591" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Document Preview" description="How your branded documents may look." />
          <div className="max-w-sm mx-auto">
            <div className="rounded-xl border border-border/50 overflow-hidden bg-white dark:bg-gray-950 shadow-sm">
              <div className="h-2 w-full" style={{ backgroundColor: s.pdfPrimaryColor || "#143591" }} />
              <div className="px-5 py-4 flex items-center justify-between border-b border-border/30">
                {s.pdfLogoUrl ? <img src={s.pdfLogoUrl} className="max-h-8 object-contain" alt="" /> : <p className="text-sm font-bold" style={{ color: s.pdfPrimaryColor || "#143591" }}>Company Logo</p>}
                <p className="text-[10px] text-muted-foreground">{s.pdfHeaderText || "Header Text"}</p>
              </div>
              <div className="px-5 py-6">
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
                <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-4" />
                {s.pdfWatermarkText && (
                  <p className="text-center text-2xl font-bold text-gray-100 dark:text-gray-800 my-4 select-none">{s.pdfWatermarkText}</p>
                )}
                <div className="mt-4 pt-3 border-t border-dashed border-border/50 flex items-end justify-between">
                  <div>
                    <p className="text-[9px] text-muted-foreground">{s.pdfSignatureLabel || "Signature"}</p>
                    <div className="h-px w-24 bg-gray-300 mt-3" />
                  </div>
                  {s.pdfSealImageUrl && <img src={s.pdfSealImageUrl} className="w-12 h-12 object-contain opacity-60" alt="" />}
                </div>
              </div>
              <div className="px-5 py-2 border-t border-border/30 bg-gray-50 dark:bg-gray-900">
                <p className="text-[9px] text-gray-500 text-center">{s.pdfFooterText || "Footer text"}</p>
              </div>
            </div>
          </div>
        </Card>

        <SaveButton onClick={() => saveSection("documents", {
          pdfLogoUrl: s.pdfLogoUrl || null, pdfHeaderText: s.pdfHeaderText || null,
          pdfFooterText: s.pdfFooterText || null, pdfWatermarkText: s.pdfWatermarkText || null,
          pdfSignatureLabel: s.pdfSignatureLabel || null, pdfSealImageUrl: s.pdfSealImageUrl || null,
          pdfPrimaryColor: s.pdfPrimaryColor || null,
        })} saving={sectionSaving === "documents"} label="Save Document Settings" />
      </div>
    );
  }

  function IntegrationsTab() {
    return <IntegrationsManager />;
  }

  function AdvancedTab() {
    const s = settings;
    const isSuperAdmin = user?.role === "super_admin";
    return (
      <div className="space-y-6">
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Site Configuration" description="Domain, sitemap, and robots settings." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="Canonical Domain"><Input value={s.canonicalBaseUrl || ""} onChange={e => updateSettings({ canonicalBaseUrl: e.target.value })} placeholder="https://findandstudy.com" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="Sitemap URL"><Input value={s.sitemapUrl || ""} onChange={e => updateSettings({ sitemapUrl: e.target.value })} placeholder="/sitemap.xml" className="rounded-xl" /></FieldGroup>
            <FieldGroup label="robots.txt Content" description="Custom robots.txt rules" className="sm:col-span-2">
              <Textarea value={s.robotsTxtContent || ""} onChange={e => updateSettings({ robotsTxtContent: e.target.value })} className="rounded-xl font-mono text-xs min-h-[80px]" placeholder="User-agent: *&#10;Allow: /" />
            </FieldGroup>
          </div>
        </Card>

        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <SectionHeader title="Tracking & Widgets" description="Third-party integrations and widget configurations." />
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldGroup label="LinkedIn Insight Tag"><Input value={s.linkedinInsightTag || ""} onChange={e => updateSettings({ linkedinInsightTag: e.target.value })} className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="Microsoft Clarity / Hotjar ID"><Input value={s.clarityId || ""} onChange={e => updateSettings({ clarityId: e.target.value })} className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="reCAPTCHA Site Key"><Input value={s.recaptchaSiteKey || ""} onChange={e => updateSettings({ recaptchaSiteKey: e.target.value })} className="rounded-xl font-mono text-xs" /></FieldGroup>
            <FieldGroup label="WhatsApp Widget Number" description="Floating chat widget"><Input value={s.whatsappWidgetNumber || ""} onChange={e => updateSettings({ whatsappWidgetNumber: e.target.value })} placeholder="+90 555 123 4567" className="rounded-xl" /></FieldGroup>
          </div>
        </Card>

        {isSuperAdmin && (
          <Card className="border-none shadow-lg shadow-black/5 p-6 border-l-4 border-l-amber-400">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <SectionHeader title="Custom Scripts" description="Inject custom code into the page. Use with caution — incorrect scripts may break the application." />
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 mb-4">
                  <p className="text-xs text-amber-700 dark:text-amber-400">Only Super Admins can edit these fields. Malicious or broken scripts can compromise security and functionality.</p>
                </div>
                <div className="space-y-5">
                  <FieldGroup label="Custom Head Script" description="Injected before </head> — for analytics, fonts, etc.">
                    <Textarea value={s.customHeadScript || ""} onChange={e => updateSettings({ customHeadScript: e.target.value })} className="rounded-xl font-mono text-xs min-h-[80px]" placeholder="<!-- Google Tag Manager -->" />
                  </FieldGroup>
                  <FieldGroup label="Custom Body-End Script" description="Injected before </body> — for chat widgets, etc.">
                    <Textarea value={s.customBodyEndScript || ""} onChange={e => updateSettings({ customBodyEndScript: e.target.value })} className="rounded-xl font-mono text-xs min-h-[80px]" placeholder="<!-- Live chat widget -->" />
                  </FieldGroup>
                  <FieldGroup label="Live Chat Script" description="Full live chat embed code">
                    <Textarea value={s.liveChatScript || ""} onChange={e => updateSettings({ liveChatScript: e.target.value })} className="rounded-xl font-mono text-xs min-h-[80px]" />
                  </FieldGroup>
                </div>
              </div>
            </div>
          </Card>
        )}

        <SaveButton onClick={() => {
          const payload: Record<string, any> = {
            canonicalBaseUrl: s.canonicalBaseUrl || null, sitemapUrl: s.sitemapUrl || null,
            robotsTxtContent: s.robotsTxtContent || null,
            linkedinInsightTag: s.linkedinInsightTag || null, clarityId: s.clarityId || null,
            recaptchaSiteKey: s.recaptchaSiteKey || null, whatsappWidgetNumber: s.whatsappWidgetNumber || null,
          };
          if (isSuperAdmin) {
            payload.customHeadScript = s.customHeadScript || null;
            payload.customBodyEndScript = s.customBodyEndScript || null;
            payload.liveChatScript = s.liveChatScript || null;
          }
          saveSection("advanced", payload);
        }} saving={sectionSaving === "advanced"} label="Save Advanced Settings" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your profile, organization settings, and system configuration.</p>
        </div>

        <div className="lg:hidden mb-4">
          <div className="flex flex-wrap gap-1.5 p-1 bg-secondary/50 rounded-xl">
            {visibleNav.map(n => (
              <button key={n.id} onClick={() => setActiveTab(n.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${activeTab === n.id ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <n.icon className="w-3.5 h-3.5" />
                {n.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-6 min-h-[600px]">
          <nav className="w-56 shrink-0 hidden lg:block">
            <div className="sticky top-20 space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2">Personal</p>
              {visibleNav.filter(n => n.group === "personal").map(n => (
                <button key={n.id} onClick={() => setActiveTab(n.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left
                    ${activeTab === n.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>
                  <n.icon className="w-4 h-4 shrink-0" />
                  {n.label}
                </button>
              ))}
              {isManager && (
                <>
                  <div className="h-px bg-border/50 my-3" />
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2">Organization</p>
                  {visibleNav.filter(n => n.group === "organization").map(n => (
                    <button key={n.id} onClick={() => setActiveTab(n.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left
                        ${activeTab === n.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>
                      <n.icon className="w-4 h-4 shrink-0" />
                      {n.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          </nav>

          <div className="flex-1 min-w-0 max-w-3xl">
            {renderContent()}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function PipelineTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const leadPipeline = usePipelineStages("lead");
  const applicationPipeline = usePipelineStages("application");
  const studentPipeline = usePipelineStages("student");
  const [editingType, setEditingType] = useState<string | null>(null);

  const pipelines = [
    { type: "lead", label: "Lead Pipeline", description: "Stages for tracking prospective student leads from initial contact to conversion.", pipeline: leadPipeline },
    { type: "application", label: "Application Pipeline", description: "Stages for tracking university applications from inquiry to enrollment.", pipeline: applicationPipeline },
    { type: "student", label: "Student Pipeline", description: "Stages for tracking student lifecycle from active enrollment to graduation.", pipeline: studentPipeline },
  ];

  const activePipeline = pipelines.find(p => p.type === editingType);

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <SectionHeader title="Pipeline Stages" description="Configure the pipeline stages for leads, applications, and students. Changes here apply to all users — staff, agents, and sub-agents." />
        <div className="space-y-4">
          {pipelines.map(({ type, label, description, pipeline }) => (
            <div key={type} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/20 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {pipeline.stages.map(s => (
                    <span key={s.key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      s.variant === "won" ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800" :
                      s.variant === "partial_won" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800" :
                      s.variant === "lost" ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-800" :
                      s.variant === "none_finance" ? "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700" :
                      "bg-secondary text-muted-foreground border-border/50"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.variant === "won" ? "bg-emerald-500" : s.variant === "partial_won" ? "bg-amber-500" : s.variant === "lost" ? "bg-rose-500" : s.variant === "none_finance" ? "bg-gray-300" : "bg-muted-foreground/40"}`} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 ml-4" onClick={() => setEditingType(type)}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
            </div>
          ))}
        </div>
      </Card>

      {activePipeline && (
        <EditStagesDialog
          open={!!editingType}
          onClose={() => setEditingType(null)}
          stages={activePipeline.pipeline.stages}
          onSave={async (s) => {
            await activePipeline.pipeline.saveStages(s);
            qc.invalidateQueries({ queryKey: ["pipeline-stages"] });
          }}
          isSaving={activePipeline.pipeline.isSaving}
          entityLabel={activePipeline.label.replace(" Pipeline", "")}
        />
      )}
    </div>
  );
}

function YearsManagement() {
  const { toast } = useToast();
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newYear, setNewYear] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data: any = await customFetch("/api/settings/available-years");
        setYears(data.years || []);
      } catch {
        const currentYear = new Date().getFullYear();
        setYears(Array.from({ length: 6 }, (_, i) => currentYear - 2 + i));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveYears(updated: number[]) {
    setSaving(true);
    try {
      await customFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availableYears: updated.sort((a, b) => a - b) }),
      });
      setYears(updated.sort((a, b) => a - b));
      toast({ title: "Years updated" });
    } catch (err: any) {
      toast({ title: "Failed to update years", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleAddYear() {
    const y = parseInt(newYear, 10);
    if (isNaN(y) || y < 2000 || y > 2100) {
      toast({ title: "Enter a valid year (2000-2100)", variant: "destructive" });
      return;
    }
    if (years.includes(y)) {
      toast({ title: "Year already exists", variant: "destructive" });
      return;
    }
    setNewYear("");
    saveYears([...years, y]);
  }

  function handleRemoveYear(y: number) {
    saveYears(years.filter(yr => yr !== y));
  }

  if (loading) {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg shadow-black/5 p-6">
      <SectionHeader title="Academic Years" description="Manage the years available in the year selector across the system. Users will see these years in the top navigation dropdown." />

      <div className="flex items-center gap-3 mb-6">
        <Input
          type="number"
          value={newYear}
          onChange={e => setNewYear(e.target.value)}
          placeholder="e.g. 2027"
          className="rounded-xl w-[140px]"
          min={2000}
          max={2100}
          onKeyDown={e => { if (e.key === "Enter") handleAddYear(); }}
        />
        <Button onClick={handleAddYear} disabled={saving || !newYear.trim()} className="rounded-xl gap-2 shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Year
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {years.map(y => (
          <div key={y} className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 rounded-lg px-3 py-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-semibold text-foreground">{y}</span>
            <button
              onClick={() => handleRemoveYear(y)}
              disabled={saving || years.length <= 1}
              className="ml-1 w-5 h-5 rounded-full hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
              title="Remove year"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SeasonsTab() {
  const { toast } = useToast();
  const [seasons, setSeasons] = useState<Array<{ id: number; value: string; sortOrder: number; isActive: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [newSeason, setNewSeason] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const fetchSeasons = useCallback(async () => {
    try {
      const data: any = await customFetch("/api/catalog-options");
      const intakes = (data.grouped?.intake || []).map((s: any) => ({
        id: s.id,
        value: s.value,
        sortOrder: s.sortOrder,
        isActive: s.isActive,
      }));
      setSeasons(intakes);
    } catch {
      toast({ title: "Failed to load seasons", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchSeasons(); }, [fetchSeasons]);

  async function handleAdd() {
    const trimmed = newSeason.trim();
    if (!trimmed) return;
    if (seasons.some(s => s.value.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: "Season already exists", variant: "destructive" });
      return;
    }
    setAdding(true);
    try {
      await customFetch("/api/catalog-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "intake", value: trimmed, sortOrder: seasons.length }),
      });
      setNewSeason("");
      await fetchSeasons();
      toast({ title: "Season added" });
    } catch (err: any) {
      toast({ title: "Failed to add season", description: err.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdate(id: number) {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (seasons.some(s => s.id !== id && s.value.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: "Season name already exists", variant: "destructive" });
      return;
    }
    setSaving(id);
    try {
      await customFetch(`/api/catalog-options/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: trimmed }),
      });
      setEditingId(null);
      await fetchSeasons();
      toast({ title: "Season updated" });
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  async function handleToggle(id: number, isActive: boolean) {
    setSaving(id);
    try {
      await customFetch(`/api/catalog-options/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      await fetchSeasons();
      toast({ title: isActive ? "Season deactivated" : "Season activated" });
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(id: number) {
    setSaving(id);
    try {
      await customFetch(`/api/catalog-options/${id}`, { method: "DELETE" });
      await fetchSeasons();
      toast({ title: "Season removed" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <SectionHeader title="Seasons / Intake Periods" description="Manage the available intake seasons used across the system — for applications, programs, and the embed widget." />

        <div className="flex items-center gap-3 mb-6">
          <Input
            value={newSeason}
            onChange={e => setNewSeason(e.target.value)}
            placeholder="e.g. September, February, Summer..."
            className="rounded-xl flex-1"
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          />
          <Button onClick={handleAdd} disabled={adding || !newSeason.trim()} className="rounded-xl gap-2 shrink-0">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Season
          </Button>
        </div>

        {seasons.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No seasons configured</p>
            <p className="text-xs mt-1">Add your first intake season above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {seasons.map(s => (
              <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${s.isActive ? "border-border/50 hover:border-primary/20 bg-background" : "border-border/30 bg-muted/30"}`}>
                <CalendarDays className={`w-4 h-4 shrink-0 ${s.isActive ? "text-primary" : "text-muted-foreground/50"}`} />

                {editingId === s.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="rounded-lg h-8 text-sm flex-1"
                      onKeyDown={e => {
                        if (e.key === "Enter") handleUpdate(s.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => handleUpdate(s.id)} disabled={saving === s.id}>
                      {saving === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg" onClick={() => setEditingId(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className={`flex-1 text-sm font-medium ${s.isActive ? "text-foreground" : "text-muted-foreground line-through"}`}>{s.value}</span>
                    <Badge variant={s.isActive ? "default" : "secondary"} className={`text-[10px] ${s.isActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {s.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => { setEditingId(s.id); setEditValue(s.value); }}
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 rounded-lg"
                      onClick={() => handleToggle(s.id, s.isActive)}
                      disabled={saving === s.id}
                      title={s.isActive ? "Deactivate" : "Activate"}
                    >
                      {saving === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className={`w-3.5 h-3.5 ${s.isActive ? "text-emerald-600" : "text-muted-foreground"}`} />}
                    </Button>
                    {confirmDeleteId === s.id ? (
                      <div className="flex items-center gap-1 ml-1">
                        <span className="text-[10px] text-destructive font-medium whitespace-nowrap">Delete?</span>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg text-destructive hover:bg-destructive/10" onClick={() => { handleDelete(s.id); setConfirmDeleteId(null); }} disabled={saving === s.id}>
                          {saving === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-lg" onClick={() => setConfirmDeleteId(null)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDeleteId(s.id)}
                        disabled={saving === s.id}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border-none shadow-lg shadow-black/5 p-5">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">How seasons are used</p>
            <p>Seasons appear as intake period options in applications, the embed widget apply form, course finder filters, and program configuration.</p>
            <p>Deactivating a season hides it from new selections but preserves existing records that reference it.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

const TARGET_LABELS: Record<string, string> = {
  agent: "Agent",
  sub_agent: "Sub Agent",
  staff: "Staff",
  student: "Student",
};

const TARGET_COLORS: Record<string, string> = {
  agent: "bg-blue-500/10 text-blue-700",
  sub_agent: "bg-purple-500/10 text-purple-700",
  staff: "bg-emerald-500/10 text-emerald-700",
  student: "bg-amber-500/10 text-amber-700",
};

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#64748b",
];

function QuickLinksTab() {
  const { toast } = useToast();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [links, setLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", url: "", logoUrl: "", color: "#6366f1", target: "agent" as string, sortOrder: 0 });
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/quick-links/admin`, { credentials: "include" });
      const data = await res.json();
      setLinks(data.data || []);
    } catch {} finally {
      setLoading(false);
    }
  }, [BASE]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleSave = async () => {
    if (!form.title.trim() || !form.url.trim()) {
      toast({ title: "Error", description: "Title and URL are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `${BASE}/api/quick-links/${editingId}` : `${BASE}/api/quick-links`;
      await customFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          url: form.url.trim(),
          logoUrl: form.logoUrl || null,
          color: form.color || null,
          target: form.target,
          sortOrder: form.sortOrder,
        }),
      });
      toast({ title: editingId ? "Updated" : "Created", description: `Quick link "${form.title}" has been ${editingId ? "updated" : "created"}.` });
      setShowForm(false);
      setEditingId(null);
      setForm({ title: "", url: "", logoUrl: "", color: "#6366f1", target: "agent", sortOrder: 0 });
      fetchLinks();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save quick link.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await customFetch(`${BASE}/api/quick-links/${id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: "Quick link has been removed." });
      fetchLinks();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to delete.", variant: "destructive" });
    }
    setDeleteConfirm(null);
  };

  const handleToggle = async (id: number, currentActive: boolean) => {
    try {
      await customFetch(`${BASE}/api/quick-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      fetchLinks();
    } catch {}
  };

  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!(urlRes as any).uploadURL || !(urlRes as any).objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch((urlRes as any).uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("Upload failed");
      const strippedPath = (urlRes as any).objectPath.replace(/^\/objects/, "");
      const logoPath = `${BASE}/api/storage/objects${strippedPath}`;
      setForm(f => ({ ...f, logoUrl: logoPath }));
      toast({ title: "Logo uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  const openEdit = (link: any) => {
    setForm({
      title: link.title,
      url: link.url,
      logoUrl: link.logoUrl || "",
      color: link.color || "#6366f1",
      target: link.target,
      sortOrder: link.sortOrder ?? 0,
    });
    setEditingId(link.id);
    setShowForm(true);
  };

  const openNew = () => {
    setForm({ title: "", url: "", logoUrl: "", color: "#6366f1", target: "agent", sortOrder: 0 });
    setEditingId(null);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-display font-bold text-lg">Quick Links</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Manage custom shortcut buttons that appear on user dashboards.
            </p>
          </div>
          <Button onClick={openNew} className="gap-2">
            <Plus className="w-4 h-4" /> Add Link
          </Button>
        </div>

        {showForm && (
          <Card className="p-5 mb-6 border-2 border-primary/20 bg-primary/[0.02]">
            <h4 className="font-semibold text-sm mb-4">{editingId ? "Edit Quick Link" : "New Quick Link"}</h4>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label className="text-xs font-medium mb-1.5">Title</Label>
                <Input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Dorm Booking"
                />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5">URL</Label>
                <Input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://dormbooking.com"
                />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5">Logo</Label>
                <div className="relative w-full h-[72px] rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-secondary/20">
                  {form.logoUrl ? (
                    <>
                      <img src={form.logoUrl} alt="Logo" className="max-h-14 max-w-full object-contain" />
                      <button onClick={() => setForm(f => ({ ...f, logoUrl: "" }))}
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive">
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                      className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-xs">
                      {logoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      <span className="font-medium">{logoUploading ? "Uploading..." : "Upload Logo"}</span>
                    </button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5">Target</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {[
                    { value: "agent", label: "Agent" },
                    { value: "sub_agent", label: "Sub Agent" },
                    { value: "staff", label: "Staff" },
                    { value: "student", label: "Student" },
                  ].map(opt => {
                    const targets = form.target.split(",").filter(Boolean);
                    const checked = targets.includes(opt.value);
                    return (
                      <label key={opt.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all ${checked ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/40"}`}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          setForm(f => {
                            const ts = f.target.split(",").filter(Boolean);
                            const next = checked ? ts.filter(t => t !== opt.value) : [...ts, opt.value];
                            return { ...f, target: next.length > 0 ? next.join(",") : "" };
                          });
                        }} className="sr-only" />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5">Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5">Color</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-lg border-2 transition-all ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingId ? "Update" : "Create"}
              </Button>
            </div>
          </Card>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-xl" />)}
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <LinkIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No quick links yet</p>
            <p className="text-xs mt-1">Add links to external sites like dorm booking, insurance portals, etc.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map(link => (
              <div
                key={link.id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  link.isActive ? "bg-background border-border" : "bg-muted/50 border-border/50 opacity-60"
                }`}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white text-sm font-bold overflow-hidden"
                  style={{ backgroundColor: link.logoUrl ? "transparent" : (link.color || "#6366f1") }}
                >
                  {link.logoUrl ? (
                    <img src={link.logoUrl} alt={link.title} className="w-full h-full object-contain" />
                  ) : (
                    link.icon || link.title.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground">{link.title}</p>
                    {(link.target || "").split(",").map((t: string) => (
                      <Badge key={t} className={`text-[10px] ${TARGET_COLORS[t] || "bg-gray-100 text-gray-600"}`}>
                        {TARGET_LABELS[t] || t}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => openEdit(link)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => handleToggle(link.id, link.isActive)}
                    title={link.isActive ? "Deactivate" : "Activate"}
                  >
                    <Power className={`w-3.5 h-3.5 ${link.isActive ? "text-emerald-600" : "text-muted-foreground"}`} />
                  </Button>
                  {deleteConfirm === link.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-destructive font-medium">Delete?</span>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(link.id)}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setDeleteConfirm(null)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteConfirm(link.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border-none shadow-lg shadow-black/5 p-5">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-sm">How quick links work</p>
            <p>Quick links appear as shortcut buttons on user dashboards. Each link opens in a new tab.</p>
            <p>Choose a target to control which users see each link: Agent, Sub Agent, Staff, or Student.</p>
            <p>Changes are reflected immediately on user dashboards — no restart needed.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

const DOC_TYPE_LABELS: Record<string, string> = {
  high_school_diploma_translation: "High School Diploma (Translation)",
  class_10th_ssc_marks_sheet: "Class 10th/SSC Marks Sheet",
  class_12th_hsc_certificate: "Class 12th/+2/HSC Certificate",
  class_12th_hsc_marks_sheet: "Class 12th/+2/HSC Marks Sheet",
  diploma_certificate: "Diploma Certificate",
  diploma_transcript: "Diploma Transcript",
  bachelors_certificate: "Bachelors Certificate",
  bachelors_transcript: "Bachelors Transcript",
  bachelors_provisional_certificate: "Bachelors Provisional Certificate",
  bachelors_transcript_all_semesters: "Bachelors Transcript (All Semesters)",
  masters_certificate: "Masters Certificate",
  masters_transcript: "Masters Transcript",
  masters_provisional_certificate: "Masters Provisional Certificate",
  masters_transcript_all_semesters: "Masters Transcript (All Semesters)",
  passport: "Passport",
  cv: "CV",
  lor: "LOR",
  sop: "SOP",
  essay: "Essay",
  experience_letters: "Experience Letters",
  other_certificates_documents: "Other Certificates/Documents",
  ielts_pte_gre_gmat_toefl_duolingo: "IELTS/PTE/GRE/GMAT/TOEFL/Duolingo",
  photo: "Photo",
  diploma_recognition: "Diploma Recognition",
};

const STUDENT_DOC_LEVELS = [
  { key: "pre_bachelors", label: "Associate" },
  { key: "bachelors", label: "Bachelors" },
  { key: "pre_masters", label: "Pre-Masters" },
  { key: "masters", label: "Masters" },
  { key: "phd", label: "Ph.D" },
  { key: "others", label: "Others" },
];

const STUDENT_DOC_TYPES = Object.keys(DOC_TYPE_LABELS);

function StudentDocumentsTab() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [reqs, setReqs] = useState<Record<string, { enabled: boolean; mandatory: boolean }>>({});

  const { data: requirements, isLoading } = useQuery({
    queryKey: ["document-requirements"],
    queryFn: async () => {
      const res: any = await customFetch(`/api/document-requirements`);
      return res as any[];
    },
  });

  useEffect(() => {
    if (requirements && Array.isArray(requirements)) {
      const map: Record<string, { enabled: boolean; mandatory: boolean }> = {};
      for (const r of requirements) {
        map[`${r.documentType}__${r.level}`] = { enabled: r.enabled, mandatory: r.mandatory };
      }
      setReqs(map);
    }
  }, [requirements]);

  const getReq = (docType: string, level: string) => {
    return reqs[`${docType}__${level}`] || { enabled: false, mandatory: false };
  };

  const setReq = (docType: string, level: string, field: "enabled" | "mandatory", value: boolean) => {
    const key = `${docType}__${level}`;
    const prev = reqs[key] || { enabled: false, mandatory: false };
    if (field === "enabled" && !value) {
      setReqs(r => ({ ...r, [key]: { enabled: false, mandatory: false } }));
    } else if (field === "mandatory" && value) {
      setReqs(r => ({ ...r, [key]: { ...prev, enabled: true, mandatory: true } }));
    } else {
      setReqs(r => ({ ...r, [key]: { ...prev, [field]: value } }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any[] = [];
      for (const dt of STUDENT_DOC_TYPES) {
        for (const level of STUDENT_DOC_LEVELS) {
          const r = getReq(dt, level.key);
          payload.push({ documentType: dt, level: level.key, enabled: r.enabled, mandatory: r.mandatory });
        }
      }
      await customFetch(`/api/document-requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: payload }),
      });
      toast({ title: "Saved", description: "Document requirements updated successfully." });
    } catch (err) {
      toast({ title: "Error", description: "Failed to save document requirements.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-lg">Student Document Requirements</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Enable document upload options based on student overseas study level.
            </p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 font-semibold min-w-[250px]">Document</th>
                {STUDENT_DOC_LEVELS.map(l => (
                  <th key={l.key} className="text-center py-3 px-3 font-semibold min-w-[120px]">{l.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STUDENT_DOC_TYPES.map((dt, idx) => (
                <tr key={dt} className={idx % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="py-3 px-4 font-medium text-sm border-b">{DOC_TYPE_LABELS[dt]}</td>
                  {STUDENT_DOC_LEVELS.map(level => {
                    const r = getReq(dt, level.key);
                    return (
                      <td key={level.key} className="py-2 px-3 border-b">
                        <div className="flex flex-col items-center gap-1.5">
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={r.enabled}
                              onChange={e => setReq(dt, level.key, "enabled", e.target.checked)}
                              className="rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="text-muted-foreground">Enable</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              checked={r.mandatory}
                              onChange={e => setReq(dt, level.key, "mandatory", e.target.checked)}
                              className="rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="text-muted-foreground">Mandatory</span>
                          </label>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function WebToLeadTab() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [formTitle, setFormTitle] = useState("Get in Touch");
  const [formSubtitle, setFormSubtitle] = useState("Fill in your details and we'll contact you shortly.");
  const [btnText, setBtnText] = useState("Submit");
  const [btnColor, setBtnColor] = useState("#2563eb");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [borderColor, setBorderColor] = useState("#e5e7eb");
  const [footerText, setFooterText] = useState("Your information is secure and will not be shared.");

  const apiDomain = window.location.origin;
  const btnColorDark = btnColor + "cc";

  const formCode = `<form action="${apiDomain}/api/public/lead" method="POST" style="max-width:440px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;padding:32px;border-radius:16px;background:${bgColor};box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid ${borderColor}" onsubmit="var ins=this.querySelectorAll('input[type=text]');for(var i=0;i<ins.length;i++){ins[i].value=ins[i].value.toUpperCase();}">
  <h3 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111827;text-align:center">${formTitle}</h3>
  <p style="margin:0 0 20px;font-size:13px;color:#6b7280;text-align:center">${formSubtitle}</p>
  <div style="display:flex;gap:10px;margin-bottom:14px">
    <div style="flex:1">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">First Name <span style="color:#ef4444">*</span></label>
      <input name="firstName" type="text" required pattern="[A-Za-z\\u00C0-\\u017F\\s'-]+" title="Latin characters only" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;text-transform:uppercase;transition:border-color 0.2s" onfocus="this.style.borderColor='${btnColor}'" onblur="this.style.borderColor='#d1d5db'" />
    </div>
    <div style="flex:1">
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Last Name <span style="color:#ef4444">*</span></label>
      <input name="lastName" type="text" required pattern="[A-Za-z\\u00C0-\\u017F\\s'-]+" title="Latin characters only" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;text-transform:uppercase;transition:border-color 0.2s" onfocus="this.style.borderColor='${btnColor}'" onblur="this.style.borderColor='#d1d5db'" />
    </div>
  </div>
  <div style="margin-bottom:14px">
    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Phone <span style="color:#ef4444">*</span></label>
    <div style="display:flex;gap:6px">
      <select name="phoneCode" style="width:90px;padding:10px 6px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;background:#fff;outline:none;cursor:pointer">
        <option value="+90">🇹🇷 +90</option><option value="+1">🇺🇸 +1</option><option value="+44">🇬🇧 +44</option><option value="+49">🇩🇪 +49</option><option value="+33">🇫🇷 +33</option><option value="+39">🇮🇹 +39</option><option value="+34">🇪🇸 +34</option><option value="+31">🇳🇱 +31</option><option value="+46">🇸🇪 +46</option><option value="+41">🇨🇭 +41</option><option value="+7">🇷🇺 +7</option><option value="+380">🇺🇦 +380</option><option value="+86">🇨🇳 +86</option><option value="+91">🇮🇳 +91</option><option value="+92">🇵🇰 +92</option><option value="+93">🇦🇫 +93</option><option value="+966">🇸🇦 +966</option><option value="+971">🇦🇪 +971</option><option value="+964">🇮🇶 +964</option><option value="+98">🇮🇷 +98</option><option value="+962">🇯🇴 +962</option><option value="+961">🇱🇧 +961</option><option value="+20">🇪🇬 +20</option><option value="+212">🇲🇦 +212</option><option value="+234">🇳🇬 +234</option><option value="+55">🇧🇷 +55</option><option value="+61">🇦🇺 +61</option><option value="+81">🇯🇵 +81</option><option value="+82">🇰🇷 +82</option><option value="+60">🇲🇾 +60</option><option value="+65">🇸🇬 +65</option><option value="+880">🇧🇩 +880</option>
      </select>
      <input name="phoneNumber" type="tel" required placeholder="555 000 0000" style="flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;transition:border-color 0.2s" onfocus="this.style.borderColor='${btnColor}'" onblur="this.style.borderColor='#d1d5db'" />
      <input type="hidden" name="phone" />
    </div>
  </div>
  <div style="margin-bottom:20px">
    <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Email <span style="color:#ef4444">*</span></label>
    <input name="email" type="email" required placeholder="you@example.com" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;transition:border-color 0.2s" onfocus="this.style.borderColor='${btnColor}'" onblur="this.style.borderColor='#d1d5db'" />
  </div>
  <button type="submit" style="width:100%;padding:12px;background:linear-gradient(135deg,${btnColor},${btnColorDark});color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'" onclick="var f=this.closest('form');f.phone.value=f.phoneCode.value+f.phoneNumber.value;">${btnText}</button>
  <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;text-align:center">${footerText}</p>
</form>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(formCode);
    setCopied(true);
    toast({ title: "Copied!", description: "Form code copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <Card className="border shadow-sm p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Code className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-display font-semibold text-base">Web to Lead Form</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Customize the lead capture form for your company website. The generated HTML code can be copied and pasted into any website.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Form Title</Label>
            <Input value={formTitle} onChange={e => { setFormTitle(e.target.value); setCopied(false); }} className="rounded-xl" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Subtitle</Label>
            <Input value={formSubtitle} onChange={e => { setFormSubtitle(e.target.value); setCopied(false); }} className="rounded-xl" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Button Text</Label>
            <Input value={btnText} onChange={e => { setBtnText(e.target.value); setCopied(false); }} className="rounded-xl" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Footer Text</Label>
            <Input value={footerText} onChange={e => { setFooterText(e.target.value); setCopied(false); }} className="rounded-xl" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Button Color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={btnColor} onChange={e => { setBtnColor(e.target.value); setCopied(false); }} className="w-9 h-9 rounded-lg border cursor-pointer" />
              <Input value={btnColor} onChange={e => { setBtnColor(e.target.value); setCopied(false); }} className="rounded-xl font-mono text-xs flex-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Background Color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={bgColor} onChange={e => { setBgColor(e.target.value); setCopied(false); }} className="w-9 h-9 rounded-lg border cursor-pointer" />
              <Input value={bgColor} onChange={e => { setBgColor(e.target.value); setCopied(false); }} className="rounded-xl font-mono text-xs flex-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Border Color</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={borderColor} onChange={e => { setBorderColor(e.target.value); setCopied(false); }} className="w-9 h-9 rounded-lg border cursor-pointer" />
              <Input value={borderColor} onChange={e => { setBorderColor(e.target.value); setCopied(false); }} className="rounded-xl font-mono text-xs flex-1" />
            </div>
          </div>
        </div>
      </Card>

      <Card className="border shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <Eye className="w-4 h-4 text-green-600" />
          </div>
          <h3 className="font-display font-semibold text-base">Form Preview</h3>
        </div>
        <div className="bg-secondary/30 rounded-xl p-8 flex justify-center">
          <div dangerouslySetInnerHTML={{ __html: formCode }} />
        </div>
      </Card>

      <Card className="border shadow-sm p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Code className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-display font-semibold text-base">Generated Code</h3>
        </div>
        <div className="relative">
          <div className="absolute top-3 right-3 z-10">
            <Button size="sm" variant="secondary" onClick={handleCopy} className="gap-1.5 text-xs shadow-sm">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy Code"}
            </Button>
          </div>
          <pre className="bg-secondary/50 border rounded-xl p-4 pr-28 text-xs text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all max-h-72 overflow-y-auto font-mono leading-relaxed">
            {formCode}
          </pre>
        </div>
      </Card>

      <Card className="border shadow-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <ExternalLink className="w-4 h-4 text-amber-600" />
          </div>
          <h3 className="font-display font-semibold text-base">How to Use</h3>
        </div>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Customize the form title, subtitle, colors, and button text above</li>
          <li>Preview the form to see your changes in real time</li>
          <li>Click <strong>"Copy Code"</strong> to copy the generated HTML</li>
          <li>Open your website's HTML editor or CMS</li>
          <li>Paste the code where you want the lead form to appear</li>
          <li>Save and publish — submitted leads will appear in your <strong>Leads</strong> page automatically</li>
        </ol>
      </Card>
    </div>
  );
}
