import { useState, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, MessageCircle, Send, Bot, Plug, Key, Eye, EyeOff,
  Loader2, Check, X, ExternalLink, Search, Zap, Globe,
  Smartphone, Video, Share2, Webhook, Database
} from "lucide-react";

interface IntegrationDef {
  key: string;
  name: string;
  category: string;
  icon: any;
  color: string;
  description: string;
  fields: FieldDef[];
}

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "url" | "email";
  placeholder?: string;
  required?: boolean;
}

interface IntegrationData {
  id?: number;
  key: string;
  name: string;
  category: string;
  isEnabled: boolean;
  config: Record<string, any>;
}

const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    key: "smtp", name: "Email (SMTP)", category: "communication",
    icon: Mail, color: "bg-green-500/10 text-green-600 border-green-200",
    description: "Send emails via SMTP relay (Gmail, Outlook, SendGrid, etc.)",
    fields: [
      { key: "host", label: "SMTP Host", type: "text", placeholder: "smtp.gmail.com", required: true },
      { key: "port", label: "Port", type: "number", placeholder: "587" },
      { key: "username", label: "Username", type: "text", placeholder: "your@email.com", required: true },
      { key: "password", label: "Password", type: "password", placeholder: "App password or SMTP password", required: true },
      { key: "fromEmail", label: "From Email", type: "email", placeholder: "noreply@yourcompany.com" },
      { key: "fromName", label: "From Name", type: "text", placeholder: "Find And Study" },
    ],
  },
  {
    key: "whatsapp", name: "WhatsApp Business", category: "communication",
    icon: MessageCircle, color: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    description: "Send WhatsApp messages via Meta Business API",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "text", required: true },
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "businessAccountId", label: "Business Account ID", type: "text" },
      { key: "webhookVerifyToken", label: "Webhook Verify Token", type: "password" },
    ],
  },
  {
    key: "telegram", name: "Telegram Bot", category: "communication",
    icon: Send, color: "bg-sky-500/10 text-sky-600 border-sky-200",
    description: "Send messages via Telegram Bot API",
    fields: [
      { key: "botToken", label: "Bot Token", type: "password", placeholder: "123456:ABC-DEF1234...", required: true },
      { key: "defaultChatId", label: "Default Chat ID", type: "text", placeholder: "Channel or group chat ID" },
      { key: "webhookUrl", label: "Webhook URL (optional)", type: "url" },
    ],
  },
  {
    key: "sms_twilio", name: "SMS (Twilio)", category: "communication",
    icon: Smartphone, color: "bg-red-500/10 text-red-600 border-red-200",
    description: "Send SMS messages via Twilio",
    fields: [
      { key: "accountSid", label: "Account SID", type: "text", required: true },
      { key: "authToken", label: "Auth Token", type: "password", required: true },
      { key: "fromNumber", label: "From Number", type: "text", placeholder: "+1234567890", required: true },
    ],
  },
  {
    key: "openai", name: "OpenAI", category: "ai",
    icon: Bot, color: "bg-gray-500/10 text-gray-700 border-gray-200",
    description: "GPT models for AI-powered features",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-...", required: true },
      { key: "model", label: "Default Model", type: "text", placeholder: "gpt-4o" },
      { key: "orgId", label: "Organization ID (optional)", type: "text" },
    ],
  },
  {
    key: "claude", name: "Anthropic Claude", category: "ai",
    icon: Bot, color: "bg-amber-500/10 text-amber-700 border-amber-200",
    description: "Claude models for document processing and AI features",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-ant-...", required: true },
      { key: "model", label: "Default Model", type: "text", placeholder: "claude-sonnet-4-20250514" },
    ],
  },
  {
    key: "gemini", name: "Google Gemini", category: "ai",
    icon: Bot, color: "bg-blue-500/10 text-blue-600 border-blue-200",
    description: "Google Gemini AI models",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "model", label: "Default Model", type: "text", placeholder: "gemini-2.0-flash" },
    ],
  },
  {
    key: "heygen", name: "HeyGen", category: "ai",
    icon: Video, color: "bg-purple-500/10 text-purple-600 border-purple-200",
    description: "AI video generation with HeyGen",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
    ],
  },
  {
    key: "instagram", name: "Instagram", category: "social",
    icon: Share2, color: "bg-pink-500/10 text-pink-600 border-pink-200",
    description: "Instagram Graph API for lead generation and messaging",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "businessAccountId", label: "Business Account ID", type: "text" },
    ],
  },
  {
    key: "meta_ads", name: "Meta (Facebook)", category: "social",
    icon: Globe, color: "bg-blue-600/10 text-blue-700 border-blue-200",
    description: "Facebook Lead Ads, Conversions API",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "pixelId", label: "Pixel ID", type: "text" },
      { key: "adAccountId", label: "Ad Account ID", type: "text" },
      { key: "pageId", label: "Page ID", type: "text" },
    ],
  },
  {
    key: "twitter", name: "X (Twitter)", category: "social",
    icon: Share2, color: "bg-gray-600/10 text-gray-700 border-gray-300",
    description: "Twitter/X API for social engagement",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "apiSecret", label: "API Secret", type: "password", required: true },
      { key: "accessToken", label: "Access Token", type: "password" },
      { key: "accessTokenSecret", label: "Access Token Secret", type: "password" },
    ],
  },
  {
    key: "tiktok", name: "TikTok", category: "social",
    icon: Share2, color: "bg-gray-800/10 text-gray-800 border-gray-300",
    description: "TikTok Business API for lead generation",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "advertiserId", label: "Advertiser ID", type: "text" },
    ],
  },
  {
    key: "youtube", name: "YouTube", category: "social",
    icon: Video, color: "bg-red-600/10 text-red-600 border-red-200",
    description: "YouTube Data API for channel management",
    fields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "channelId", label: "Channel ID", type: "text" },
    ],
  },
  {
    key: "vk", name: "VKontakte (VK)", category: "social",
    icon: Globe, color: "bg-blue-500/10 text-blue-600 border-blue-200",
    description: "VK API for Russian-speaking audience",
    fields: [
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "groupId", label: "Group ID", type: "text" },
      { key: "appSecret", label: "App Secret", type: "password" },
    ],
  },
  {
    key: "webhook_generic", name: "Custom Webhook", category: "thirdparty",
    icon: Webhook, color: "bg-orange-500/10 text-orange-600 border-orange-200",
    description: "Send or receive data via custom webhooks (Zapier, Make, n8n)",
    fields: [
      { key: "incomingUrl", label: "Incoming Webhook URL", type: "url", placeholder: "https://your-app.com/webhook" },
      { key: "outgoingUrl", label: "Outgoing Webhook URL", type: "url", placeholder: "https://hooks.zapier.com/..." },
      { key: "secret", label: "Webhook Secret", type: "password" },
    ],
  },
  {
    key: "google_sheets", name: "Google Sheets", category: "thirdparty",
    icon: Database, color: "bg-green-600/10 text-green-700 border-green-200",
    description: "Sync data with Google Sheets",
    fields: [
      { key: "serviceAccountJson", label: "Service Account JSON Key", type: "password", required: true },
      { key: "spreadsheetId", label: "Spreadsheet ID", type: "text" },
    ],
  },
  {
    key: "custom_api", name: "Custom API", category: "thirdparty",
    icon: Plug, color: "bg-violet-500/10 text-violet-600 border-violet-200",
    description: "Connect any REST API with custom endpoint and authentication",
    fields: [
      { key: "baseUrl", label: "Base URL", type: "url", placeholder: "https://api.example.com", required: true },
      { key: "apiKey", label: "API Key / Token", type: "password" },
      { key: "headerName", label: "Auth Header Name", type: "text", placeholder: "Authorization" },
      { key: "headerValue", label: "Auth Header Value", type: "password", placeholder: "Bearer ..." },
    ],
  },
];

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "communication", label: "Communication" },
  { key: "ai", label: "AI Services" },
  { key: "social", label: "Social Media" },
  { key: "thirdparty", label: "Third Party" },
];

