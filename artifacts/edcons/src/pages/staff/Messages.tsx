import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Search, Send, MessageCircle, Plus, Users, Megaphone, Mail,
  MessageSquare, Smartphone, Hash, ArrowLeft, Paperclip, ChevronDown,
  FileText, Edit, Trash2, Copy, Check, X, Loader2, Eye, EyeOff, Globe, Download,
  Inbox as InboxIcon, AlertTriangle, UserCheck, Link2, Clock, FormInput, RefreshCw
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Conversation {
  id: number;
  type: string;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  participants: Array<{ userId: number; firstName: string; lastName: string; avatarUrl: string | null; role: string }>;
  unreadCount: number;
}

interface MessageAttachment {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}

interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  content: string;
  channel: string;
  status: string;
  createdAt: string;
  metadata?: { attachment?: MessageAttachment };
  senderFirstName: string | null;
  senderLastName: string | null;
  senderAvatarUrl: string | null;
  senderRole: string | null;
}

interface UserResult {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

const channelIcon: Record<string, any> = {
  internal: MessageSquare,
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
  sms: Smartphone,
  web_form: FormInput,
};

const channelColor: Record<string, string> = {
  internal: "bg-blue-500/10 text-blue-600",
  whatsapp: "bg-green-500/10 text-green-600",
  telegram: "bg-sky-500/10 text-sky-600",
  email: "bg-purple-500/10 text-purple-600",
  sms: "bg-amber-500/10 text-amber-600",
  web_form: "bg-indigo-500/10 text-indigo-600",
};

interface InboxConversation {
  id: number;
  type: string;
  title: string | null;
  channel: string;
  externalContactId: number | null;
  unmatched: boolean;
  status: string;
  assignedToId: number | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  externalContact: {
    id: number;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    leadId: number | null;
    studentId: number | null;
    agentId: number | null;
  } | null;
  assignedTo: { id: number; firstName: string; lastName: string } | null;
}

function LiveStatusIndicator({
  status,
  onReconnect,
}: {
  status: "connecting" | "open" | "offline";
  onReconnect: () => void;
}) {
  const config = {
    open: {
      label: "Live",
      tooltip: "Live — real-time updates active",
      dotClass: "bg-emerald-500",
      ringClass: "bg-emerald-500/30",
      textClass: "text-emerald-700",
      animate: false,
    },
    connecting: {
      label: "Reconnecting",
      tooltip: "Reconnecting…",
      dotClass: "bg-amber-500",
      ringClass: "bg-amber-500/40",
      textClass: "text-amber-700",
      animate: true,
    },
    offline: {
      label: "Offline",
      tooltip: "Offline — click to retry",
      dotClass: "bg-red-500",
      ringClass: "bg-red-500/30",
      textClass: "text-red-700",
      animate: false,
    },
  }[status];

  const isOffline = status === "offline";

  const content = (
    <button
      type="button"
      onClick={isOffline ? onReconnect : undefined}
      aria-label={config.tooltip}
      aria-disabled={!isOffline}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${config.textClass} border-current/20 ${
        isOffline ? "cursor-pointer hover:bg-red-500/10" : "cursor-default"
      }`}
    >
      <span className="relative flex h-2 w-2">
        {config.animate && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.ringClass}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.dotClass}`} />
      </span>
      <span>{config.label}</span>
      {isOffline && <RefreshCw className="w-3 h-3" />}
    </button>
  );

  return (
    <>
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {config.tooltip}
      </TooltipContent>
    </Tooltip>
    </>
  );
}

function InboxTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"mine" | "unassigned" | "unmatched" | "all">("mine");
  const [channel, setChannel] = useState<string>("all");
  const [convs, setConvs] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchSuggestions, setMatchSuggestions] = useState<any | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplId, setTplId] = useState<string>("");
  const [tplParams, setTplParams] = useState<string>("");
  const [liveStatus, setLiveStatus] = useState<"connecting" | "open" | "offline">("connecting");
  const [reconnectKey, setReconnectKey] = useState(0);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/inbox/conversations?tab=${tab}${channel !== "all" ? `&channel=${channel}` : ""}`;
      const res = await customFetch(url);
      setConvs((res as any)?.data || []);
    } catch {
      setConvs([]);
    } finally {
      setLoading(false);
    }
  }, [tab, channel]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const fetchDetail = useCallback(async (id: number) => {
    try {
      const res = await customFetch(`/api/inbox/conversations/${id}`);
      setDetail(res);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setDetail(null);
  }, [selectedId, fetchDetail]);

  // Live updates via Server-Sent Events. Refs let the long-lived EventSource
  // see the freshest selection / fetchers without churning the connection
  // every time the user switches tabs or opens a conversation.
  const selectedIdRef = useRef<number | null>(selectedId);
  const fetchInboxRef = useRef(fetchInbox);
  const fetchDetailRef = useRef(fetchDetail);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { fetchInboxRef.current = fetchInbox; }, [fetchInbox]);
  useEffect(() => { fetchDetailRef.current = fetchDetail; }, [fetchDetail]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    setLiveStatus("connecting");
    let failureCount = 0;
    const es = new EventSource("/api/inbox/events", { withCredentials: true });

    const refresh = (raw: MessageEvent) => {
      let convId: number | null = null;
      try {
        const payload = JSON.parse(raw.data || "{}");
        if (typeof payload.conversationId === "number") convId = payload.conversationId;
      } catch {
        // ignore malformed frames; still refresh the list as a safety net.
      }
      fetchInboxRef.current();
      if (convId !== null && selectedIdRef.current === convId) {
        fetchDetailRef.current(convId);
      }
    };

    es.onopen = () => {
      failureCount = 0;
      setLiveStatus("open");
    };

    es.onerror = () => {
      // The browser auto-reconnects EventSource while readyState is CONNECTING.
      // Give it a few attempts before declaring the stream offline and forcing
      // a manual retry, so a single proxy hiccup doesn't scare staff.
      if (es.readyState === EventSource.CLOSED) {
        setLiveStatus("offline");
        return;
      }
      failureCount += 1;
      if (failureCount >= 4) {
        es.close();
        setLiveStatus("offline");
      } else {
        setLiveStatus("connecting");
      }
    };

    es.addEventListener("inbox_message", refresh);
    es.addEventListener("inbox_assigned", refresh);

    return () => {
      es.removeEventListener("inbox_message", refresh);
      es.removeEventListener("inbox_assigned", refresh);
      es.close();
    };
  }, [reconnectKey]);

  const reconnectLive = useCallback(() => {
    setLiveStatus("connecting");
    setReconnectKey((k) => k + 1);
  }, []);

  async function loadSuggestions() {
    if (!selectedId) return;
    try {
      const r = await customFetch(`/api/inbox/conversations/${selectedId}/match-suggestions`);
      setMatchSuggestions(r);
      setMatchOpen(true);
    } catch {
      toast({ title: "Failed to load suggestions", variant: "destructive" });
    }
  }

  async function applyMatch(type: "lead" | "student" | "agent", entityId: number) {
    if (!selectedId) return;
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, entityId }),
      });
      toast({ title: "Linked" });
      setMatchOpen(false);
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: "Failed to link", variant: "destructive" });
    }
  }

  async function createNewLead() {
    if (!selectedId) return;
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/match/new-lead`, { method: "POST" });
      toast({ title: "New lead created" });
      setMatchOpen(false);
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: "Failed to create lead", variant: "destructive" });
    }
  }

  async function assignToMe() {
    if (!selectedId || !user) return;
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      toast({ title: "Assigned to you" });
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: "Failed to assign", variant: "destructive" });
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      const res: any = await customFetch(`/api/inbox/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply.trim() }),
      });
      if (res?.simulated) toast({ title: "Sent (simulated)", description: "Outbound is simulated outside production" });
      else toast({ title: "Sent" });
      setReply("");
      fetchDetail(selectedId);
    } catch (err: any) {
      const body = err?.body;
      if (body?.error === "outside_24h_window") {
        toast({ title: "Outside 24h window", description: "Use a template instead.", variant: "destructive" });
        await openTemplateDialog();
      } else {
        toast({ title: body?.error || "Failed to send", variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  }

  async function openTemplateDialog() {
    try {
      const r = await customFetch(`/api/messages/templates?channel=whatsapp`);
      setTemplates((r as any)?.data || []);
      setTplOpen(true);
    } catch {
      toast({ title: "Failed to load templates", variant: "destructive" });
    }
  }

  async function sendTemplate() {
    if (!selectedId || !tplId) return;
    try {
      const params = tplParams.split("|").map((s) => s.trim()).filter(Boolean);
      const res: any = await customFetch(`/api/inbox/conversations/${selectedId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: parseInt(tplId, 10), parameters: params }),
      });
      if (res?.simulated) toast({ title: "Template sent (simulated)" });
      else toast({ title: "Template sent" });
      setTplOpen(false);
      setTplId("");
      setTplParams("");
      fetchDetail(selectedId);
    } catch (err: any) {
      toast({ title: err?.body?.error || "Failed to send template", variant: "destructive" });
    }
  }

  const channelOptions = ["all", "whatsapp", "web_form", "email", "sms", "telegram"];
  const tabs: Array<{ key: typeof tab; label: string; icon: any }> = [
    { key: "mine", label: "Mine", icon: UserCheck },
    { key: "unassigned", label: "Unassigned", icon: InboxIcon },
    { key: "unmatched", label: "Unmatched", icon: AlertTriangle },
    { key: "all", label: "All", icon: Hash },
  ];

  const conv = detail?.conversation;
  const ext = detail?.externalContact;
  const linked = ext && (ext.leadId || ext.studentId || ext.agentId);
  const linkedLabel = ext?.leadId ? "Lead" : ext?.studentId ? "Student" : ext?.agentId ? "Agent" : null;
  const linkedHref =
    ext?.leadId ? `/staff/leads/${ext.leadId}` :
    ext?.studentId ? `/staff/students/${ext.studentId}` :
    ext?.agentId ? `/staff/agents/${ext.agentId}` : null;

  return (
    <>
    <Card className="border-none shadow-lg shadow-black/5 overflow-hidden" style={{ height: "calc(100vh - 220px)" }}>
      <div className="grid grid-cols-1 lg:grid-cols-12 h-full">
        <div className={`lg:col-span-4 border-r border-border/50 ${selectedId !== null ? "hidden lg:flex lg:flex-col" : "flex flex-col"}`}>
          <div className="p-3 border-b border-border/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <InboxIcon className="w-3.5 h-3.5" /> Inbox
              </div>
              <LiveStatusIndicator status={liveStatus} onReconnect={reconnectLive} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {tabs.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${tab === t.key ? "bg-primary/10 text-primary border border-primary/30" : "text-muted-foreground hover:bg-secondary border border-transparent"}`}
                  >
                    <Icon className="w-3 h-3" /> {t.label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 flex-wrap">
              {channelOptions.map((ch) => {
                const Icon = ch === "all" ? Hash : (channelIcon[ch] || MessageCircle);
                return (
                  <button
                    key={ch}
                    onClick={() => setChannel(ch)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${channel === ch ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50"}`}
                  >
                    <Icon className="w-3 h-3" /> {ch}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : convs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <InboxIcon className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">No conversations</p>
              </div>
            ) : convs.map((c) => {
              const Icon = channelIcon[c.channel] || MessageCircle;
              const isSel = c.id === selectedId;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 ${isSel ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-secondary/50"}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center ${channelColor[c.channel] || ""}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">
                        {c.externalContact?.displayName || c.title || "(unknown)"}
                      </p>
                      {c.unmatched && <Badge variant="outline" className="text-[9px] h-4 border-amber-300 text-amber-700 px-1">unmatched</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{c.lastMessagePreview || "—"}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`lg:col-span-8 flex flex-col ${selectedId === null ? "hidden lg:flex lg:items-center lg:justify-center" : ""}`}>
          {!selectedId ? (
            <div className="text-center text-muted-foreground">
              <InboxIcon className="w-16 h-16 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Select a conversation</p>
            </div>
          ) : !detail ? (
            <div className="flex items-center justify-center w-full h-full"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3">
                <Button size="icon" variant="ghost" className="lg:hidden" onClick={() => setSelectedId(null)}>
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{ext?.displayName || conv.title || "(unknown)"}</p>
                    <Badge variant="secondary" className={`text-[10px] ${channelColor[conv.channel] || ""}`}>{conv.channel}</Badge>
                    {linked && linkedHref && (
                      <button type="button" onClick={() => setLocation(linkedHref)}>
                        <Badge variant="outline" className="text-[10px] gap-1 cursor-pointer hover:bg-primary/10">
                          <Link2 className="w-3 h-3" /> {linkedLabel} #{ext.leadId || ext.studentId || ext.agentId}
                        </Badge>
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {ext?.phone || ext?.email || ""}
                    {conv.assignedTo ? ` • assigned to ${conv.assignedTo.firstName} ${conv.assignedTo.lastName}` : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {conv.assignedToId !== user?.id && (
                    <Button size="sm" variant="outline" onClick={assignToMe} className="h-7 text-xs gap-1">
                      <UserCheck className="w-3 h-3" /> Assign me
                    </Button>
                  )}
                </div>
              </div>

              {conv.unmatched && (
                <div className="m-3 p-3 rounded-lg border border-amber-300 bg-amber-50 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5" />
                  <div className="flex-1 text-xs text-amber-900">
                    <p className="font-semibold">Unmatched contact</p>
                    <p>This conversation isn't linked to a lead/student/agent yet.</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadSuggestions}>
                    Match
                  </Button>
                </div>
              )}

              {conv.channel === "whatsapp" && !detail.withinWindow && (
                <div className="m-3 p-3 rounded-lg border border-orange-300 bg-orange-50 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-700" />
                  <p className="text-xs text-orange-900 flex-1">Outside the 24h reply window. Use a template.</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openTemplateDialog}>Use template</Button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {(detail.messages || []).map((m: any) => {
                  const out = m.direction === "outbound";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        <div className={`text-[10px] mt-1 ${out ? "opacity-80" : "text-muted-foreground"}`}>
                          {new Date(m.createdAt).toLocaleString()}
                          {m.status === "failed" && <span className="ml-1 text-red-300">• failed</span>}
                          {m.metadata?.simulated && <span className="ml-1 opacity-80">• simulated</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border/50 p-3 flex items-end gap-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={conv.channel === "whatsapp" && !detail.withinWindow ? "Outside 24h — use a template" : "Reply..."}
                  rows={2}
                  className="flex-1 rounded-lg text-sm"
                  disabled={conv.channel === "whatsapp" && !detail.withinWindow}
                />
                {conv.channel === "whatsapp" && (
                  <Button size="sm" variant="outline" onClick={openTemplateDialog} className="h-9 gap-1">
                    <FileText className="w-3 h-3" /> Template
                  </Button>
                )}
                <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim() || (conv.channel === "whatsapp" && !detail.withinWindow)} className="h-9 gap-1">
                  {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Match contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {matchSuggestions?.outcome === "strong" && (
              <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded">Strong match found — confirm to link.</p>
            )}
            {matchSuggestions?.outcome === "ambiguous" && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">Multiple candidates — pick one.</p>
            )}
            {matchSuggestions?.outcome === "none" && (
              <p className="text-xs text-muted-foreground bg-secondary p-2 rounded">No matches — create a new lead.</p>
            )}
            {(matchSuggestions?.candidates || []).map((c: any, i: number) => (
              <div key={`${c.type}-${c.id}-${i}`} className="flex items-center justify-between p-2 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">{c.displayName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(unnamed)"} <Badge variant="outline" className="text-[9px] ml-1">{c.type}</Badge></p>
                  <p className="text-[11px] text-muted-foreground">{c.email || c.phone || ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => applyMatch(c.type, c.id)}>Link</Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchOpen(false)}>Cancel</Button>
            <Button onClick={createNewLead} className="gap-1"><Plus className="w-3 h-3" /> Create new lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-4 h-4" /> WhatsApp Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Template</Label>
              <Select value={tplId} onValueChange={setTplId}>
                <SelectTrigger className="h-9 rounded-lg"><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates
                    .filter((t) => t.externalTemplateName)
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.externalTemplateName} ({t.language || "en"})</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Parameters (pipe-separated)</Label>
              <Input value={tplParams} onChange={(e) => setTplParams(e.target.value)} placeholder="param1|param2|..." className="h-9 rounded-lg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button onClick={sendTemplate} disabled={!tplId} className="gap-1"><Send className="w-3 h-3" /> Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </>
  );
}

function ConversationList({
  conversations, selectedId, onSelect, onNewConversation, search, setSearch
}: {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNewConversation: () => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  const { user } = useAuth();

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Messages</h2>
          <Button size="sm" variant="outline" onClick={onNewConversation} className="h-8 gap-1.5 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..." className="pl-9 h-8 text-sm rounded-lg" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageCircle className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">No conversations yet</p>
          </div>
        ) : (
          conversations.map(conv => {
            const others = conv.participants.filter(p => p.userId !== user?.id);
            const displayName = conv.title || others.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Conversation";
            const initials = others[0] ? `${others[0].firstName?.[0] || ""}${others[0].lastName?.[0] || ""}` : "?";
            const avatarUrl = others[0]?.avatarUrl || null;
            const isSelected = conv.id === selectedId;

            return (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-secondary/50"}`}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} className="w-10 h-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center font-bold text-xs text-foreground shrink-0">
                    {initials}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm text-foreground truncate">{displayName}</p>
                    {conv.unreadCount > 0 && (
                      <Badge className="bg-primary text-white text-[10px] h-5 px-1.5 ml-2">{conv.unreadCount}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessagePreview || "No messages yet"}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    </>
  );
}

function MessageThread({
  conversationId, onBack
}: {
  conversationId: number;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [channel, setChannel] = useState("internal");
  const [sending, setSending] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await customFetch(`/api/conversations/${conversationId}/messages?limit=100`);
      setMessages((res as any)?.data || res || []);
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchMessages(),
      customFetch(`/api/conversations/${conversationId}/participants`).then((r: any) => setParticipants(r?.data || r || [])),
    ]).finally(() => setLoading(false));

    pollRef.current = setInterval(fetchMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [conversationId, fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const uploadFile = async (file: File): Promise<MessageAttachment | null> => {
    try {
      setUploading(true);
      const urlRes = await customFetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const { uploadURL, objectPath } = urlRes as any;
      const uploadResp = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadResp.ok) throw new Error("File upload failed");
      return {
        fileName: file.name,
        fileUrl: `/api/storage${objectPath}`,
        fileType: file.type,
        fileSize: file.size,
      };
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !pendingFile) || sending) return;
    setSending(true);
    try {
      let attachment: MessageAttachment | undefined;
      if (pendingFile) {
        const uploaded = await uploadFile(pendingFile);
        if (!uploaded) { setSending(false); return; }
        attachment = uploaded;
      }
      const metadata = attachment ? { attachment } : undefined;
      await customFetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMessage.trim() || "", channel, metadata }),
      });
      setNewMessage("");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchMessages();
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 25MB", variant: "destructive" });
      return;
    }
    setPendingFile(file);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (type: string) => type.startsWith("image/");

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      const downloadUrl = new URL(fileUrl, window.location.origin);
      downloadUrl.searchParams.set("download", fileName);
      const res = await fetch(downloadUrl.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast({ title: "Download failed", description: "Could not download the file.", variant: "destructive" });
    }
  };

  const others = participants.filter(p => p.userId !== user?.id);
  const threadTitle = others.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Conversation";

  const ChannelIcon = channelIcon[channel] || MessageSquare;

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50 flex items-center gap-3">
        <Button size="icon" variant="ghost" className="lg:hidden w-8 h-8" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{threadTitle}</p>
          <p className="text-xs text-muted-foreground">{participants.length} participants</p>
        </div>
        <Badge variant="secondary" className={`text-xs ${channelColor[channel] || ""}`}>
          <ChannelIcon className="w-3 h-3 mr-1" />
          {channel}
        </Badge>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map(msg => {
            const isMe = msg.senderId === user?.id;
            const initials = `${msg.senderFirstName?.[0] || ""}${msg.senderLastName?.[0] || ""}`;
            const att = (msg.metadata as any)?.attachment as MessageAttachment | undefined;
            const hasTextContent = msg.content && !msg.content.startsWith("\u{1F4CE}");
            return (
              <div key={msg.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                {!isMe && (
                  msg.senderAvatarUrl ? (
                    <img src={msg.senderAvatarUrl} alt={initials} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center text-xs font-bold shrink-0">
                      {initials}
                    </div>
                  )
                )}
                <div className={`max-w-[70%] ${isMe ? "items-end" : ""}`}>
                  {!isMe && (
                    <p className="text-xs text-muted-foreground mb-1">{msg.senderFirstName} {msg.senderLastName}</p>
                  )}
                  <div className={`rounded-2xl px-4 py-2.5 ${isMe ? "bg-primary text-white rounded-tr-sm" : "bg-secondary rounded-tl-sm"}`}>
                    {att && isImage(att.fileType) && (
                      <div className="mb-1 group/att relative">
                        <img src={att.fileUrl} alt={att.fileName} className="max-w-full max-h-48 rounded-lg object-cover" />
                        <button
                          onClick={() => handleDownload(att.fileUrl, att.fileName)}
                          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity hover:bg-black/70"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {att && !isImage(att.fileType) && (
                      <button
                        onClick={() => handleDownload(att.fileUrl, att.fileName)}
                        className={`flex items-center gap-2 p-2 rounded-lg mb-1 w-full text-left ${isMe ? "bg-white/10 hover:bg-white/20" : "bg-background hover:bg-background/80"} transition-colors`}
                      >
                        <FileText className="w-5 h-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{att.fileName}</p>
                          <p className={`text-[10px] ${isMe ? "text-white/60" : "text-muted-foreground"}`}>{formatFileSize(att.fileSize)}</p>
                        </div>
                        <Download className={`w-4 h-4 shrink-0 ${isMe ? "text-white/60" : "text-muted-foreground"}`} />
                      </button>
                    )}
                    {hasTextContent && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                  </div>
                  <p className={`text-[10px] text-muted-foreground mt-1 ${isMe ? "text-right" : ""}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {msg.channel !== "internal" && (
                      <span className="ml-1.5 opacity-70">via {msg.channel}</span>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-border/50">
        <div className="flex gap-2 mb-2">
          {Object.entries(channelIcon).map(([ch, Icon]) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${channel === ch ? channelColor[ch] + " ring-1 ring-current" : "text-muted-foreground hover:bg-secondary"}`}
            >
              <Icon className="w-3 h-3" />
              <span className="capitalize hidden sm:inline">{ch}</span>
            </button>
          ))}
        </div>
        {pendingFile && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-secondary/50 text-sm">
            <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate flex-1">{pendingFile.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(pendingFile.size)}</span>
            <button onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading}
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-xl"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          />
          <Button onClick={sendMessage} disabled={sending || uploading || (!newMessage.trim() && !pendingFile)} className="rounded-xl gap-1.5">
            {(sending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}

function BroadcastTab() {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [channel, setChannel] = useState("internal");
  const [targetAudience, setTargetAudience] = useState("all");
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const availableRoles = [
    { value: "super_admin", label: "Super Admin" }, { value: "admin", label: "Admin" },
    { value: "manager", label: "Manager" }, { value: "staff", label: "Staff" },
    { value: "consultant", label: "Consultant" }, { value: "accountant", label: "Accountant" },
    { value: "student", label: "Student" }, { value: "agent", label: "Agent" },
    { value: "sub_agent", label: "Sub Agent" },
  ];

  useEffect(() => {
    customFetch("/api/broadcasts").then((r: any) => {
      setBroadcasts(r?.data || r || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const sendBroadcast = async () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: "Title and message are required", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await customFetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          channel,
          targetAudience,
          targetRoles: targetAudience === "role" ? targetRoles : [],
        }),
      });
      toast({ title: `Broadcast sent to ${(res as any).recipientCount} users` });
      setTitle("");
      setContent("");
      setBroadcasts(prev => [res as any, ...prev]);
    } catch (err: any) {
      toast({ title: "Failed to send broadcast", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const toggleRole = (role: string) => {
    setTargetRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  return (
    <>
    <div className="space-y-6">
      <Card className="p-6 border-none shadow-lg shadow-black/5">
        <h3 className="font-semibold text-foreground flex items-center gap-2 mb-4">
          <Megaphone className="w-5 h-5 text-primary" /> New Broadcast
        </h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Broadcast title..." className="rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write your broadcast message..." rows={4} className="rounded-xl" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal (In-App)</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target Audience</Label>
              <Select value={targetAudience} onValueChange={setTargetAudience}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Active Users</SelectItem>
                  <SelectItem value="role">Specific Roles</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {targetAudience === "role" && (
            <div className="space-y-2">
              <Label>Select Roles</Label>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map(r => (
                  <button key={r.value} onClick={() => toggleRole(r.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${targetRoles.includes(r.value) ? "bg-primary text-white" : "bg-secondary hover:bg-secondary/80 text-foreground"}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Button onClick={sendBroadcast} disabled={sending} className="rounded-xl gap-2">
            <Send className="w-4 h-4" /> {sending ? "Sending..." : "Send Broadcast"}
          </Button>
        </div>
      </Card>

      <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50">
          <h3 className="font-semibold text-foreground">Broadcast History</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></div>
        ) : broadcasts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No broadcasts sent yet</div>
        ) : (
          <div className="divide-y divide-border/50">
            {broadcasts.map((b: any) => {
              const ChIcon = channelIcon[b.channel] || MessageSquare;
              return (
                <div key={b.id} className="px-6 py-4 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground">{b.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.content}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className={`text-[10px] ${channelColor[b.channel] || ""}`}>
                        <ChIcon className="w-3 h-3 mr-1" />{b.channel}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        <Users className="w-3 h-3 mr-1" />{b.recipientCount}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Sent by {b.senderFirstName} {b.senderLastName} • {new Date(b.sentAt || b.createdAt).toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
    </>
  );
}

const TEMPLATE_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "welcome", label: "Welcome" },
  { value: "follow_up", label: "Follow Up" },
  { value: "application", label: "Application" },
  { value: "visa", label: "Visa" },
  { value: "payment", label: "Payment" },
  { value: "offer", label: "Offer" },
  { value: "rejection", label: "Rejection" },
  { value: "reminder", label: "Reminder" },
  { value: "agent", label: "Agent" },
];

const TEMPLATE_CHANNELS = [
  { value: "all", label: "All Channels" },
  { value: "internal", label: "Internal" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "sms", label: "SMS" },
];

const TEMPLATE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" },
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "zh", label: "中文" },
];

interface Template {
  id: number;
  name: string;
  category: string;
  subject: string | null;
  content: string;
  channel: string;
  language: string;
  variables: string[];
  isActive: boolean;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
  creatorFirstName: string | null;
  creatorLastName: string | null;
}

function TemplatesTab() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formSubject, setFormSubject] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formChannel, setFormChannel] = useState("all");
  const [formLanguage, setFormLanguage] = useState("en");

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await customFetch("/api/message-templates");
      setTemplates((res as any)?.data || []);
    } catch {
      toast({ title: "Failed to load templates", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  function openNew() {
    setEditingTemplate(null);
    setFormName("");
    setFormCategory("general");
    setFormSubject("");
    setFormContent("");
    setFormChannel("all");
    setFormLanguage("en");
    setEditOpen(true);
  }

  function openEdit(t: Template) {
    setEditingTemplate(t);
    setFormName(t.name);
    setFormCategory(t.category);
    setFormSubject(t.subject || "");
    setFormContent(t.content);
    setFormChannel(t.channel);
    setFormLanguage(t.language);
    setEditOpen(true);
  }

  async function saveTemplate() {
    if (!formName.trim() || !formContent.trim()) {
      toast({ title: "Name and content are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        category: formCategory,
        subject: formSubject.trim() || null,
        content: formContent.trim(),
        channel: formChannel,
        language: formLanguage,
      };

      if (editingTemplate) {
        const res = await customFetch(`/api/message-templates/${editingTemplate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? { ...t, ...(res as any) } : t));
        toast({ title: "Template updated" });
      } else {
        const res = await customFetch("/api/message-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        fetchTemplates();
        toast({ title: "Template created" });
      }
      setEditOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: number) {
    try {
      await customFetch(`/api/message-templates/${id}`, { method: "DELETE" });
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: "Template deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    }
    setDeleteConfirm(null);
  }

  async function toggleActive(t: Template) {
    try {
      await customFetch(`/api/message-templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      setTemplates(prev => prev.map(x => x.id === t.id ? { ...x, isActive: !x.isActive } : x));
    } catch {
      toast({ title: "Failed to update template", variant: "destructive" });
    }
  }

  function copyContent(content: string) {
    navigator.clipboard.writeText(content);
    toast({ title: "Template content copied to clipboard" });
  }

  const filtered = templates.filter(t => {
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    if (searchTerm && !t.name.toLowerCase().includes(searchTerm.toLowerCase()) && !t.content.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const grouped = filtered.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] = acc[t.category] || []).push(t);
    return acc;
  }, {});

  const channelBadge = (ch: string) => {
    const colors: Record<string, string> = {
      all: "bg-gray-500/10 text-gray-600",
      internal: "bg-blue-500/10 text-blue-600",
      email: "bg-purple-500/10 text-purple-600",
      whatsapp: "bg-green-500/10 text-green-600",
      telegram: "bg-sky-500/10 text-sky-600",
      sms: "bg-amber-500/10 text-amber-600",
    };
    return colors[ch] || colors.all;
  };

  return (
    <>
    <div className="space-y-4">
      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Message Templates
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create and manage reusable message templates for quick communication.
            </p>
          </div>
          <Button onClick={openNew} className="rounded-xl gap-2">
            <Plus className="w-4 h-4" /> New Template
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search templates..."
              className="pl-9 rounded-xl"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full sm:w-48 rounded-xl">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {TEMPLATE_CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="w-12 h-12 mb-3 opacity-20" />
            <p className="font-medium">No templates found</p>
            <p className="text-sm mt-1">Create your first template to get started</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([cat, catTemplates]) => {
              const catLabel = TEMPLATE_CATEGORIES.find(c => c.value === cat)?.label || cat;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{catLabel}</h4>
                    <Badge variant="secondary" className="text-[10px] h-5">{catTemplates.length}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {catTemplates.map(t => (
                      <div
                        key={t.id}
                        className={`border rounded-xl p-4 transition-all hover:shadow-md ${!t.isActive ? "opacity-50 bg-secondary/30" : "bg-card hover:border-primary/30"}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-foreground truncate">{t.name}</p>
                            {t.subject && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">Subject: {t.subject}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="secondary" className={`text-[10px] h-5 ${channelBadge(t.channel)}`}>
                              {TEMPLATE_CHANNELS.find(c => c.value === t.channel)?.label || t.channel}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] h-5 gap-0.5">
                              <Globe className="w-2.5 h-2.5" />
                              {t.language.toUpperCase()}
                            </Badge>
                          </div>
                        </div>

                        <div className="relative mb-3">
                          {previewId === t.id ? (
                            <div className="bg-secondary/50 rounded-lg p-3 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
                              {t.content}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground line-clamp-2">{t.content}</p>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-muted-foreground">
                            {t.creatorFirstName && `by ${t.creatorFirstName} ${t.creatorLastName}`}
                            {t.updatedAt && ` • ${new Date(t.updatedAt).toLocaleDateString()}`}
                          </p>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setPreviewId(previewId === t.id ? null : t.id)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title={previewId === t.id ? "Collapse" : "Preview"}
                            >
                              {previewId === t.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => copyContent(t.content)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title="Copy content"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openEdit(t)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title="Edit"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => toggleActive(t)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title={t.isActive ? "Deactivate" : "Activate"}
                            >
                              {t.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            {deleteConfirm === t.id ? (
                              <div className="flex items-center gap-1">
                                <button onClick={() => deleteTemplate(t.id)} className="p-1.5 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors" title="Confirm delete">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteConfirm(null)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title="Cancel">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(t.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-600"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              {editingTemplate ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Welcome Email" className="rounded-xl" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={formChannel} onValueChange={setFormChannel}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CHANNELS.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={formLanguage} onValueChange={setFormLanguage}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_LANGUAGES.map(l => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(formChannel === "email" || formChannel === "all") && (
              <div className="space-y-2">
                <Label>Subject Line</Label>
                <Input value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder="Email subject..." className="rounded-xl" />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Content *</Label>
                <p className="text-[10px] text-muted-foreground">
                  Use {"{{variable}}"} for dynamic placeholders, e.g. {"{{studentName}}"}, {"{{programName}}"}
                </p>
              </div>
              <Textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                placeholder="Write your template content here..."
                rows={8}
                className="rounded-xl font-mono text-sm"
              />
            </div>

            {formContent && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <div className="bg-secondary/50 rounded-xl p-4 text-sm whitespace-pre-wrap border border-border/50">
                  {formContent}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={saveTemplate} disabled={saving} className="rounded-xl gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? "Saving..." : editingTemplate ? "Update Template" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

const BROADCAST_ROLES = ["super_admin", "admin", "manager"];

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserResult[]>([]);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth(true);
  const canBroadcast = BROADCAST_ROLES.includes(user?.role || "");

  const fetchConversations = useCallback(async () => {
    try {
      const res = await customFetch(`/api/conversations${search ? `?search=${search}` : ""}`);
      setConversations((res as any)?.data || res || []);
    } catch {}
  }, [search]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  useEffect(() => {
    if (userSearch.length < 2) { setUserResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await customFetch(`/api/users-search?search=${userSearch}&limit=10`);
        setUserResults((res as any)?.data || res || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  const createConversation = async () => {
    if (selectedUsers.length === 0) {
      toast({ title: "Select at least one user", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const type = selectedUsers.length > 1 ? "group" : "direct";
      const res = await customFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          participantIds: selectedUsers.map(u => u.id),
          title: type === "group" ? selectedUsers.map(u => u.firstName).join(", ") : undefined,
        }),
      });
      setNewConvOpen(false);
      setSelectedUsers([]);
      setUserSearch("");
      fetchConversations();
      setSelectedConv((res as any).id);
    } catch (err: any) {
      toast({ title: "Failed to create conversation", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const toggleUserSelect = (user: UserResult) => {
    setSelectedUsers(prev =>
      prev.find(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  return (
    <>
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground">Communication Center</h1>

        <Tabs defaultValue="inbox" className="space-y-4">
          <TabsList className="h-10">
            <TabsTrigger value="inbox" className="gap-2 px-4">
              <InboxIcon className="w-4 h-4" /> Inbox
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-2 px-4">
              <MessageCircle className="w-4 h-4" /> Internal
            </TabsTrigger>
            {canBroadcast && (
              <TabsTrigger value="broadcast" className="gap-2 px-4">
                <Megaphone className="w-4 h-4" /> Broadcast
              </TabsTrigger>
            )}
            <TabsTrigger value="templates" className="gap-2 px-4">
              <FileText className="w-4 h-4" /> Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inbox">
            <InboxTab />
          </TabsContent>

          <TabsContent value="messages">
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden" style={{ height: "calc(100vh - 220px)" }}>
              <div className="grid grid-cols-1 lg:grid-cols-12 h-full">
                <div className={`lg:col-span-4 border-r border-border/50 ${selectedConv !== null ? "hidden lg:block" : ""}`}>
                  <ConversationList
                    conversations={conversations}
                    selectedId={selectedConv}
                    onSelect={setSelectedConv}
                    onNewConversation={() => setNewConvOpen(true)}
                    search={search}
                    setSearch={setSearch}
                  />
                </div>
                <div className={`lg:col-span-8 ${selectedConv === null ? "hidden lg:flex lg:items-center lg:justify-center" : ""}`}>
                  {selectedConv === null ? (
                    <div className="text-center text-muted-foreground">
                      <MessageCircle className="w-16 h-16 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">Select a conversation</p>
                      <p className="text-sm mt-1">Or start a new one</p>
                    </div>
                  ) : (
                    <MessageThread conversationId={selectedConv} onBack={() => setSelectedConv(null)} />
                  )}
                </div>
              </div>
            </Card>
          </TabsContent>

          {canBroadcast && (
            <TabsContent value="broadcast">
              <BroadcastTab />
            </TabsContent>
          )}

          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={newConvOpen} onOpenChange={setNewConvOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" /> New Conversation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Search Users</Label>
              <Input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder="Type to search..." className="rounded-xl" />
            </div>
            {userResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-xl p-2">
                {userResults.map(u => {
                  const selected = selectedUsers.find(s => s.id === u.id);
                  return (
                    <div key={u.id} onClick={() => toggleUserSelect(u)}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${selected ? "bg-primary/10" : "hover:bg-secondary"}`}>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center text-xs font-bold">
                        {u.firstName?.[0]}{u.lastName?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-muted-foreground">{u.email} • {u.role}</p>
                      </div>
                      {selected && <Badge className="bg-primary text-white text-[10px] h-5">Selected</Badge>}
                    </div>
                  );
                })}
              </div>
            )}
            {selectedUsers.length > 0 && (
              <div className="space-y-2">
                <Label>Selected ({selectedUsers.length})</Label>
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map(u => (
                    <Badge key={u.id} variant="secondary" className="gap-1 cursor-pointer hover:bg-destructive/10" onClick={() => toggleUserSelect(u)}>
                      {u.firstName} {u.lastName} ×
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewConvOpen(false)}>Cancel</Button>
            <Button onClick={createConversation} disabled={creating || selectedUsers.length === 0}>
              {creating ? "Creating..." : "Start Conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
