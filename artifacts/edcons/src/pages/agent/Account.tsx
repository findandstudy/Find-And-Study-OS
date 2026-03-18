import { useState, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import {
  User, Globe, Shield, Save, Check, Briefcase,
  Loader2, Phone, Mail, TrendingUp, Link2, Copy, MapPin,
  Upload, X, FileText, Download, Image as ImageIcon, Eye,
  Camera, Lock, KeyRound,
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";

const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const LANGUAGES = [
  { code: "en", label: "English",   country: "GB" },
  { code: "tr", label: "Türkçe",    country: "TR" },
  { code: "ar", label: "العربية",   country: "SA" },
  { code: "fr", label: "Français",  country: "FR" },
  { code: "ru", label: "Русский",   country: "RU" },
];

const PHONE_CODES = [
  { code: "+90", country: "TR" },
  { code: "+1", country: "US" },
  { code: "+44", country: "GB" },
  { code: "+49", country: "DE" },
  { code: "+33", country: "FR" },
  { code: "+971", country: "AE" },
  { code: "+966", country: "SA" },
  { code: "+91", country: "IN" },
  { code: "+86", country: "CN" },
  { code: "+81", country: "JP" },
  { code: "+82", country: "KR" },
  { code: "+55", country: "BR" },
  { code: "+234", country: "NG" },
  { code: "+20", country: "EG" },
  { code: "+254", country: "KE" },
  { code: "+27", country: "ZA" },
  { code: "+62", country: "ID" },
  { code: "+60", country: "MY" },
  { code: "+63", country: "PH" },
  { code: "+92", country: "PK" },
  { code: "+880", country: "BD" },
  { code: "+7", country: "RU" },
  { code: "+380", country: "UA" },
  { code: "+48", country: "PL" },
  { code: "+39", country: "IT" },
  { code: "+34", country: "ES" },
  { code: "+31", country: "NL" },
  { code: "+46", country: "SE" },
  { code: "+47", country: "NO" },
  { code: "+358", country: "FI" },
  { code: "+212", country: "MA" },
  { code: "+216", country: "TN" },
  { code: "+213", country: "DZ" },
  { code: "+964", country: "IQ" },
  { code: "+962", country: "JO" },
  { code: "+961", country: "LB" },
  { code: "+994", country: "AZ" },
  { code: "+995", country: "GE" },
  { code: "+998", country: "UZ" },
  { code: "+993", country: "TM" },
];

function splitPhone(phone: string | null) {
  if (!phone) return { code: "+90", number: "" };
  const sorted = [...PHONE_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const pc of sorted) {
    if (phone.startsWith(pc.code)) {
      return { code: pc.code, number: phone.slice(pc.code.length).trim() };
    }
  }
  return { code: "+90", number: phone };
}

async function uploadFileToStorage(file: File): Promise<string> {
  const urlRes = await customFetch<any>(`/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!urlRes.uploadURL || !urlRes.objectPath) throw new Error("Failed to get upload URL");
  const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("Upload failed");
  const strippedPath = urlRes.objectPath.replace(/^\/objects/, "");
  return `${BASE_URL}/api/storage/objects${strippedPath}`;
}

export default function AgentAccount() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ firstName: "", lastName: "", phoneCode: "+90", phoneNumber: "", email: "", avatarUrl: "" });
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (user) {
      const { code, number } = splitPhone((user as any).phone || "");
      setForm({
        firstName: user.firstName || "",
        lastName:  user.lastName  || "",
        phoneCode: code,
        phoneNumber: number,
        email: user.email || "",
        avatarUrl: user.avatarUrl || "",
      });
    }
  }, [user]);

  const { data: agentProfile, isLoading: agentLoading } = useQuery({
    queryKey: ["agent-me"],
    enabled: !!user,
    queryFn: () => customFetch<any>("/api/agents/me"),
  });

  async function handleAvatarUpload(file: File) {
    if (!user) return;
    setAvatarUploading(true);
    try {
      const avatarUrl = await uploadFileToStorage(file);
      setForm(f => ({ ...f, avatarUrl }));
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Profile photo updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setAvatarUploading(false); }
  }

  async function handleRemoveAvatar() {
    if (!user) return;
    try {
      setForm(f => ({ ...f, avatarUrl: "" }));
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Profile photo removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function handleSaveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      const phone = form.phoneNumber ? `${form.phoneCode}${form.phoneNumber}` : undefined;
      await customFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName:  form.lastName,
          phone,
          email: form.email || undefined,
          avatarUrl: form.avatarUrl || null,
        }),
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Profile updated", description: "Your information has been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (pwForm.newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setChangingPw(true);
    try {
      await customFetch("/api/users/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword }),
      });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setChangingPw(false); }
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
    } catch {}
  }

  const referralLink = `${window.location.origin}/apply?ref=${agentProfile?.id || user?.id || "AGENT"}`;
  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast({ title: "Copied!", description: "Referral link copied to clipboard." });
  };

  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || user?.email?.[0] || "?"}`.toUpperCase();

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">My Account</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your agent profile and preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="profile"  className="rounded-lg gap-2"><User className="w-4 h-4" /> Profile</TabsTrigger>
            <TabsTrigger value="agency"   className="rounded-lg gap-2"><Briefcase className="w-4 h-4" /> Agency</TabsTrigger>
            <TabsTrigger value="referral" className="rounded-lg gap-2"><Link2 className="w-4 h-4" /> Referral</TabsTrigger>
            <TabsTrigger value="language" className="rounded-lg gap-2"><Globe className="w-4 h-4" /> Language</TabsTrigger>
            <TabsTrigger value="security" className="rounded-lg gap-2"><Shield className="w-4 h-4" /> Security</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-6 space-y-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Personal Information</h2>
              <div className="flex items-center gap-5 mb-8 p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/10">
                <div className="relative group shrink-0">
                  {form.avatarUrl ? (
                    <img src={form.avatarUrl} alt="" className="w-20 h-20 rounded-2xl object-cover shadow-lg" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg">
                      {initials}
                    </div>
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
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs mt-2">
                    {user?.role === "sub_agent" ? "Sub Agent" : "Agent"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">Hover photo to change</p>
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
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                  <div className="flex gap-2">
                    <Select value={form.phoneCode} onValueChange={v => setForm(f => ({ ...f, phoneCode: v }))}>
                      <SelectTrigger className="w-[120px] rounded-xl shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {PHONE_CODES.map(pc => (
                          <SelectItem key={pc.code + pc.country} value={pc.code}>
                            <span className="inline-flex items-center gap-1.5">
                              <CountryFlag code={pc.country} size="sm" />
                              {pc.code}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={form.phoneNumber}
                      onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))}
                      placeholder="555 123 4567"
                      className="rounded-xl flex-1"
                    />
                  </div>
                </div>
              </div>
              <Button onClick={handleSaveProfile} disabled={saving} className="mt-6 rounded-xl gap-2 px-8">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </Card>

            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" /> Change Password
              </h2>
              <div className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label>Current Password</Label>
                  <Input type="password" value={pwForm.currentPassword} onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>New Password</Label>
                  <Input type="password" value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="Min 6 characters" className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirm New Password</Label>
                  <Input type="password" value={pwForm.confirmPassword} onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} className="rounded-xl" />
                </div>
                <Button onClick={handleChangePassword} disabled={changingPw || !pwForm.currentPassword || !pwForm.newPassword} className="rounded-xl gap-2 px-8">
                  {changingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Change Password
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="agency" className="mt-6">
            <AgencyTab agentProfile={agentProfile} agentLoading={agentLoading} />
          </TabsContent>

          <TabsContent value="referral" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Your Referral Link</h2>
              <div className="p-5 rounded-2xl bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 mb-5">
                <p className="text-sm text-muted-foreground mb-3 font-medium">Share this link with prospective students to track your referrals</p>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-background border border-border/50 mb-4">
                  <Link2 className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm font-mono text-foreground flex-1 truncate">{referralLink}</p>
                </div>
                <Button onClick={copyLink} className="w-full rounded-xl gap-2">
                  <Copy className="w-4 h-4" /> Copy Referral Link
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-4 rounded-xl bg-secondary/40 border border-border/40">
                  <p className="text-xs text-muted-foreground mb-1">Agent ID</p>
                  <p className="font-mono font-bold text-foreground">#{agentProfile?.id || user?.id}</p>
                </div>
                <div className="p-4 rounded-xl bg-secondary/40 border border-border/40">
                  <p className="text-xs text-muted-foreground mb-1">Commission Rate</p>
                  <p className="font-bold text-foreground">{agentProfile?.commissionRate ? `${agentProfile.commissionRate}%` : "—"}</p>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="language" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Language Preference</h2>
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
            </Card>
          </TabsContent>

          <TabsContent value="security" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Security & Access</h2>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800">
                  <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Secured Account
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">
                    Your account is secured with email and password authentication.
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-border/50 space-y-2">
                  <p className="font-semibold text-foreground">Account Details</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Role</span>
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs capitalize">
                      {user?.role?.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Account ID</span>
                    <span className="font-mono text-foreground">#{user?.id}</span>
                  </div>
                </div>
                <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/5 hover:border-destructive/30" asChild>
                  <a href="/api/auth/logout">Sign Out</a>
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function AgencyTab({ agentProfile, agentLoading }: { agentProfile: any; agentLoading: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (agentProfile) {
      setBusinessName(agentProfile.businessName || "");
    }
  }, [agentProfile]);

  async function handleSaveAgency() {
    setSaving(true);
    try {
      await customFetch("/api/agents/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName }),
      });
      await qc.invalidateQueries({ queryKey: ["agent-me"] });
      toast({ title: "Agency updated", description: "Your business name has been saved." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDocUpload(field: "logoUrl" | "businessCertUrl", file: File) {
    try {
      const url = await uploadFileToStorage(file);
      await customFetch("/api/agents/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: url }),
      });
      await qc.invalidateQueries({ queryKey: ["agent-me"] });
      toast({ title: "Document uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  }

  async function handleDocRemove(field: "logoUrl" | "businessCertUrl") {
    try {
      await customFetch("/api/agents/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: "" }),
      });
      await qc.invalidateQueries({ queryKey: ["agent-me"] });
      toast({ title: "Document removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  if (agentLoading) {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <h2 className="font-display font-bold text-lg mb-6">Agency Information</h2>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-secondary animate-pulse rounded-xl" />)}
        </div>
      </Card>
    );
  }

  if (!agentProfile) {
    return (
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <h2 className="font-display font-bold text-lg mb-6">Agency Information</h2>
        <div className="text-center py-10 text-muted-foreground">
          <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="font-medium">No agency profile yet</p>
          <p className="text-sm mt-1">Your agency details will appear here once set up by an admin</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <h2 className="font-display font-bold text-lg mb-6">Agency Information</h2>
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-secondary/20">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Agency Code</p>
                <p className="text-sm font-bold text-foreground font-mono">
                  {agentProfile.agencyCode || <span className="text-muted-foreground italic font-normal">Not assigned yet</span>}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">Set by Admin</Badge>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Business Name</Label>
            <p className="text-xs text-muted-foreground">Enter your legal company / business name</p>
            <Input
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              placeholder="e.g. Global Education Consulting Ltd."
              className="rounded-xl"
            />
          </div>

          <div className="space-y-4">
            {[
              { label: "Country",         icon: MapPin,      value: agentProfile.country },
              { label: "Commission Rate", icon: TrendingUp,  value: agentProfile.commissionRate ? `${agentProfile.commissionRate}%` : null },
              { label: "Status",          icon: Check,        value: agentProfile.status },
            ].map((f, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <f.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{f.label}</p>
                    <p className="text-sm font-semibold text-foreground capitalize">
                      {f.value || <span className="text-muted-foreground italic font-normal">Not set</span>}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button onClick={handleSaveAgency} disabled={saving} className="rounded-xl gap-2 px-8">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>
      </Card>

      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <h2 className="font-display font-bold text-lg mb-6">Documents</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          <DocumentUploader
            label="Logo for Agent Panel"
            accept="image/*"
            value={agentProfile.logoUrl}
            onUpload={file => handleDocUpload("logoUrl", file)}
            onRemove={() => handleDocRemove("logoUrl")}
            icon={<ImageIcon className="w-6 h-6" />}
          />
          <DocumentViewer
            label="Contract"
            value={agentProfile.contractUrl}
          />
          <DocumentUploader
            label="Business Certificate"
            accept="image/*,.pdf"
            value={agentProfile.businessCertUrl}
            onUpload={file => handleDocUpload("businessCertUrl", file)}
            onRemove={() => handleDocRemove("businessCertUrl")}
            icon={<FileText className="w-6 h-6" />}
          />
        </div>
      </Card>
    </div>
  );
}

function DocumentUploader({
  label, accept, value, onUpload, onRemove, icon,
}: {
  label: string; accept: string; value?: string | null;
  onUpload: (file: File) => void; onRemove: () => void;
  icon: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="relative w-full h-36 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex items-center justify-center overflow-hidden bg-secondary/10">
        {value ? (
          <>
            {accept.includes("image") && value.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? (
              <img src={value} alt={label} className="max-h-28 max-w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-primary">
                <FileText className="w-8 h-8" />
                <span className="text-[10px] font-medium">Uploaded</span>
              </div>
            )}
            <div className="absolute top-2 right-2 flex gap-1">
              <a href={value} target="_blank" rel="noopener noreferrer"
                className="w-6 h-6 rounded-full bg-primary/90 text-white flex items-center justify-center hover:bg-primary">
                <Eye className="w-3 h-3" />
              </a>
              <button onClick={onRemove}
                className="w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive">
                <X className="w-3 h-3" />
              </button>
            </div>
          </>
        ) : (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex flex-col items-center gap-2 text-muted-foreground hover:text-primary transition-colors">
            {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : icon || <Upload className="w-6 h-6" />}
            <span className="text-[10px] font-medium">{uploading ? "Uploading..." : "Upload"}</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

function DocumentViewer({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold">{label}</Label>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0">Admin Only</Badge>
      </div>
      <div className="relative w-full h-36 rounded-xl border-2 border-dashed border-border bg-secondary/10 flex items-center justify-center overflow-hidden">
        {value ? (
          <>
            {value.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? (
              <img src={value} alt={label} className="max-h-28 max-w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-green-600">
                <FileText className="w-8 h-8" />
                <span className="text-[10px] font-medium">Contract uploaded</span>
              </div>
            )}
            <div className="absolute top-2 right-2">
              <a href={value} target="_blank" rel="noopener noreferrer"
                className="w-7 h-7 rounded-full bg-primary/90 text-white flex items-center justify-center hover:bg-primary shadow-sm">
                <Download className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
            <FileText className="w-8 h-8" />
            <span className="text-[10px] font-medium">No contract uploaded</span>
            <span className="text-[9px]">Uploaded by admin</span>
          </div>
        )}
      </div>
    </div>
  );
}
