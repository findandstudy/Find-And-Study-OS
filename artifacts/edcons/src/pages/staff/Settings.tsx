import { useState, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { useTheme } from "@/contexts/ThemeContext";
import { User, Globe, Bell, Shield, Save, Check, Loader2, Phone, Mail, Palette, Upload, X, Sun, Moon, Monitor, Image as ImageIcon, Plug } from "lucide-react";
import { NotificationRulesManager } from "@/components/NotificationRulesManager";
import { CountryFlag } from "@/components/CountryFlag";
import { IntegrationsManager } from "@/components/IntegrationsManager";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const LANGUAGES = [
  { code: "en", label: "English",   country: "GB" },
  { code: "tr", label: "Türkçe",    country: "TR" },
  { code: "ar", label: "العربية",   country: "SA" },
  { code: "fr", label: "Français",  country: "FR" },
  { code: "ru", label: "Русский",   country: "RU" },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", manager: "Manager",
  staff: "Staff", consultant: "Consultant", accountant: "Accountant", editor: "Editor",
  student: "Student", agent: "Agent", sub_agent: "Sub Agent",
};

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

export default function SettingsPage() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mode, setMode, resolvedTheme, settings: themeSettings, refreshSettings } = useTheme();

  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState({
    newLeads: true, applicationUpdates: true, documentAlerts: true, financeAlerts: false,
  });

  const [brandForm, setBrandForm] = useState({
    logoUrl: "", logoDarkUrl: "", themePrimary: "", themeButton: "", themeHover: "",
  });
  const [brandSaving, setBrandSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDarkUploading, setLogoDarkUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoDarkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName || "",
        lastName:  user.lastName  || "",
        phone:     (user as any).phone || "",
      });
    }
  }, [user]);

  useEffect(() => {
    setBrandForm({
      logoUrl: themeSettings.logoUrl || "",
      logoDarkUrl: themeSettings.logoDarkUrl || "",
      themePrimary: themeSettings.themePrimary || "",
      themeButton: themeSettings.themeButton || "",
      themeHover: themeSettings.themeHover || "",
    });
  }, [themeSettings]);

  async function handleSaveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName:  form.lastName,
          phone:     form.phone || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLang(code: string) {
    if (!user) return;
    setLang(code as any);
    try {
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: code }),
      });
      toast({ title: "Language updated" });
    } catch {}
  }

  async function uploadLogo(file: File, field: "logoUrl" | "logoDarkUrl") {
    const setUploading = field === "logoUrl" ? setLogoUploading : setLogoDarkUploading;
    setUploading(true);
    try {
      const urlRes = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.uploadURL || !urlRes.objectPath) throw new Error("Failed to get upload URL");
      const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error(`Upload failed with status ${putRes.status}`);
      const strippedPath = urlRes.objectPath.replace(/^\/objects/, "");
      const publicUrl = `${BASE_URL}/api/storage/objects${strippedPath}`;
      setBrandForm(f => ({ ...f, [field]: publicUrl }));
      toast({ title: "Logo uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function isValidHex(v: string): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(v);
  }

  async function handleSaveBrand() {
    for (const key of ["themePrimary", "themeButton", "themeHover"] as const) {
      if (brandForm[key] && !isValidHex(brandForm[key])) {
        toast({ title: "Invalid color", description: `"${brandForm[key]}" is not a valid hex color (e.g. #3B82F6).`, variant: "destructive" });
        return;
      }
    }
    setBrandSaving(true);
    try {
      await customFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl: brandForm.logoUrl || null,
          logoDarkUrl: brandForm.logoDarkUrl || null,
          themePrimary: brandForm.themePrimary || null,
          themeButton: brandForm.themeButton || null,
          themeHover: brandForm.themeHover || null,
        }),
      });
      await refreshSettings();
      toast({ title: "Branding saved", description: "Theme and logos have been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBrandSaving(false);
    }
  }

  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || user?.email?.[0] || "?"}`.toUpperCase();
  const isManager = MANAGER_ROLES.includes(user?.role || "");

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your profile and preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/50 p-1 flex-wrap h-auto">
            <TabsTrigger value="profile"       className="rounded-lg gap-2"><User className="w-4 h-4" /> Profile</TabsTrigger>
            <TabsTrigger value="language"      className="rounded-lg gap-2"><Globe className="w-4 h-4" /> Language</TabsTrigger>
            <TabsTrigger value="notifications" className="rounded-lg gap-2"><Bell className="w-4 h-4" /> Notifications</TabsTrigger>
            <TabsTrigger value="security"      className="rounded-lg gap-2"><Shield className="w-4 h-4" /> Security</TabsTrigger>
            {isManager && (
              <TabsTrigger value="integrations" className="rounded-lg gap-2"><Plug className="w-4 h-4" /> Integrations</TabsTrigger>
            )}
            {isManager && (
              <TabsTrigger value="branding" className="rounded-lg gap-2"><Palette className="w-4 h-4" /> Branding</TabsTrigger>
            )}
          </TabsList>

          {/* ── Profile ── */}
          <TabsContent value="profile" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Personal Information</h2>
              <div className="flex items-center gap-5 mb-8 p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/10">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg shrink-0">
                  {initials}
                </div>
                <div>
                  <p className="font-display font-bold text-lg text-foreground">{user?.firstName} {user?.lastName}</p>
                  <p className="text-muted-foreground text-sm">{user?.email}</p>
                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs mt-2 capitalize">
                    {ROLE_LABELS[user?.role || ""] || user?.role}
                  </Badge>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <Label>First Name</Label>
                  <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name</Label>
                  <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</Label>
                  <Input type="email" value={user?.email || ""} disabled className="rounded-xl bg-secondary/40 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Email is managed by your login provider</p>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 234 567 8900" className="rounded-xl" />
                </div>
              </div>
              <Button onClick={handleSaveProfile} disabled={saving} className="mt-6 rounded-xl gap-2 px-8">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </Card>
          </TabsContent>

          {/* ── Language ── */}
          <TabsContent value="language" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Language & Region</h2>
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
          </TabsContent>

          {/* ── Notifications ── */}
          <TabsContent value="notifications" className="mt-6">
            <NotificationRulesManager isAdmin={isManager} notifications={notifications} setNotifications={setNotifications} />
          </TabsContent>

          {/* ── Security ── */}
          <TabsContent value="security" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Security & Access</h2>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Authentication via Replit
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">
                    Your account is secured through Replit's authentication system. No password management required.
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-border/50 space-y-2">
                  <p className="font-semibold text-foreground">Account Details</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Role</span>
                    <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs capitalize">
                      {ROLE_LABELS[user?.role || ""] || user?.role}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Account ID</span>
                    <span className="font-mono text-foreground">#{user?.id}</span>
                  </div>
                </div>
                <div className="p-5 rounded-xl border border-border/50">
                  <p className="font-semibold text-foreground mb-3">Active Sessions</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground">Current session</p>
                      <p className="text-xs text-muted-foreground">This device · Active now</p>
                    </div>
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">Active</Badge>
                  </div>
                </div>
                <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/5 hover:border-destructive/30" asChild>
                  <a href="/api/auth/logout">Sign Out</a>
                </Button>
              </div>
            </Card>
          </TabsContent>

          {/* ── Integrations (Managers only) ── */}
          {isManager && (
            <TabsContent value="integrations" className="mt-6">
              <IntegrationsManager />
            </TabsContent>
          )}

          {/* ── Branding (Managers only) ── */}
          {isManager && (
            <TabsContent value="branding" className="mt-6 space-y-6">
              {/* Theme Mode */}
              <Card className="border-none shadow-lg shadow-black/5 p-6">
                <h2 className="font-display font-bold text-lg mb-2">Appearance</h2>
                <p className="text-sm text-muted-foreground mb-5">Choose between light and dark mode for the entire system.</p>
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
                      <span className="font-semibold text-sm text-foreground">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </Card>

              {/* Logos */}
              <Card className="border-none shadow-lg shadow-black/5 p-6">
                <h2 className="font-display font-bold text-lg mb-2">System Logos</h2>
                <p className="text-sm text-muted-foreground mb-5">Upload your company logo. The dark mode logo will be used when dark theme is active.</p>
                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Light Logo */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Light Mode Logo</Label>
                    <div className="relative w-full h-32 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors bg-white flex items-center justify-center overflow-hidden">
                      {brandForm.logoUrl ? (
                        <>
                          <img src={brandForm.logoUrl} alt="Logo" className="max-h-24 max-w-full object-contain" />
                          <button onClick={() => setBrandForm(f => ({ ...f, logoUrl: "" }))}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => logoInputRef.current?.click()}
                          className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
                          disabled={logoUploading}>
                          {logoUploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
                          <span className="text-xs font-medium">{logoUploading ? "Uploading..." : "Click to upload"}</span>
                        </button>
                      )}
                    </div>
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f, "logoUrl"); e.target.value = ""; }} />
                  </div>

                  {/* Dark Logo */}
                  <div className="space-y-3">
                    <Label className="flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" /> Dark Mode Logo</Label>
                    <div className="relative w-full h-32 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors bg-gray-900 flex items-center justify-center overflow-hidden">
                      {brandForm.logoDarkUrl ? (
                        <>
                          <img src={brandForm.logoDarkUrl} alt="Dark Logo" className="max-h-24 max-w-full object-contain" />
                          <button onClick={() => setBrandForm(f => ({ ...f, logoDarkUrl: "" }))}
                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive">
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => logoDarkInputRef.current?.click()}
                          className="flex flex-col items-center gap-2 text-gray-400 hover:text-blue-400 transition-colors"
                          disabled={logoDarkUploading}>
                          {logoDarkUploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
                          <span className="text-xs font-medium">{logoDarkUploading ? "Uploading..." : "Click to upload"}</span>
                        </button>
                      )}
                    </div>
                    <input ref={logoDarkInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f, "logoDarkUrl"); e.target.value = ""; }} />
                  </div>
                </div>
              </Card>

              {/* Theme Colors */}
              <Card className="border-none shadow-lg shadow-black/5 p-6">
                <h2 className="font-display font-bold text-lg mb-2">Theme Colors</h2>
                <p className="text-sm text-muted-foreground mb-5">Customize the main colors of the system. Leave empty to use defaults.</p>
                <div className="space-y-5">
                  {([
                    { key: "themePrimary" as const, label: "Primary Color", desc: "Main theme color used for navigation, links, and accents", default: "#3B82F6" },
                    { key: "themeButton" as const, label: "Button Color", desc: "Color used for primary action buttons", default: "#3B82F6" },
                    { key: "themeHover" as const, label: "Hover Color", desc: "Color shown when hovering over buttons and interactive elements", default: "#2563EB" },
                  ]).map(c => (
                    <div key={c.key} className="flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:border-primary/20 transition-colors">
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-lg border-2 border-border shadow-sm cursor-pointer overflow-hidden"
                          style={{ backgroundColor: brandForm[c.key] || c.default }}
                          onClick={() => document.getElementById(`color-${c.key}`)?.click()} />
                        <input id={`color-${c.key}`} type="color" className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          value={brandForm[c.key] || c.default}
                          onChange={e => setBrandForm(f => ({ ...f, [c.key]: e.target.value }))} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.desc}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Input value={brandForm[c.key]} onChange={e => setBrandForm(f => ({ ...f, [c.key]: e.target.value }))}
                          placeholder={c.default} className="w-28 rounded-lg text-xs font-mono h-8" />
                        {brandForm[c.key] && (
                          <button onClick={() => setBrandForm(f => ({ ...f, [c.key]: "" }))}
                            className="text-muted-foreground hover:text-destructive transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Button onClick={handleSaveBrand} disabled={brandSaving} className="rounded-xl gap-2 px-8">
                {brandSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Branding
              </Button>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
