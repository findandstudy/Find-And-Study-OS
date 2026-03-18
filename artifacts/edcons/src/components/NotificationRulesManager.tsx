import { useState, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Mail, MessageCircle, Send, Smartphone, Check, X,
  Loader2, ChevronDown, ChevronRight, Settings2
} from "lucide-react";

interface NotificationRule {
  id: number;
  event: string;
  name: string;
  description?: string;
  category: string;
  channels: string[];
  recipientType: string;
  recipientRoles: string[];
  isActive: boolean;
}

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  in_app: { label: "In-App", icon: Bell, color: "bg-blue-500/10 text-blue-600 border-blue-200" },
  email: { label: "Email", icon: Mail, color: "bg-green-500/10 text-green-600 border-green-200" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  telegram: { label: "Telegram", icon: Send, color: "bg-sky-500/10 text-sky-600 border-sky-200" },
  sms: { label: "SMS", icon: Smartphone, color: "bg-purple-500/10 text-purple-600 border-purple-200" },
};

const CATEGORY_LABELS: Record<string, string> = {
  leads: "Leads", applications: "Applications", students: "Students",
  finance: "Finance", agents: "Agents", system: "System", messages: "Messages",
};

const RECIPIENT_LABELS: Record<string, string> = {
  role: "By Role", assigned: "Assigned Staff", owner: "Record Owner",
  specific: "Specific User", all: "All Users",
};

interface Props {
  isAdmin: boolean;
  notifications: Record<string, boolean>;
  setNotifications: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function NotificationRulesManager({ isAdmin, notifications, setNotifications }: Props) {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    if (isAdmin) fetchRules();
  }, [isAdmin]);

  async function fetchRules() {
    setLoading(true);
    try {
      const res = await customFetch("/api/notification-rules");
      setRules((res as any)?.data || []);
      const cats = new Set<string>();
      ((res as any)?.data || []).forEach((r: NotificationRule) => cats.add(r.category));
      setExpandedCategories(cats);
    } catch {
      toast({ title: "Failed to load notification rules", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function toggleChannel(rule: NotificationRule, channel: string) {
    const has = rule.channels.includes(channel);
    const newChannels = has
      ? rule.channels.filter(c => c !== channel)
      : [...rule.channels, channel];

    setSaving(rule.id);
    try {
      const updated = await customFetch(`/api/notification-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: newChannels }),
      });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, channels: newChannels } : r));
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  async function toggleActive(rule: NotificationRule) {
    setSaving(rule.id);
    try {
      await customFetch(`/api/notification-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  function toggleCategory(cat: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const grouped = rules.reduce<Record<string, NotificationRule[]>>((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r);
    return acc;
  }, {});

  const personalPrefs = [
    { key: "newLeads", label: "New Leads", desc: "Notify when a new lead is created or assigned" },
    { key: "applicationUpdates", label: "Application Updates", desc: "Notify when application stage changes" },
    { key: "documentAlerts", label: "Document Alerts", desc: "Notify when documents are uploaded or need review" },
    { key: "financeAlerts", label: "Finance Alerts", desc: "Notify for new invoices and overdue payments" },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <h2 className="font-display font-bold text-lg mb-6">Personal Notification Preferences</h2>
        <div className="space-y-3">
          {personalPrefs.map(n => (
            <div key={n.key} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-primary/30 transition-colors">
              <div>
                <p className="font-semibold text-foreground">{n.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{n.desc}</p>
              </div>
              <button
                onClick={() => setNotifications(prev => ({ ...prev, [n.key]: !prev[n.key as keyof typeof prev] }))}
                className={`relative w-12 h-6 rounded-full transition-all ${notifications[n.key as keyof typeof notifications] ? "bg-primary" : "bg-secondary border-2 border-border"}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${notifications[n.key as keyof typeof notifications] ? "translate-x-6" : ""}`} />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {isAdmin && (
        <Card className="border-none shadow-lg shadow-black/5 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-bold text-lg flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-primary" />
                System Notification Rules
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure which channels are used for each system event and who receives them.
              </p>
            </div>
            <Badge className="bg-primary/10 text-primary border-primary/20">
              {rules.length} rules
            </Badge>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([cat, catRules]) => (
                <div key={cat} className="border border-border/50 rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center justify-between p-4 bg-secondary/30 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {expandedCategories.has(cat) ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="font-display font-bold text-sm uppercase tracking-wider text-foreground">
                        {CATEGORY_LABELS[cat] || cat}
                      </span>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {catRules.filter(r => r.isActive).length}/{catRules.length} active
                    </Badge>
                  </button>

                  {expandedCategories.has(cat) && (
                    <div className="divide-y divide-border/30">
                      {catRules.map(rule => (
                        <div key={rule.id} className={`p-4 transition-colors ${!rule.isActive ? "opacity-50" : ""}`}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-sm text-foreground">{rule.name}</p>
                                <Badge variant="outline" className="text-[10px] font-mono px-1.5">
                                  {rule.event}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mb-3">
                                Recipients: {RECIPIENT_LABELS[rule.recipientType] || rule.recipientType}
                                {rule.recipientRoles?.length > 0 && (
                                  <span className="ml-1">
                                    ({rule.recipientRoles.join(", ")})
                                  </span>
                                )}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(CHANNEL_META).map(([ch, meta]) => {
                                  const Icon = meta.icon;
                                  const active = rule.channels.includes(ch);
                                  return (
                                    <button
                                      key={ch}
                                      onClick={() => toggleChannel(rule, ch)}
                                      disabled={saving === rule.id || !rule.isActive}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                                        active
                                          ? meta.color
                                          : "bg-secondary/30 text-muted-foreground border-border/50 hover:border-border"
                                      }`}
                                    >
                                      <Icon className="w-3 h-3" />
                                      {meta.label}
                                      {active && <Check className="w-3 h-3 ml-0.5" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <button
                              onClick={() => toggleActive(rule)}
                              disabled={saving === rule.id}
                              className={`relative w-10 h-5 rounded-full transition-all shrink-0 mt-1 ${
                                rule.isActive ? "bg-primary" : "bg-secondary border border-border"
                              }`}
                            >
                              {saving === rule.id ? (
                                <Loader2 className="w-3 h-3 animate-spin absolute top-1 left-3.5" />
                              ) : (
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                                  rule.isActive ? "translate-x-5" : ""
                                }`} />
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
