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
  User, Globe, Shield, Save, Check, GraduationCap,
  Loader2, FileText, MapPin, Phone, Mail, Calendar,
} from "lucide-react";

const LANGUAGES = [
  { code: "en", label: "English",   flag: "🇬🇧" },
  { code: "tr", label: "Türkçe",    flag: "🇹🇷" },
  { code: "ar", label: "العربية",   flag: "🇸🇦" },
  { code: "fr", label: "Français",  flag: "🇫🇷" },
  { code: "ru", label: "Русский",   flag: "🇷🇺" },
];

export default function StudentAccount() {
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

  const { data: studentProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["student-me"],
    enabled: !!user,
    queryFn: async () => {
      const res = await customFetch("/api/students/me");
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

  const initials = `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || user?.email?.[0] || "?"}`.toUpperCase();

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">My Account</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your profile and preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="profile"     className="rounded-lg gap-2"><User className="w-4 h-4" /> Profile</TabsTrigger>
            <TabsTrigger value="student"     className="rounded-lg gap-2"><GraduationCap className="w-4 h-4" /> Student Info</TabsTrigger>
            <TabsTrigger value="language"    className="rounded-lg gap-2"><Globe className="w-4 h-4" /> Language</TabsTrigger>
            <TabsTrigger value="security"    className="rounded-lg gap-2"><Shield className="w-4 h-4" /> Security</TabsTrigger>
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
                  <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs mt-2">Student</Badge>
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

          {/* ── Student Info ── */}
          <TabsContent value="student" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Student Record</h2>
              {profileLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-secondary animate-pulse rounded-xl" />)}
                </div>
              ) : !studentProfile ? (
                <div className="text-center py-10 text-muted-foreground">
                  <GraduationCap className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="font-medium">No student record yet</p>
                  <p className="text-sm mt-1">Your advisor will set up your student profile</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { label: "Nationality",        icon: MapPin,    value: studentProfile.nationality },
                    { label: "Date of Birth",       icon: Calendar,  value: studentProfile.dateOfBirth ? new Date(studentProfile.dateOfBirth).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : null },
                    { label: "Passport Number",     icon: FileText,  value: studentProfile.passportNumber },
                    { label: "Emergency Contact",   icon: Phone,     value: studentProfile.emergencyContact },
                    { label: "Address",             icon: MapPin,    value: studentProfile.address, fullWidth: true },
                  ].map((f, i) => (
                    <div key={i} className={`space-y-1.5 ${(f as any).fullWidth ? "sm:col-span-2" : ""}`}>
                      <Label className="flex items-center gap-1.5 text-muted-foreground">
                        <f.icon className="w-3.5 h-3.5" /> {f.label}
                      </Label>
                      <div className="px-4 py-3 rounded-xl bg-secondary/40 text-sm text-foreground border border-border/40">
                        {f.value || <span className="text-muted-foreground italic">Not provided</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-6 p-3 rounded-xl bg-secondary/40">
                To update your student record details (passport, nationality, address), please contact your advisor.
              </p>
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
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">Student</Badge>
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
