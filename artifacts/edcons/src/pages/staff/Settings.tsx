import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { User, Globe, Bell, Shield, Save, Check } from "lucide-react";

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "tr", label: "Türkçe", flag: "🇹🇷" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
];

export default function SettingsPage() {
  const { user } = useAuth(true);
  const { lang, setLang } = useI18n();
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState({
    newLeads: true, applicationUpdates: true, documentAlerts: true, financeAlerts: false,
  });

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your profile and preferences</p>
        </div>

        <Tabs defaultValue="profile">
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="profile" className="rounded-lg gap-2"><User className="w-4 h-4" /> Profile</TabsTrigger>
            <TabsTrigger value="language" className="rounded-lg gap-2"><Globe className="w-4 h-4" /> Language</TabsTrigger>
            <TabsTrigger value="notifications" className="rounded-lg gap-2"><Bell className="w-4 h-4" /> Notifications</TabsTrigger>
            <TabsTrigger value="security" className="rounded-lg gap-2"><Shield className="w-4 h-4" /> Security</TabsTrigger>
          </TabsList>

          {/* Profile */}
          <TabsContent value="profile" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Personal Information</h2>
              <div className="flex items-center gap-6 mb-8">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg">
                  {user?.firstName?.[0]}{user?.lastName?.[0] || user?.email?.[0]}
                </div>
                <div>
                  <p className="font-bold text-foreground text-lg">{user?.firstName} {user?.lastName}</p>
                  <p className="text-muted-foreground text-sm capitalize">{user?.role?.replace('_', ' ')}</p>
                  <Button variant="outline" size="sm" className="mt-3 rounded-xl">Change Photo</Button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">First Name</label>
                  <Input defaultValue={user?.firstName || ""} className="rounded-xl" />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Last Name</label>
                  <Input defaultValue={user?.lastName || ""} className="rounded-xl" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Email Address</label>
                  <Input type="email" defaultValue={user?.email || ""} className="rounded-xl" />
                </div>
              </div>
              <Button onClick={handleSave} className="mt-6 rounded-xl gap-2 px-8">
                {saved ? <><Check className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> Save Changes</>}
              </Button>
            </Card>
          </TabsContent>

          {/* Language */}
          <TabsContent value="language" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Language & Region</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {LANGUAGES.map(l => (
                  <button key={l.code} onClick={() => setLang(l.code as any)}
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50
                      ${lang === l.code ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10' : 'border-border hover:bg-secondary/30'}`}>
                    <span className="text-3xl">{l.flag}</span>
                    <div>
                      <p className="font-bold text-foreground">{l.label}</p>
                      <p className="text-xs text-muted-foreground">{l.code.toUpperCase()}</p>
                    </div>
                    {lang === l.code && <Check className="w-5 h-5 text-primary ml-auto" />}
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground text-sm mt-4">RTL (right-to-left) is automatically applied for Arabic.</p>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Notification Preferences</h2>
              <div className="space-y-4">
                {[
                  { key: "newLeads", label: "New Leads", desc: "Notify when a new lead is created or assigned" },
                  { key: "applicationUpdates", label: "Application Updates", desc: "Notify when application stage changes" },
                  { key: "documentAlerts", label: "Document Alerts", desc: "Notify when documents are uploaded or need review" },
                  { key: "financeAlerts", label: "Finance Alerts", desc: "Notify for new invoices and overdue payments" },
                ].map(n => (
                  <div key={n.key} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/30 transition-colors">
                    <div>
                      <p className="font-semibold text-foreground">{n.label}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{n.desc}</p>
                    </div>
                    <button
                      onClick={() => setNotifications(prev => ({ ...prev, [n.key]: !prev[n.key as keyof typeof prev] }))}
                      className={`relative w-12 h-6 rounded-full transition-all ${notifications[n.key as keyof typeof notifications] ? 'bg-primary' : 'bg-secondary border-2 border-border'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notifications[n.key as keyof typeof notifications] ? 'translate-x-6' : ''}`} />
                    </button>
                  </div>
                ))}
              </div>
              <Button onClick={handleSave} className="mt-6 rounded-xl gap-2 px-8">
                {saved ? <><Check className="w-4 h-4" /> Saved!</> : <><Save className="w-4 h-4" /> Save Preferences</>}
              </Button>
            </Card>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="mt-6">
            <Card className="border-none shadow-lg shadow-black/5 p-6">
              <h2 className="font-display font-bold text-lg mb-6">Security & Access</h2>
              <div className="space-y-4">
                <div className="p-5 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="font-bold text-blue-800 flex items-center gap-2">
                    <Shield className="w-5 h-5" /> Authentication via Replit
                  </p>
                  <p className="text-sm text-blue-700 mt-2">
                    Your account is secured through Replit's authentication system. No password management required.
                  </p>
                </div>
                <div className="p-5 rounded-xl border border-border/50">
                  <p className="font-semibold text-foreground mb-1">Current Role</p>
                  <p className="text-muted-foreground text-sm capitalize">{user?.role?.replace('_', ' ')} — ID: {user?.id}</p>
                </div>
                <div className="p-5 rounded-xl border border-border/50">
                  <p className="font-semibold text-foreground mb-3">Active Sessions</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-foreground">Current session</p>
                      <p className="text-xs text-muted-foreground">This device • Active now</p>
                    </div>
                    <Badge className="bg-green-500/10 text-green-600 border-green-200 text-xs">Active</Badge>
                  </div>
                </div>
                <Button variant="outline" className="w-full rounded-xl text-destructive hover:bg-destructive/5 hover:border-destructive/30">
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
