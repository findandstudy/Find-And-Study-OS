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
import { useI18n } from "@/hooks/use-i18n";
import {
  Mail, MessageCircle, Send, Bot, Plug, Key, Eye, EyeOff,
  Loader2, Check, X, ExternalLink, Search, Zap, Globe,
  Smartphone, Video, Share2, Webhook, Database, Shield, Copy, FormInput,
  Facebook, Instagram
} from "lucide-react";

interface IntegrationDef {
  key: string;
  name: string;
  category: string;
  icon: any;
  color: string;
  description: string;
  fields: FieldDef[];
  /** When set, name/description/field labels are resolved from i18n under `integrationsManager.<i18nKey>`. */
  i18nKey?: string;
  /** When true, the dialog renders the shared Meta webhook setup helper block. */
  metaWebhook?: boolean;
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
    description: "Send and receive WhatsApp via Meta Cloud API. Outbound is simulated outside production.",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", type: "text", required: true },
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "businessAccountId", label: "Business Account ID", type: "text" },
      { key: "appSecret", label: "App Secret (HMAC verification)", type: "password" },
      { key: "webhookVerifyToken", label: "Webhook Verify Token", type: "password" },
    ],
  },
  {
    key: "web_form", name: "Web Form (Lead Capture)", category: "communication",
    icon: FormInput, color: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
    description: "Embed a public form on your site that creates a conversation in your inbox.",
    fields: [
      { key: "formId", label: "Form ID (auto-generated)", type: "text" },
      { key: "secret", label: "Signing Secret (auto-generated)", type: "password" },
      { key: "redirectUrl", label: "After-submit Redirect URL", type: "url", placeholder: "https://yourcompany.com/thanks" },
    ],
  },
  {
    key: "facebook_messenger", name: "Facebook / Messenger", category: "communication",
    i18nKey: "facebook_messenger", metaWebhook: true,
    icon: Facebook, color: "bg-blue-600/10 text-blue-700 border-blue-200",
    description: "Receive and reply to Facebook Messenger conversations in your inbox via the Meta Graph API.",
    fields: [
      { key: "pageId", label: "Facebook Page ID", type: "text", required: true },
      { key: "pageAccessToken", label: "Page Access Token", type: "password", required: true },
      { key: "appSecret", label: "App Secret (HMAC verification)", type: "password" },
      { key: "webhookVerifyToken", label: "Webhook Verify Token", type: "password" },
    ],
  },
  {
    key: "instagram", name: "Instagram", category: "communication",
    i18nKey: "instagram", metaWebhook: true,
    icon: Instagram, color: "bg-pink-500/10 text-pink-600 border-pink-200",
    description: "Receive and reply to Instagram Direct Messages in your inbox via the Meta Graph API.",
    fields: [
      { key: "igBusinessAccountId", label: "Instagram Business Account ID", type: "text", required: true },
      { key: "pageId", label: "Linked Facebook Page ID", type: "text" },
      { key: "pageAccessToken", label: "Page Access Token", type: "password", required: true },
      { key: "appSecret", label: "App Secret (HMAC verification)", type: "password" },
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

const LIVE_GATED_KEYS = new Set(["whatsapp", "web_form", "facebook_messenger", "instagram"]);

export function IntegrationsManager() {
  const { toast } = useToast();
  const { t } = useI18n();
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
  const [liveMode, setLiveMode] = useState<{ live: boolean; reason: string } | null>(null);

  useEffect(() => {
    fetchIntegrations();
    customFetch("/api/integrations/live-mode")
      .then((r: any) => setLiveMode({ live: !!r?.live, reason: r?.reason || "" }))
      .catch(() => {});
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

  // Resolve display strings from i18n when the def opts in (i18nKey set),
  // falling back to the hard-coded English value when no translation exists.
  function defName(def: IntegrationDef): string {
    if (!def.i18nKey) return def.name;
    const key = `integrationsManager.${def.i18nKey}.name`;
    const v = t(key);
    return v === key ? def.name : v;
  }
  function defDesc(def: IntegrationDef): string {
    if (!def.i18nKey) return def.description;
    const key = `integrationsManager.${def.i18nKey}.description`;
    const v = t(key);
    return v === key ? def.description : v;
  }
  function fieldLabel(def: IntegrationDef, field: FieldDef): string {
    if (!def.i18nKey) return field.label;
    const key = `integrationsManager.${def.i18nKey}.fields.${field.key}`;
    const v = t(key);
    return v === key ? field.label : v;
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
    } catch (err: any) {
      const msg = err?.body?.message || err?.message || "Failed to save";
      toast({ title: msg, variant: "destructive" });
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
    if (LIVE_GATED_KEYS.has(def.key) && !existing.isEnabled && liveMode && !liveMode.live) {
      toast({ title: "Production-only", description: "This integration can only be enabled in production.", variant: "destructive" });
      return;
    }
    try {
      await customFetch(`/api/integrations/${def.key}/toggle`, { method: "PATCH" });
      fetchIntegrations();
    } catch (err: any) {
      const msg = err?.body?.message || err?.message || "Failed to toggle";
      toast({ title: msg, variant: "destructive" });
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copied` })).catch(() => {});
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
    if (search && !defName(d).toLowerCase().includes(search.toLowerCase()) && !defDesc(d).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {liveMode && !liveMode.live && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900">
          <Shield className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">Production-only integrations are simulated.</p>
            <p className="opacity-90 mt-0.5">
              WhatsApp Business and Web Form can only be enabled in production. Outbound calls run in simulated mode.
              Webhooks still work for testing. Set <code className="px-1 bg-amber-100 rounded">ALLOW_LIVE_INTEGRATIONS=true</code> to override.
            </p>
          </div>
        </div>
      )}
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
                        <p className="font-semibold text-sm text-foreground">{defName(def)}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{def.category}</p>
                      </div>
                    </div>
                    <Switch
                      checked={isActive}
                      onCheckedChange={() => handleToggle(def)}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mt-3 line-clamp-2">{defDesc(def)}</p>

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
                    <p>{defName(editDef)}</p>
                    <p className="text-xs text-muted-foreground font-normal mt-0.5">{defDesc(editDef)}</p>
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

                {LIVE_GATED_KEYS.has(editDef.key) && liveMode && !liveMode.live && (
                  <div className="text-xs p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
                    Settings can be saved (disabled) but enabling requires production.
                  </div>
                )}
                {editDef.fields.map((field) => (
                  <div key={field.key}>
                    <Label className="text-xs flex items-center gap-1">
                      {fieldLabel(editDef, field)}
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
                {editDef.key === "whatsapp" && (() => {
                  const callbackUrl = `${window.location.origin}/api/webhooks/whatsapp`;
                  const verifyToken = editConfig.webhookVerifyToken || "(set Webhook Verify Token above first)";
                  return (
                    <div className="space-y-2 p-3 rounded-xl bg-secondary/40 border border-border/50">
                      <p className="text-xs font-semibold">Meta Cloud API webhook setup</p>
                      <p className="text-[11px] text-muted-foreground">
                        In Meta &rarr; App Dashboard &rarr; WhatsApp &rarr; Configuration, paste the
                        <strong> Callback URL</strong> and <strong>Verify Token</strong> below, then
                        subscribe the <code>messages</code> field. Meta will GET this URL with
                        <code> hub.verify_token</code>; the handshake passes only if the token matches exactly.
                      </p>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Callback URL</Label>
                        <div className="flex items-center gap-1.5">
                          <Input readOnly value={callbackUrl} className="h-8 rounded-lg text-[11px] font-mono" />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-lg gap-1 shrink-0"
                            onClick={() => copyToClipboard(callbackUrl, "Callback URL")}
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </Button>
                        </div>
                        <Label className="text-[11px] mt-1.5">Verify Token (paste into Meta)</Label>
                        <div className="flex items-center gap-1.5">
                          <Input readOnly value={verifyToken} className="h-8 rounded-lg text-[11px] font-mono" />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-lg gap-1 shrink-0"
                            onClick={() => copyToClipboard(verifyToken, "Verify Token")}
                            disabled={!editConfig.webhookVerifyToken}
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-amber-700">
                        The App Secret is required separately for HMAC signature checks on every
                        inbound message. Both fields must be saved before the integration can be
                        enabled in production.
                      </p>
                    </div>
                  );
                })()}
                {editDef.metaWebhook && (() => {
                  const callbackUrl = `${window.location.origin}/api/webhooks/meta`;
                  const verifyToken = editConfig.webhookVerifyToken || t("integrationsManager.metaWebhook.verifyTokenPlaceholder");
                  return (
                    <div className="space-y-2 p-3 rounded-xl bg-secondary/40 border border-border/50">
                      <p className="text-xs font-semibold">{t("integrationsManager.metaWebhook.title")}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("integrationsManager.metaWebhook.instructions")}
                      </p>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">{t("integrationsManager.metaWebhook.callbackUrl")}</Label>
                        <div className="flex items-center gap-1.5">
                          <Input readOnly value={callbackUrl} className="h-8 rounded-lg text-[11px] font-mono" />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-lg gap-1 shrink-0"
                            onClick={() => copyToClipboard(callbackUrl, t("integrationsManager.metaWebhook.callbackUrl"))}
                          >
                            <Copy className="w-3 h-3" /> {t("integrationsManager.metaWebhook.copy")}
                          </Button>
                        </div>
                        <Label className="text-[11px] mt-1.5">{t("integrationsManager.metaWebhook.verifyTokenLabel")}</Label>
                        <div className="flex items-center gap-1.5">
                          <Input readOnly value={verifyToken} className="h-8 rounded-lg text-[11px] font-mono" />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs rounded-lg gap-1 shrink-0"
                            onClick={() => copyToClipboard(verifyToken, t("integrationsManager.metaWebhook.verifyTokenLabel"))}
                            disabled={!editConfig.webhookVerifyToken}
                          >
                            <Copy className="w-3 h-3" /> {t("integrationsManager.metaWebhook.copy")}
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-amber-700">
                        {t("integrationsManager.metaWebhook.appSecretNote")}
                      </p>
                    </div>
                  );
                })()}
                {editDef.key === "web_form" && editConfig.formId && (() => {
                  const secret = editConfig.secret || "YOUR_SECRET_TOKEN_HERE";
                  const endpoint = `${window.location.origin}/api/webhooks/web-form/${editConfig.formId}`;
                  const publicForm = `<!-- Public HTML form: posts to YOUR OWN backend, never to the webhook directly. -->\n<form action="https://your-site.example/lead" method="POST">\n  <input name="firstName" placeholder="First name" required />\n  <input name="lastName" placeholder="Last name" required />\n  <input name="email" type="email" placeholder="Email" />\n  <input name="phone" placeholder="Phone" />\n  <textarea name="message" placeholder="Message"></textarea>\n  <input type="hidden" name="agent_ref" value="" />\n  <button type="submit">Send</button>\n</form>`;
                  const serverForward = `# On YOUR server, forward the submission with the secret in a header.\n# Keep the token server-side only — never expose it in browser HTML.\ncurl -X POST "${endpoint}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Webform-Token: ${secret}" \\\n  -d '{"firstName":"Jane","lastName":"Doe","email":"jane@example.com","phone":"","message":"Hi","agent_ref":""}'`;
                  return (
                    <div className="space-y-2 p-3 rounded-xl bg-secondary/40 border border-border/50">
                      <p className="text-xs font-semibold">Integration snippet</p>
                      <p className="text-[11px] text-muted-foreground">
                        The secret must stay on your server. Never place it in public HTML — anyone
                        viewing the page could read it and forge submissions. Collect leads with a
                        public form that posts to your own backend, then forward them to the webhook
                        with the <code>X-Webform-Token</code> header (or an{" "}
                        <code>X-Webform-Signature</code> HMAC).
                      </p>
                      <p className="text-[11px] font-medium">1. Public form (no secret)</p>
                      <textarea
                        readOnly
                        className="w-full h-28 text-[10px] font-mono p-2 rounded-lg bg-background border border-border resize-none"
                        value={publicForm}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs rounded-lg gap-1"
                        onClick={() => copyToClipboard(publicForm, "Public form")}
                      >
                        <Copy className="w-3 h-3" /> Copy form
                      </Button>
                      <p className="text-[11px] font-medium pt-1">2. Server-to-server forward (secret in header)</p>
                      <textarea
                        readOnly
                        className="w-full h-28 text-[10px] font-mono p-2 rounded-lg bg-background border border-border resize-none"
                        value={serverForward}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs rounded-lg gap-1"
                        onClick={() => copyToClipboard(serverForward, "Forward example")}
                      >
                        <Copy className="w-3 h-3" /> Copy example
                      </Button>
                    </div>
                  );
                })()}
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