export function IntegrationsManager() {
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<IntegrationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDef, setEditDef] = useState<IntegrationDef | null>(null);
  const [editConfig, setEditConfig] = useState<Record<string, any>>({});
  const [editEnabled, setEditEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchIntegrations();
  }, []);

  async function fetchIntegrations() {
    setLoading(true);
    try {
      const res = await customFetch("/api/integrations");
      setIntegrations((res as any)?.data || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  function getIntegrationData(key: string): IntegrationData | undefined {
    return integrations.find((i) => i.key === key);
  }

  function openEdit(def: IntegrationDef) {
    const existing = getIntegrationData(def.key);
    setEditDef(def);
    setEditConfig(existing?.config || {});
    setEditEnabled(existing?.isEnabled || false);
    setShowPasswords(new Set());
  }

  async function handleSave() {
    if (!editDef) return;
    setSaving(true);
    try {
      await customFetch(`/api/integrations/${editDef.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDef.name,
          category: editDef.category,
          isEnabled: editEnabled,
          config: editConfig,
        }),
      });
      toast({ title: `${editDef.name} settings saved` });
      setEditDef(null);
      fetchIntegrations();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(def: IntegrationDef) {
    const existing = getIntegrationData(def.key);
    if (!existing) {
      openEdit(def);
      return;
    }
    try {
      await customFetch(`/api/integrations/${def.key}/toggle`, { method: "PATCH" });
      fetchIntegrations();
    } catch {
      toast({ title: "Failed to toggle", variant: "destructive" });
    }
  }

  async function handleTest(key: string) {
    setTesting(key);
    try {
      const res = await customFetch(`/api/integrations/${key}/test`, { method: "POST" });
      toast({ title: (res as any)?.message || "Connection test passed" });
    } catch {
      toast({ title: "Connection test failed", variant: "destructive" });
    } finally {
      setTesting(null);
    }
  }

  function togglePasswordVisibility(fieldKey: string) {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey); else next.add(fieldKey);
      return next;
    });
  }

  const filtered = INTEGRATION_DEFS.filter((d) => {
    if (category !== "all" && d.category !== category) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase()) && !d.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" /> Integrations
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Connect external services, APIs, and third-party platforms.
            </p>
          </div>
          <Badge className="bg-primary/10 text-primary border-primary/20">
            {integrations.filter((i) => i.isEnabled).length} active
          </Badge>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search integrations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 rounded-xl"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  category === c.key
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "text-muted-foreground hover:bg-secondary border border-transparent"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((def) => {
              const data = getIntegrationData(def.key);
              const isActive = data?.isEnabled || false;
              const Icon = def.icon;

              return (
                <div
                  key={def.key}
                  className={`relative border rounded-xl p-4 transition-all hover:shadow-md ${
                    isActive ? "border-primary/30 bg-primary/5" : "border-border/50 hover:border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${def.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm text-foreground">{def.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{def.category}</p>
                      </div>
                    </div>
                    <Switch
                      checked={isActive}
                      onCheckedChange={() => handleToggle(def)}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{def.description}</p>

                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs rounded-lg gap-1 flex-1"
                      onClick={() => openEdit(def)}
                    >
                      <Key className="w-3 h-3" /> Configure
                    </Button>
                    {isActive && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs rounded-lg gap-1"
                        onClick={() => handleTest(def.key)}
                        disabled={testing === def.key}
                      >
                        {testing === def.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        Test
                      </Button>
                    )}
                  </div>

                  {isActive && (
                    <div className="absolute top-2 right-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!editDef} onOpenChange={(v) => { if (!v) setEditDef(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {editDef && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${editDef.color}`}>
                    <editDef.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p>{editDef.name}</p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{editDef.description}</p>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 border border-border/50">
                  <div>
                    <p className="text-sm font-medium">Enable Integration</p>
                    <p className="text-xs text-muted-foreground">Activate this integration for use in the system</p>
                  </div>
                  <Switch checked={editEnabled} onCheckedChange={setEditEnabled} />
                </div>

                {editDef.fields.map((field) => (
                  <div key={field.key}>
                    <Label className="text-xs flex items-center gap-1">
                      {field.label}
                      {field.required && <span className="text-red-500">*</span>}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        type={field.type === "password" && !showPasswords.has(field.key) ? "password" : field.type === "password" ? "text" : field.type}
                        placeholder={field.placeholder}
                        value={editConfig[field.key] || ""}
                        onChange={(e) => setEditConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="h-9 rounded-xl pr-10"
                      />
                      {field.type === "password" && (
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(field.key)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPasswords.has(field.key) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDef(null)} className="rounded-xl">
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-1.5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
