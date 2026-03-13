import { useState, useEffect } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import {
  User, Globe, Shield, Save, Check, Briefcase,
  Loader2, Phone, Mail, TrendingUp, Link2, Copy, MapPin,
} from "lucide-react";

const LANGUAGES = [
  { code: "en", label: "English",   flag: "🇬🇧" },
  { code: "tr", label: "Türkçe",    flag: "🇹🇷" },
  { code: "ar", label: "العربية",   flag: "🇸🇦" },
  { code: "fr", label: "Français",  flag: "🇫🇷" },
  { code: "ru", label: "Русский",   flag: "🇷🇺" },
];

export default function AgentAccount() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        firstName: user.firstName || "",
        lastName:  user.lastName  || "",
        phone:     (user as any).phone || "",
      });
    }
  }, [user]);

  const { data: agentProfile, isLoading: agentLoading } = useQuery({
    queryKey: ["agent-me"],
    enabled: !!user,
    queryFn: async () => {
      const res = await customFetch("/api/agents/me");
      if (!res.ok) return null;
      return res.json();
    },
  });

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
      toast({ title: "Profile updated", description: "Your information has been saved." });
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
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs mt-2">
                    {user?.role === "sub_agent" ? "Sub Agent" : "Agent"}
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

          {/* ── Agency ── */}
          <TabsContent value="agency" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Agency Information</h2>
              {agentLoading ? (
                <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-secondary animate-pulse rounded-xl" />)}</div>
              ) : !agentProfile ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="font-medium">No agency profile yet</p>
                  <p className="text-sm mt-1">Your agency details will appear here once set up by an admin</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { label: "Agency Name",       icon: Briefcase,   value: agentProfile.agencyName },
                    { label: "Country",           icon: MapPin,      value: agentProfile.country },
                    { label: "Commission Rate",   icon: TrendingUp,  value: agentProfile.commissionRate ? `${agentProfile.commissionRate}%` : null },
                    { label: "Status",            icon: Check,       value: agentProfile.status },
                  ].map((f, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                          <f.icon className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground font-medium">{f.label}</p>
                          <p className="text-sm font-semibold text-foreground capitalize">{f.value || <span className="text-muted-foreground italic font-normal">Not set</span>}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2 p-3 rounded-xl bg-secondary/40">
                    Agency details are managed by your account administrator. Contact your manager to update this information.
                  </p>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ── Referral ── */}
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

          {/* ── Language ── */}
          <TabsContent value="language" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Language Preference</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {LANGUAGES.map(l => (
                  <button key={l.code} onClick={() => handleSaveLang(l.code)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50
                      ${lang === l.code ? "border-primary bg-primary/5 shadow-sm shadow-primary/10" : "border-border hover:bg-secondary/30"}`}>
                    <span className="text-3xl">{l.flag}</span>
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

          {/* ── Security ── */}
          <TabsContent value="security" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Security & Access</h2>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="font-bold text-blue-800 flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Secured Account
                  </p>
                  <p className="text-sm text-blue-700 mt-2">
                    Your account is secured through Replit's authentication system.
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
