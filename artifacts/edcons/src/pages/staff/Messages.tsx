import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useEntityViewTracker } from "@/hooks/use-entity-view-tracker";
import {
  customFetch,
  useSummarizeInboxConversation,
  useAddInboxConversationNote,
  useAddInboxConversationTask,
  type InboxConversationDetailResponse,
  type ConversationAiSummary,
} from "@workspace/api-client-react";
import { LeadDetailSidebar } from "@/components/inbox/LeadDetailSidebar";
import { AiSummaryCard } from "@/components/inbox/AiSummaryCard";
import {
  ChatNoteTaskTabs,
  type ComposeTab,
  type TaskDraft,
} from "@/components/inbox/ChatNoteTaskTabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Search, Send, MessageCircle, Plus, Users, Megaphone, Mail,
  MessageSquare, Smartphone, Hash, ArrowLeft, Paperclip, ChevronDown, Star, Bell,
  FileText, Edit, Trash2, Copy, Check, CheckCheck, X, Loader2, Eye, EyeOff, Globe, Download,
  Inbox as InboxIcon, AlertTriangle, UserCheck, Link2, Clock, FormInput, RefreshCw, Info, Filter, Bot,
  Facebook, Instagram, Archive, ArchiveRestore, ArrowDown, ArrowUpDown, ListChecks, FlaskConical,
  UserPlus, FilePlus2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useI18n } from "@/hooks/use-i18n";
import { AddStudentModal } from "@/components/AddStudentModal";
import { AddAsDocumentModal, type AddDocTarget } from "@/components/inbox/AddAsDocumentModal";

interface Conversation {
  id: number;
  type: string;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  participants: Array<{ userId: number; firstName: string; lastName: string; avatarUrl: string | null; role: string; lastReadAt?: string | null }>;
  unreadCount: number;
  readReceiptsEnabled?: boolean;
}

interface MessageAttachment {
  fileName?: string;
  fileUrl?: string;
  fileType?: string;
  fileSize?: number;
  url?: string;
  type?: string;
  name?: string;
}

interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  content: string;
  channel: string;
  status: string;
  direction?: string;
  createdAt: string;
  metadata?: { attachment?: MessageAttachment; attachments?: MessageAttachment[] };
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
  messenger: Facebook,
  instagram: Instagram,
};

const channelColor: Record<string, string> = {
  internal: "bg-blue-500/10 text-blue-600",
  whatsapp: "bg-green-500/10 text-green-600",
  telegram: "bg-sky-500/10 text-sky-600",
  email: "bg-purple-500/10 text-purple-600",
  sms: "bg-amber-500/10 text-amber-600",
  web_form: "bg-indigo-500/10 text-indigo-600",
  messenger: "bg-blue-600/10 text-blue-700",
  instagram: "bg-pink-500/10 text-pink-600",
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
  botEnabled?: boolean;
  needsHuman?: boolean;
  externalContact: {
    id: number;
    displayName: string | null;
    phone: string | null;
    email: string | null;
    leadId: number | null;
    studentId: number | null;
    agentId: number | null;
  } | null;
  assignedTo: { id: number; firstName: string; lastName: string; avatarUrl: string | null } | null;
  isStarred?: boolean;
  isSubscribed?: boolean;
}

// If no event/heartbeat arrives within this window, the indicator switches
// from "Live" (green) to "Stalled" (amber) even though the EventSource is
// still technically open. Heartbeats fire every 25s, so 60s gives a 2x+
// safety margin before alerting staff.
const STALE_AFTER_MS = 60_000;

function formatLastUpdate(lastEventAt: number | null, now: number): string {
  if (!lastEventAt) return "no updates received yet";
  const diffMs = Math.max(0, now - lastEventAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "last update just now";
  if (seconds < 60) return `last update ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `last update ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `last update ${hours}h ago`;
}

function LiveStatusIndicator({
  status,
  lastEventAt,
  now,
  onReconnect,
}: {
  status: "connecting" | "open" | "offline" | "stale";
  lastEventAt: number | null;
  now: number;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  const config = {
    open: {
      label: t("messagesPage.live"),
      dotClass: "bg-emerald-500",
      ringClass: "bg-emerald-500/30",
      textClass: "text-emerald-700",
      animate: false,
    },
    connecting: {
      label: t("messagesPage.reconnecting"),
      dotClass: "bg-amber-500",
      ringClass: "bg-amber-500/40",
      textClass: "text-amber-700",
      animate: true,
    },
    stale: {
      label: t("messagesPage.stalled"),
      dotClass: "bg-amber-500",
      ringClass: "bg-amber-500/40",
      textClass: "text-amber-700",
      animate: true,
    },
    offline: {
      label: t("messagesPage.offline"),
      dotClass: "bg-red-500",
      ringClass: "bg-red-500/30",
      textClass: "text-red-700",
      animate: false,
    },
  }[status];

  const lastUpdateText = formatLastUpdate(lastEventAt, now);
  const tooltip = (() => {
    if (status === "open") return `Live · ${lastUpdateText}`;
    if (status === "stale") return `Stalled · ${lastUpdateText} — stream may be stuck`;
    if (status === "connecting") return `Reconnecting… · ${lastUpdateText}`;
    return "Offline — click to retry";
  })();

  const isOffline = status === "offline";

  const content = (
    <button
      type="button"
      onClick={isOffline ? onReconnect : undefined}
      aria-label={tooltip}
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
        {tooltip}
      </TooltipContent>
    </Tooltip>
    </>
  );
}

function InboxTab() {
  const { t, isRTL } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"mine" | "unassigned" | "unmatched" | "all" | "open" | "unanswered" | "subscribed" | "starred" | "archived">("mine");
  const [assignedNotice, setAssignedNotice] = useState(false);
  const [channel, setChannel] = useState<string>("all");
  const [convs, setConvs] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InboxConversationDetailResponse | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [composeTab, setComposeTab] = useState<ComposeTab>("chat");
  const [noteDraft, setNoteDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    title: "",
    scheduledAt: "",
    notes: "",
  });
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchSuggestions, setMatchSuggestions] = useState<any | null>(null);
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false);
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [createLeadLoading, setCreateLeadLoading] = useState(false);
  const [createLeadSubmitting, setCreateLeadSubmitting] = useState(false);
  const [createLeadForm, setCreateLeadForm] = useState({ fullName: "", email: "", phone: "" });
  const [createLeadAiFields, setCreateLeadAiFields] = useState<Set<string>>(new Set());
  const [createLeadDuplicate, setCreateLeadDuplicate] = useState<null | { id: number; firstName: string; lastName: string; email: string | null; phone: string | null; status: string }>(null);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [addStudentPrefill, setAddStudentPrefill] = useState<{ firstName?: string; lastName?: string; email?: string; phone?: string }>({});
  const [tplOpen, setTplOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tplId, setTplId] = useState<string>("");
  const [tplVars, setTplVars] = useState<string[]>([]);
  const [templateQuery, setTemplateQuery] = useState("");
  const [tplLoading, setTplLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "open" | "offline">("connecting");
  const [reconnectKey, setReconnectKey] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sort order for the conversation list — persisted per user preference.
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">(() => {
    try { return localStorage.getItem("inbox_sort_order") === "asc" ? "asc" : "desc"; } catch { return "desc"; }
  });
  // Test/junk conversations hidden by default; toggle reveals them for cleanup.
  const [showTests, setShowTests] = useState<boolean>(() => {
    try { return localStorage.getItem("inbox_show_tests") === "true"; } catch { return false; }
  });
  // Multi-select + bulk archive / restore / permanent delete
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<null | { type: "archive" | "unarchive" | "delete"; step: 1 | 2 }>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // WhatsApp-style thread: windowed history + smart auto-scroll
  const [olderMsgs, setOlderMsgs] = useState<any[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [addDocTarget, setAddDocTarget] = useState<AddDocTarget | null>(null);
  const [docSummaryRefreshKey, setDocSummaryRefreshKey] = useState(0);
  const msgScrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevLastMsgIdRef = useRef<number | null>(null);

  useEffect(() => { try { localStorage.setItem("inbox_sort_order", sortOrder); } catch {} }, [sortOrder]);
  useEffect(() => { try { localStorage.setItem("inbox_show_tests", String(showTests)); } catch {} }, [showTests]);

  // Close the mobile lead-info drawer whenever the selected conversation changes
  useEffect(() => {
    setSidebarSheetOpen(false);
  }, [selectedId]);

  // Deep-link: /staff/messages?conversation=<id> opens the conversation directly
  // (used by quick-contact success toasts and failure notifications).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const convParam = params.get("conversation");
      if (convParam) {
        const id = parseInt(convParam, 10);
        if (Number.isFinite(id) && id > 0) setSelectedId(id);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick once every 5s so the tooltip's "Xs ago" text stays roughly fresh
  // and the derived "stale" status flips after the threshold without needing
  // a separate timer per event.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Even though the EventSource may be technically open, surface a "Stalled"
  // amber state when no event/heartbeat has arrived in over STALE_AFTER_MS.
  // This catches the "looks live but isn't" failure mode where the push
  // pipeline silently stops emitting but the socket stays connected.
  const effectiveLiveStatus: "connecting" | "open" | "offline" | "stale" =
    liveStatus === "open" && lastEventAt !== null && now - lastEventAt > STALE_AFTER_MS
      ? "stale"
      : liveStatus;

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/inbox/conversations?tab=${tab}${channel !== "all" ? `&channel=${channel}` : ""}&order=${sortOrder}${showTests ? "&showTests=true" : ""}`;
      const res = await customFetch(url);
      setConvs((res as any)?.data || []);
    } catch {
      setConvs([]);
    } finally {
      setLoading(false);
    }
  }, [tab, channel, sortOrder, showTests]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const fetchDetail = useCallback(async (id: number) => {
    try {
      const res = await customFetch(`/api/inbox/conversations/${id}`);
      setDetail(res as InboxConversationDetailResponse);
      setHasMoreOlder(Boolean((res as any)?.hasMoreMessages));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setDetail(null);
    // Reset compose drafts when switching conversations so a half-written
    // note/task/reply doesn't leak across tickets.
    setComposeTab("chat");
    setReply("");
    setNoteDraft("");
    setTaskDraft({ title: "", scheduledAt: "", notes: "" });
    // Reset thread pagination + scroll bookkeeping for the new conversation.
    setOlderMsgs([]);
    setHasMoreOlder(false);
    setNewBelow(0);
    atBottomRef.current = true;
    prevLastMsgIdRef.current = null;
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
      setLastEventAt(Date.now());
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

    // Heartbeats arrive every ~25s and don't trigger any data refresh — they
    // just keep proxies happy and let the client prove the stream is alive.
    const onHeartbeat = () => {
      setLastEventAt(Date.now());
    };

    es.onopen = () => {
      failureCount = 0;
      setLiveStatus("open");
      // The server emits an initial heartbeat right after connect, but mark
      // "now" too so a freshly opened indicator never shows "no updates yet".
      setLastEventAt(Date.now());
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
    es.addEventListener("heartbeat", onHeartbeat);

    return () => {
      es.removeEventListener("inbox_message", refresh);
      es.removeEventListener("inbox_assigned", refresh);
      es.removeEventListener("heartbeat", onHeartbeat);
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
      toast({ title: t("messagesPage.failedToLoadSuggestions"), variant: "destructive" });
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
      toast({ title: t("messagesPage.linked") });
      setMatchOpen(false);
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: t("messagesPage.failedToLink"), variant: "destructive" });
    }
  }

  function openAddStudentDialog() {
    const currentExt = detail?.externalContact;
    const currentConv = detail?.conversation;
    const name = (currentExt?.displayName || currentConv?.title || "").trim();
    const parts = name.split(/\s+/);
    setAddStudentPrefill({
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
      email: currentExt?.email || "",
      phone: currentExt?.phone || "",
    });
    setMatchOpen(false);
    setAddStudentOpen(true);
  }

  async function openCreateLeadDialog() {
    if (!selectedId) return;
    setCreateLeadForm({ fullName: "", email: "", phone: "" });
    setCreateLeadAiFields(new Set());
    setCreateLeadDuplicate(null);
    setCreateLeadOpen(true);
    setMatchOpen(false);
    setCreateLeadLoading(true);
    try {
      const r: any = await customFetch(`/api/inbox/conversations/${selectedId}/lead-suggestion`);
      const s = r?.suggestion || {};
      const aiFields = new Set<string>();
      const form = {
        fullName: "",
        email: "",
        phone: (s.phone as string) || "",
      };
      if (s.displayName && !s.fullName) {
        form.fullName = s.displayName as string;
      }
      if (s.fullName) {
        form.fullName = s.fullName as string;
        if (s.fullNameLowConfidence) aiFields.add("fullName");
      }
      if (s.email) {
        form.email = s.email as string;
        if (s.emailLowConfidence) aiFields.add("email");
      }
      setCreateLeadForm(form);
      setCreateLeadAiFields(aiFields);
    } catch {
      // leave form empty — user can type manually
    } finally {
      setCreateLeadLoading(false);
    }
  }

  async function submitCreateLead() {
    if (!selectedId || !createLeadForm.fullName.trim()) return;
    setCreateLeadSubmitting(true);
    setCreateLeadDuplicate(null);
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/create-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: createLeadForm.fullName.trim(),
          email: createLeadForm.email.trim() || null,
          phone: createLeadForm.phone.trim() || null,
        }),
      });
      toast({ title: t("messagesPage.newLeadCreated") });
      setCreateLeadOpen(false);
      fetchInbox();
      if (selectedId) fetchDetail(selectedId);
    } catch (err: any) {
      const body = err?.body ?? err?.data;
      if (body?.error === "LEAD_EXISTS" && body?.candidate) {
        setCreateLeadDuplicate(body.candidate);
      } else {
        toast({ title: t("messagesPage.failedToCreateLead"), variant: "destructive" });
      }
    } finally {
      setCreateLeadSubmitting(false);
    }
  }

  async function linkToExistingLead() {
    if (!selectedId || !createLeadDuplicate) return;
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "lead", entityId: createLeadDuplicate.id }),
      });
      toast({ title: t("messagesPage.linked") });
      setCreateLeadOpen(false);
      fetchInbox();
      if (selectedId) fetchDetail(selectedId);
    } catch {
      toast({ title: t("messagesPage.failedToLink"), variant: "destructive" });
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
      setAssignedNotice(true);
      setTimeout(() => setAssignedNotice(false), 3000);
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: t("messagesPage.failedToAssign"), variant: "destructive" });
    }
  }

  async function toggleBot(enabled: boolean) {
    if (!selectedId) return;
    try {
      await customFetch(`/api/inbox/conversations/${selectedId}/bot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      toast({ title: enabled ? t("messagesPage.aiEnabled") : t("messagesPage.aiDisabled") });
      fetchInbox();
      fetchDetail(selectedId);
    } catch {
      toast({ title: t("messagesPage.aiToggleFailed"), variant: "destructive" });
    }
  }

  async function uploadFileForInbox(file: File): Promise<{ url: string; type: string; name: string } | null> {
    try {
      const urlRes = await customFetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "inbox", name: file.name, size: file.size, contentType: file.type }),
      }) as any;
      const { uploadURL, objectPath } = urlRes;
      const uploadResp = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!uploadResp.ok) throw new Error("Upload failed");
      const publicUrl = `${window.location.origin}/api/storage/public-objects/${objectPath}`;
      const type = file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video"
        : file.type.startsWith("audio/") ? "audio"
        : "file";
      return { url: publicUrl, type, name: file.name };
    } catch (err: any) {
      toast({ title: t("inbox.error.sendMediaFailed"), description: err?.message, variant: "destructive" });
      return null;
    }
  }

  async function sendReply() {
    if (!selectedId || (!reply.trim() && pendingFiles.length === 0)) return;
    setSending(true);
    setUploading(true);
    try {
      const attachments: Array<{ url: string; type: string; name: string }> = [];
      for (const file of pendingFiles) {
        const r = await uploadFileForInbox(file);
        if (!r) { setSending(false); setUploading(false); return; }
        attachments.push(r);
      }
      setUploading(false);
      const res: any = await customFetch(`/api/inbox/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: reply.trim(),
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });
      if (res?.simulated) toast({ title: t("messagesPage.sentSimulated"), description: t("messagesPage.outboundSimulated") });
      else toast({ title: t("messagesPage.sent") });
      setReply("");
      setPendingFiles([]);
      fetchDetail(selectedId);
    } catch (err: any) {
      const body = err?.body;
      if (body?.error === "outside_24h_window") {
        toast({ title: t("messagesPage.outsideWindow"), description: t("messagesPage.useTemplateInstead"), variant: "destructive" });
        await openTemplateDialog();
      } else {
        toast({ title: body?.error || "Failed to send", variant: "destructive" });
      }
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  async function toggleStar(convId: number, e: React.MouseEvent) {
    e.stopPropagation();
    // Optimistic: flip the star in the list immediately; reconcile with the
    // server response (and roll back on failure).
    setConvs(prev => prev.map(c => c.id === convId ? { ...c, isStarred: !c.isStarred } : c));
    try {
      const res = await customFetch(`/api/inbox/conversations/${convId}/star`, { method: "POST" }) as any;
      setConvs(prev => prev.map(c => c.id === convId ? { ...c, isStarred: Boolean(res.starred) } : c));
      toast({ title: res.starred ? t("inbox.action.star") : t("inbox.action.unstar") });
    } catch {
      setConvs(prev => prev.map(c => c.id === convId ? { ...c, isStarred: !c.isStarred } : c));
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  async function toggleSubscribe(convId: number) {
    try {
      const res = await customFetch(`/api/inbox/conversations/${convId}/subscribe`, { method: "POST" }) as any;
      fetchInbox();
      if (selectedId === convId) fetchDetail(convId);
      toast({ title: res.subscribed ? t("inbox.action.subscribe") : t("inbox.action.unsubscribe") });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  }

  // Faz 4.2: AI summary + note + task mutations.
  // ApiError (lib/api-client-react custom-fetch.ts) exposes `.status` (number)
  // and `.data` (parsed JSON error body). We re-fetch the detail on summarize
  // success so the sidebar renders the freshly-generated content.
  const summarizeMutation = useSummarizeInboxConversation({
    mutation: {
      onSuccess: (resp) => {
        if (selectedId) fetchDetail(selectedId);
        if (!resp.fromCache) toast({ title: t("inbox.aiSummary.generated") });
      },
      onError: (err: any) => {
        const status: number | undefined = err?.status;
        const errBody = err?.data ?? err?.body;
        const errCode = String(errBody?.error ?? "");
        let msg = t("inbox.aiSummary.errorGeneric");
        if (status === 429) msg = t("inbox.aiSummary.errorRateLimit");
        else if (status === 502) msg = t("inbox.aiSummary.errorService");
        else if (status === 400 && /no.*messages|messages.*summarize/i.test(errCode)) {
          msg = t("inbox.aiSummary.errorNoMessages");
        } else if (status === 400) {
          msg = t("inbox.aiSummary.errorNoLink");
        }
        toast({ variant: "destructive", title: msg });
      },
    },
  });

  const noteMutation = useAddInboxConversationNote({
    mutation: {
      onSuccess: () => {
        toast({ title: t("inbox.compose.noteSaved") });
        setNoteDraft("");
      },
      onError: () => {
        toast({ variant: "destructive", title: t("inbox.compose.noteFailed") });
      },
    },
  });

  const taskMutation = useAddInboxConversationTask({
    mutation: {
      onSuccess: () => {
        toast({ title: t("inbox.compose.taskCreated") });
        setTaskDraft({ title: "", scheduledAt: "", notes: "" });
      },
      onError: () => {
        toast({ variant: "destructive", title: t("inbox.compose.taskFailed") });
      },
    },
  });

  const handleSummarize = () => {
    if (selectedId) summarizeMutation.mutate({ id: selectedId });
  };
  const handleSubmitNote = () => {
    if (!selectedId || !noteDraft.trim()) return;
    noteMutation.mutate({ id: selectedId, data: { content: noteDraft.trim() } });
  };
  const handleSubmitTask = () => {
    if (!selectedId || !taskDraft.title.trim() || !taskDraft.scheduledAt) return;
    const scheduled = new Date(taskDraft.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) return;
    taskMutation.mutate({
      id: selectedId,
      data: {
        title: taskDraft.title.trim(),
        scheduledAt: scheduled.toISOString(),
        notes: taskDraft.notes.trim() || undefined,
      },
    });
  };

  async function openTemplateDialog() {
    setTplId("");
    setTplVars([]);
    setTemplateQuery("");
    setTplLoading(true);
    setTplOpen(true);
    try {
      const r = await customFetch(`/api/inbox/whatsapp-templates`);
      setTemplates((r as any)?.data || []);
    } catch {
      toast({ title: t("messagesPage.failedToLoadTemplates"), variant: "destructive" });
    } finally {
      setTplLoading(false);
    }
  }

  async function sendTemplate() {
    if (!selectedId || !tplId) return;
    try {
      const res: any = await customFetch(`/api/inbox/conversations/${selectedId}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: parseInt(tplId, 10), parameters: tplVars.map(v => v.trim()) }),
      });
      if (res?.simulated) toast({ title: t("messagesPage.templateSentSimulated") });
      else toast({ title: t("messagesPage.templateSent") });
      setTplOpen(false);
      setTplId("");
      setTplVars([]);
      setTemplateQuery("");
      fetchDetail(selectedId);
    } catch (err: any) {
      toast({ title: err?.body?.error || "Failed to send template", variant: "destructive" });
    }
  }

  const channelOptions = ["all", "whatsapp", "messenger", "instagram", "web_form", "email", "sms", "telegram"];
  const tabs: Array<{ key: typeof tab; label: string; icon: any }> = [
    { key: "mine", label: t("messagesPage.mine"), icon: UserCheck },
    { key: "unassigned", label: t("messagesPage.unassigned"), icon: InboxIcon },
    { key: "open", label: t("inbox.tabs.open"), icon: MessageCircle },
    { key: "unanswered", label: t("inbox.tabs.unanswered"), icon: Clock },
    { key: "subscribed", label: t("inbox.tabs.subscribed"), icon: Bell },
    { key: "starred", label: t("inbox.tabs.starred"), icon: Star },
    { key: "unmatched", label: t("messagesPage.unmatched"), icon: AlertTriangle },
    { key: "all", label: t("messagesPage.all"), icon: Hash },
    { key: "archived", label: t("inbox.tabs.archived"), icon: Archive },
  ];

  // ── Thread helpers: windowed history, smart auto-scroll, retry ──────────

  // Merge older pages (loaded via `before` cursor) with the live window.
  const allMsgs = useMemo(() => {
    const base = ((detail?.messages || []) as any[]);
    const seen = new Set(base.map((m) => m.id));
    return [...olderMsgs.filter((m) => !seen.has(m.id)), ...base];
  }, [detail, olderMsgs]);

  async function loadOlderMessages() {
    if (!selectedId || loadingOlder) return;
    const oldest = allMsgs[0];
    if (!oldest) return;
    setLoadingOlder(true);
    const el = msgScrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    try {
      const res: any = await customFetch(`/api/inbox/conversations/${selectedId}?before=${oldest.id}&limit=50`);
      const older = (res?.messages || []) as any[];
      setHasMoreOlder(Boolean(res?.hasMoreMessages));
      setOlderMsgs((prev) => {
        const have = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !have.has(m.id)), ...prev];
      });
      // Keep the viewport anchored on the message the user was reading.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
      });
    } catch {
      // non-fatal; the button stays available
    } finally {
      setLoadingOlder(false);
    }
  }

  // Smart auto-scroll: stick to bottom when the user is already there;
  // otherwise show a "new messages" jump badge instead of yanking the view.
  useEffect(() => {
    const el = msgScrollRef.current;
    if (!el || allMsgs.length === 0) return;
    const last = allMsgs[allMsgs.length - 1];
    const prevLast = prevLastMsgIdRef.current;
    if (prevLast === last.id) return;
    prevLastMsgIdRef.current = last.id;
    if (prevLast === null || atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(0);
    } else {
      setNewBelow((n) => n + 1);
    }
  }, [allMsgs]);

  const handleMsgScroll = () => {
    const el = msgScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    atBottomRef.current = atBottom;
    if (atBottom) setNewBelow(0);
  };

  const jumpToBottom = () => {
    const el = msgScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewBelow(0);
  };

  async function retryMessage(id: number) {
    setRetryingId(id);
    try {
      await customFetch(`/api/inbox/messages/${id}/retry`, { method: "POST" });
      toast({ title: t("inbox.retry.success") });
    } catch (err: any) {
      toast({ title: err?.body?.error || t("inbox.retry.failed"), variant: "destructive" });
    } finally {
      setRetryingId(null);
    }
    if (selectedId) fetchDetail(selectedId);
  }

  // ── Bulk selection helpers ───────────────────────────────────────────────
  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((prev) =>
      prev.size === convs.length ? new Set() : new Set(convs.map((c) => c.id)),
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  async function runBulk(type: "archive" | "unarchive" | "delete") {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const path = type === "archive" ? "bulk-archive" : type === "unarchive" ? "bulk-unarchive" : "bulk-delete";
      await customFetch(`/api/inbox/conversations/${path}`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      toast({
        title:
          type === "archive"
            ? t("inbox.bulk.archivedToast", { count: ids.length })
            : type === "unarchive"
              ? t("inbox.bulk.restoredToast", { count: ids.length })
              : t("inbox.bulk.deletedToast", { count: ids.length }),
      });
      setBulkConfirm(null);
      exitSelectMode();
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      fetchInbox();
    } catch (err: any) {
      toast({ title: err?.body?.error || t("inbox.bulk.failed"), variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  }

  // Day separator label: Today / Yesterday / localized date.
  const dayLabelOf = (d: Date) => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return t("inbox.chat.today");
    if (d.toDateString() === yesterday.toDateString()) return t("inbox.chat.yesterday");
    return d.toLocaleDateString();
  };

  // Safe non-null assertion: `conv` is only read inside the `!detail ? loader : (...)` JSX branch below.
  const conv = detail?.conversation!;
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
      <div className="grid grid-cols-1 lg:grid-cols-12 h-full grid-rows-[minmax(0,1fr)]">
        <div className={`lg:col-span-3 h-full min-h-0 border-r border-border/50 min-w-0 overflow-hidden ${selectedId !== null ? "hidden lg:flex lg:flex-col" : "flex flex-col"}`}>
          <div className="p-3 border-b border-border/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <InboxIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate">
                  {t("messagesPage.inbox")}
                </span>
              </div>
              <LiveStatusIndicator
                status={effectiveLiveStatus}
                lastEventAt={lastEventAt}
                now={now}
                onReconnect={reconnectLive}
              />
            </div>

            <div className="flex w-full rounded-lg bg-muted/50 p-1 gap-0.5 overflow-x-auto scrollbar-none">
              {tabs.map((tb) => {
                const Icon = tb.icon;
                const active = tab === tb.key;
                return (
                  <button
                    key={tb.key}
                    onClick={() => setTab(tb.key)}
                    aria-pressed={active}
                    className={cn(
                      "shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5 shrink-0", !active && "opacity-60")} />
                    <span>{tb.label}</span>
                  </button>
                );
              })}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between gap-2 h-8">
                  <span className="flex items-center gap-2 min-w-0">
                    {channel !== "all" && (
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          channel === "whatsapp" && "bg-green-500",
                          channel === "messenger" && "bg-blue-600",
                          channel === "instagram" && "bg-pink-500",
                          channel === "web_form" && "bg-indigo-500",
                          channel === "email" && "bg-purple-500",
                          channel === "sms" && "bg-amber-500",
                          channel === "telegram" && "bg-sky-500"
                        )}
                      />
                    )}
                    <Filter className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {channel === "all"
                        ? t("messagesPage.allChannels")
                        : t(`inbox.channels.${channel}`)}
                    </span>
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                {channelOptions.map((ch) => {
                  const Icon = ch === "all" ? InboxIcon : (channelIcon[ch] || MessageCircle);
                  return (
                    <DropdownMenuItem key={ch} onClick={() => setChannel(ch)}>
                      <Icon
                        className={cn(
                          "w-4 h-4 me-2",
                          ch === "whatsapp" && "text-green-600",
                          ch === "messenger" && "text-blue-700",
                          ch === "instagram" && "text-pink-600",
                          ch === "web_form" && "text-indigo-600",
                          ch === "email" && "text-purple-600",
                          ch === "sms" && "text-amber-600",
                          ch === "telegram" && "text-sky-600"
                        )}
                      />
                      {ch === "all"
                        ? t("messagesPage.allChannels")
                        : t(`inbox.channels.${ch}`)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
                title={t("inbox.sort.toggle")}
                data-testid="button-inbox-sort"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                {sortOrder === "desc" ? t("inbox.sort.newestFirst") : t("inbox.sort.oldestFirst")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn("h-7 px-2 text-xs gap-1", showTests ? "text-amber-600" : "text-muted-foreground")}
                onClick={() => setShowTests((v) => !v)}
                title={t("inbox.tests.toggleHint")}
                data-testid="button-inbox-show-tests"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                {showTests ? t("inbox.tests.shown") : t("inbox.tests.hidden")}
              </Button>
              <div className="flex-1" />
              <Button
                variant={selectMode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                data-testid="button-inbox-select-mode"
              >
                <ListChecks className="w-3.5 h-3.5" />
                {selectMode ? t("inbox.bulk.cancel") : t("inbox.bulk.select")}
              </Button>
            </div>

            {selectMode && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-xs font-medium text-primary hover:underline shrink-0"
                >
                  {selectedIds.size === convs.length && convs.length > 0
                    ? t("inbox.bulk.clearAll")
                    : t("inbox.bulk.selectAll")}
                </button>
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {t("inbox.bulk.selectedCount", { count: selectedIds.size })}
                </span>
                {tab === "archived" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] gap-1"
                    disabled={selectedIds.size === 0 || bulkBusy}
                    onClick={() => setBulkConfirm({ type: "unarchive", step: 1 })}
                    data-testid="button-bulk-unarchive"
                  >
                    <ArchiveRestore className="w-3 h-3" /> {t("inbox.bulk.restore")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] gap-1"
                    disabled={selectedIds.size === 0 || bulkBusy}
                    onClick={() => setBulkConfirm({ type: "archive", step: 1 })}
                    data-testid="button-bulk-archive"
                  >
                    <Archive className="w-3 h-3" /> {t("inbox.bulk.archive")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] gap-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={selectedIds.size === 0 || bulkBusy}
                  onClick={() => setBulkConfirm({ type: "delete", step: 1 })}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="w-3 h-3" /> {t("inbox.bulk.delete")}
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : convs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <InboxIcon className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">{t("messagesPage.noConversations")}</p>
              </div>
            ) : convs.map((c) => {
              const Icon = channelIcon[c.channel] || MessageCircle;
              const isSel = c.id === selectedId;
              const isChecked = selectedIds.has(c.id);
              return (
                <div
                  key={c.id}
                  data-testid="inbox-conversation-item"
                  onClick={() => (selectMode ? toggleSelected(c.id) : setSelectedId(c.id))}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 ${isSel && !selectMode ? "bg-primary/5 border-l-2 border-l-primary" : isChecked ? "bg-primary/10" : "hover:bg-secondary/50"}`}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelected(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 shrink-0 accent-primary"
                      data-testid={`checkbox-conv-${c.id}`}
                    />
                  )}
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
                  {!selectMode && (
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted shrink-0"
                      onClick={(e) => toggleStar(c.id, e)}
                      title={c.isStarred ? t("inbox.action.unstar") : t("inbox.action.star")}
                    >
                      <Star className={`w-3.5 h-3.5 ${c.isStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className={`lg:col-span-6 flex flex-col h-full min-h-0 overflow-hidden ${selectedId === null ? "hidden lg:flex lg:items-center lg:justify-center" : ""}`}>
          {!selectedId ? (
            <div className="text-center text-muted-foreground">
              <InboxIcon className="w-16 h-16 mx-auto mb-3 opacity-20" />
              <p className="font-medium">{t("messagesPage.selectConversation")}</p>
            </div>
          ) : !detail ? (
            <div className="flex items-center justify-center w-full h-full"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3 shrink-0">
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
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                    {(ext?.phone || ext?.email) && (
                      <span className="truncate">{ext?.phone || ext?.email}</span>
                    )}
                    {conv.assignedTo && (
                      <>
                        {(ext?.phone || ext?.email) && <span aria-hidden>•</span>}
                        <span>assigned to</span>
                        <Avatar className="h-4 w-4">
                          {conv.assignedTo.avatarUrl ? (
                            <AvatarImage
                              src={conv.assignedTo.avatarUrl}
                              alt={`${conv.assignedTo.firstName} ${conv.assignedTo.lastName}`}
                            />
                          ) : null}
                          <AvatarFallback className="text-[8px] font-medium bg-primary/10 text-primary">
                            {((conv.assignedTo.firstName?.[0] ?? "") + (conv.assignedTo.lastName?.[0] ?? "")).toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate">{conv.assignedTo.firstName} {conv.assignedTo.lastName}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 items-center">
                  {conv.needsHuman && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      <AlertTriangle className="w-3 h-3" /> {t("messagesPage.needsHuman")}
                    </span>
                  )}
                  {conv.channel === "whatsapp" && (
                    <Button
                      size="sm"
                      variant={conv.botEnabled ? "default" : "outline"}
                      onClick={() => toggleBot(!conv.botEnabled)}
                      className="h-7 text-xs gap-1"
                      title={conv.botEnabled ? t("messagesPage.aiOnHint") : t("messagesPage.aiOffHint")}
                      data-testid="button-toggle-bot"
                    >
                      <Bot className="w-3 h-3" /> {conv.botEnabled ? t("messagesPage.aiOn") : t("messagesPage.aiOff")}
                    </Button>
                  )}
                  {conv.assignedToId !== user?.id && (
                    <Button size="sm" variant="outline" onClick={assignToMe} className="h-7 text-xs gap-1">
                      <UserCheck className="w-3 h-3" /> Assign to me
                    </Button>
                  )}
                  {assignedNotice && (
                    <span className="text-xs text-green-600 font-medium">{t("messagesPage.assignedToYou")}</span>
                  )}
                  <Button
                    size="sm"
                    variant={(conv as any).isSubscribed ? "default" : "outline"}
                    onClick={() => toggleSubscribe(conv.id)}
                    className="h-7 text-xs gap-1"
                    title={(conv as any).isSubscribed ? t("inbox.action.unsubscribe") : t("inbox.action.subscribe")}
                  >
                    <Bell className="w-3 h-3" />
                    <span className="hidden lg:inline">{(conv as any).isSubscribed ? t("inbox.action.unsubscribe") : t("inbox.action.subscribe")}</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="lg:hidden h-8 w-8"
                    onClick={() => setSidebarSheetOpen(true)}
                    aria-label={t("inbox.sidebar.openLeadInfo")}
                    data-testid="button-open-lead-info"
                  >
                    <Info className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {conv.unmatched && (
                <div className="m-3 p-3 rounded-lg border border-amber-300 bg-amber-50 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5" />
                  <div className="flex-1 text-xs text-amber-900">
                    <p className="font-semibold">{t("messagesPage.unmatchedContact")}</p>
                    <p>{t("messagesPage.notLinkedYet")}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadSuggestions}>
                    Match
                  </Button>
                </div>
              )}

              {(conv.channel === "whatsapp" || conv.channel === "messenger" || conv.channel === "instagram") && !detail.withinWindow && (
                <div className="m-3 p-3 rounded-lg border border-orange-300 bg-orange-50 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-orange-700" />
                  <p className="text-xs text-orange-900 flex-1">
                    {conv.channel === "whatsapp" ? t("messagesPage.outside24hReplyWindow") : t("messagesPage.outside24hReplyWindowMeta")}
                  </p>
                  {conv.channel === "whatsapp" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openTemplateDialog}>{t("messagesPage.useTemplate")}</Button>
                  )}
                </div>
              )}

              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
              <div ref={msgScrollRef} onScroll={handleMsgScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" data-testid="inbox-message-scroll">
                {hasMoreOlder && (
                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={loadOlderMessages}
                      disabled={loadingOlder}
                      data-testid="button-load-older"
                    >
                      {loadingOlder ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                      {t("inbox.chat.loadOlder")}
                    </Button>
                  </div>
                )}
                {allMsgs.map((m: any, idx: number) => {
                  const out = m.direction === "outbound";
                  const day = new Date(m.createdAt);
                  const prevMsg = idx > 0 ? allMsgs[idx - 1] : null;
                  const showDaySep = !prevMsg || new Date(prevMsg.createdAt).toDateString() !== day.toDateString();
                  return (
                    <div key={m.id}>
                    {showDaySep && (
                      <div className="flex items-center justify-center my-2">
                        <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {dayLabelOf(day)}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                        {m.content && m.content !== "[attachment]" && (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                        {(() => {
                          const singleAtt = (m.metadata as any)?.attachment as MessageAttachment | undefined;
                          const allAtts: MessageAttachment[] = [
                            ...(singleAtt ? [singleAtt] : []),
                            ...((m.metadata as any)?.attachments ?? []),
                          ];
                          if (!allAtts.length) return null;
                          return (
                            <div className="mt-1.5 space-y-1.5">
                              {allAtts.map((a: MessageAttachment, i: number) => {
                                const rawUrl = a.url ?? a.fileUrl ?? "";
                                // Zernio media URLs require a Bearer apiKey — load them
                                // through our authenticated server proxy instead.
                                const url = rawUrl.startsWith("https://zernio.com/")
                                  ? `/api/inbox/media/${m.id}/${i}`
                                  : rawUrl;
                                const type = a.type ?? a.fileType ?? "file";
                                const name = a.name ?? a.fileName ?? "file";
                                const canAdd = !out && Boolean(detail.lead || detail.student);
                                const _btnCls = "inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors";
                                const actionRow = (
                                  <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={_btnCls}
                                    >
                                      <Eye className="w-3 h-3" />
                                      {t("inbox.addAsDoc.preview")}
                                    </a>
                                    <a
                                      href={url}
                                      download={name}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={_btnCls}
                                    >
                                      <Download className="w-3 h-3" />
                                      {t("inbox.addAsDoc.download")}
                                    </a>
                                    {canAdd && (
                                      <button
                                        type="button"
                                        title={t("inbox.addAsDoc.button")}
                                        onClick={() => setAddDocTarget({ msgId: m.id, attachIdx: i, attachUrl: url, attachName: name, isImage: type === "image" })}
                                        className={_btnCls}
                                      >
                                        <FilePlus2 className="w-3 h-3" />
                                        {t("inbox.addAsDoc.button")}
                                      </button>
                                    )}
                                  </div>
                                );
                                if (type === "image") return (
                                  <div key={i} className="space-y-1">
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      <img src={url} alt={name} className="max-w-[240px] rounded-lg" loading="lazy" />
                                    </a>
                                    {actionRow}
                                  </div>
                                );
                                if (type === "video") return (
                                  <div key={i} className="space-y-1">
                                    <video src={url} controls className="max-w-[240px] rounded-lg" />
                                    {actionRow}
                                  </div>
                                );
                                if (type === "audio") return (
                                  <div key={i} className="space-y-1">
                                    <audio src={url} controls className="w-full" />
                                    {actionRow}
                                  </div>
                                );
                                return (
                                  <div key={i} className="space-y-1">
                                    <a href={url} target="_blank" rel="noopener noreferrer"
                                      className={`flex items-center gap-1.5 text-xs underline ${out ? "text-primary-foreground/80" : "text-foreground/80"}`}>
                                      <Paperclip className="w-3 h-3 shrink-0" /> {name}
                                    </a>
                                    {actionRow}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div className={`flex items-center gap-1 text-[10px] mt-1 ${out ? "opacity-80" : "text-muted-foreground"}`}>
                          <span>{day.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          {out && m.status === "failed" && (
                            <span
                              className="inline-flex items-center gap-0.5 text-red-300 font-medium cursor-help"
                              title={m.failedReason || t("inbox.status.failed")}
                              data-testid={`status-failed-${m.id}`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" /> {t("inbox.status.failed")}
                            </span>
                          )}
                          {out && (m.status === "pending" || m.status === "queued") && (
                            <span className="inline-flex items-center gap-0.5" title={t("inbox.status.pending")}>
                              <Clock className="w-2.5 h-2.5" />
                            </span>
                          )}
                          {out && (m.status === "sent" || m.status === "delivered" || m.status === "read") && (
                            <span className="inline-flex items-center" title={t(`inbox.status.${m.status}`)}>
                              {m.status === "sent" ? <Check className="w-3 h-3" /> : <CheckCheck className={`w-3 h-3 ${m.status === "read" ? "text-sky-300" : ""}`} />}
                            </span>
                          )}
                          {m.metadata?.simulated && <span className="opacity-80">• {t("inbox.status.simulated")}</span>}
                        </div>
                        {out && m.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => retryMessage(m.id)}
                            disabled={retryingId === m.id}
                            className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-300/60 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                            title={m.failedReason || undefined}
                            data-testid={`button-retry-${m.id}`}
                          >
                            {retryingId === m.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                            {t("inbox.retry.resend")}
                          </button>
                        )}
                      </div>
                    </div>
                    </div>
                  );
                })}
              </div>
              {newBelow > 0 && (
                <button
                  type="button"
                  onClick={jumpToBottom}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
                  data-testid="button-jump-new"
                >
                  <ArrowDown className="w-3 h-3" /> {t("inbox.chat.newMessages", { count: newBelow })}
                </button>
              )}
              </div>

              <ChatNoteTaskTabs
                activeTab={composeTab}
                onTabChange={setComposeTab}
                chatSlot={
                  <div className="p-3 flex flex-col gap-2">
                    {pendingFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {pendingFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs max-w-[180px]">
                            <Paperclip className="w-3 h-3 shrink-0" />
                            <span className="truncate flex-1">{f.name}</span>
                            <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="rounded hover:text-destructive shrink-0">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length > 0) setPendingFiles(prev => [...prev, ...files]);
                        e.target.value = "";
                      }}
                    />
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendReply();
                          }
                        }}
                        placeholder={(conv.channel === "whatsapp" || conv.channel === "messenger" || conv.channel === "instagram") && !detail.withinWindow ? (conv.channel === "whatsapp" ? t("messagesPage.outside24hUseTemplate") : t("messagesPage.outside24hReplyWindowMeta")) : t("messagesPage.replyPlaceholder")}
                        rows={2}
                        className="flex-1 rounded-lg text-sm"
                        disabled={(conv.channel === "whatsapp" || conv.channel === "messenger" || conv.channel === "instagram") && !detail.withinWindow && pendingFiles.length === 0}
                      />
                      <div className="flex flex-col gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          title={t("inbox.compose.attach")}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="w-4 h-4" />
                        </Button>
                        {conv.channel === "whatsapp" && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={openTemplateDialog} title={t("messagesPage.template")}>
                            <FileText className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={sendReply}
                        disabled={sending || uploading || (reply.trim() === "" && pendingFiles.length === 0) || ((conv.channel === "whatsapp" || conv.channel === "messenger" || conv.channel === "instagram") && !detail.withinWindow && pendingFiles.length === 0)}
                        className="h-9 gap-1"
                      >
                        {(sending || uploading) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        {t("inbox.send") || "Send"}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{t("inbox.compose.enterToSend")}</p>
                  </div>
                }
                noteDraft={noteDraft}
                onNoteDraftChange={setNoteDraft}
                onSubmitNote={handleSubmitNote}
                noteSubmitting={noteMutation.isPending}
                noteEnabled={Boolean(detail.lead || detail.student)}
                taskDraft={taskDraft}
                onTaskDraftChange={setTaskDraft}
                onSubmitTask={handleSubmitTask}
                taskSubmitting={taskMutation.isPending}
                taskEnabled={Boolean(detail.lead || detail.student)}
              />
            </>
          )}
        </div>

        {selectedId !== null && detail && (
          <div className="hidden lg:flex lg:col-span-3 lg:flex-col h-full min-h-0 overflow-hidden border-l border-border/50 bg-muted/20">
            <LeadDetailSidebar
              detail={detail}
              conversationId={selectedId}
              docSummaryRefreshKey={docSummaryRefreshKey}
              onOpenMatchDialog={loadSuggestions}
              onSummarize={handleSummarize}
              isSummarizing={summarizeMutation.isPending}
              onUpdated={() => { if (selectedId) fetchDetail(selectedId); }}
            />
          </div>
        )}
      </div>

      {detail && (
        <Sheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen}>
          <SheetContent
            side={isRTL ? "left" : "right"}
            className="w-[85vw] max-w-md p-0 lg:hidden flex flex-col"
          >
            <SheetHeader className="px-4 py-3 border-b border-border/50 text-start">
              <SheetTitle className="text-sm">{t("inbox.sidebar.leadInfoTitle")}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <LeadDetailSidebar
                detail={detail}
                conversationId={selectedId}
                docSummaryRefreshKey={docSummaryRefreshKey}
                onOpenMatchDialog={() => { setSidebarSheetOpen(false); loadSuggestions(); }}
                onSummarize={handleSummarize}
                isSummarizing={summarizeMutation.isPending}
                onUpdated={() => { if (selectedId) fetchDetail(selectedId); }}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4" /> {t("messagesPage.matchContact")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {matchSuggestions?.outcome === "strong" && (
              <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded">{t("messagesPage.strongMatchConfirmLink")}</p>
            )}
            {matchSuggestions?.outcome === "ambiguous" && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">{t("messagesPage.multipleCandidatesPickOne")}</p>
            )}
            {matchSuggestions?.outcome === "none" && (
              <p className="text-xs text-muted-foreground bg-secondary p-2 rounded">{t("messagesPage.noMatchesCreateLead")}</p>
            )}
            {(matchSuggestions?.candidates || []).map((c: any, i: number) => (
              <div key={`${c.type}-${c.id}-${i}`} className="flex items-center justify-between p-2 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">{c.displayName || `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(unnamed)"} <Badge variant="outline" className="text-[9px] ml-1">{c.type}</Badge></p>
                  <p className="text-[11px] text-muted-foreground">{c.email || c.phone || ""}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => applyMatch(c.type, c.id)}>{t("messagesPage.link")}</Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchOpen(false)}>{t("messagesPage.cancel")}</Button>
            <Button variant="outline" onClick={openCreateLeadDialog} className="gap-1"><Plus className="w-3 h-3" /> {t("messagesPage.newLead")}</Button>
            <Button onClick={openAddStudentDialog} className="gap-1"><UserPlus className="w-3 h-3" /> {t("messagesPage.addStudentBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createLeadOpen} onOpenChange={(open) => { if (!createLeadSubmitting) setCreateLeadOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="w-4 h-4" /> {t("messagesPage.createLeadFromConversation")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createLeadDuplicate && (
              <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 space-y-2">
                <p className="text-xs font-semibold text-amber-900">{t("messagesPage.duplicateLeadFound")}</p>
                <p className="text-xs text-amber-800">{t("messagesPage.duplicateLeadMessage")}</p>
                <div className="flex items-center justify-between text-xs border border-amber-200 rounded p-2 bg-white">
                  <span className="font-medium">{createLeadDuplicate.firstName} {createLeadDuplicate.lastName}</span>
                  <span className="text-muted-foreground">{createLeadDuplicate.email || createLeadDuplicate.phone || ""}</span>
                </div>
                <Button size="sm" variant="outline" className="w-full gap-1 h-8 text-xs" onClick={linkToExistingLead}>
                  <Link2 className="w-3 h-3" /> {t("messagesPage.linkToExistingLead")}
                </Button>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">{t("messagesPage.fullName")} *</Label>
                {createLeadAiFields.has("fullName") && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1 gap-0.5 bg-purple-100 text-purple-700">
                    <span>✦</span> {t("messagesPage.aiSuggestion")}
                  </Badge>
                )}
              </div>
              {createLeadLoading ? (
                <div className="h-9 rounded-md bg-muted animate-pulse" />
              ) : (
                <Input
                  value={createLeadForm.fullName}
                  onChange={(e) => setCreateLeadForm((f) => ({ ...f, fullName: e.target.value }))}
                  placeholder={t("messagesPage.fullName")}
                  className="h-9"
                />
              )}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-xs">{t("messagesPage.emailAddress")}</Label>
                {createLeadAiFields.has("email") && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1 gap-0.5 bg-purple-100 text-purple-700">
                    <span>✦</span> {t("messagesPage.aiSuggestion")}
                  </Badge>
                )}
              </div>
              {createLeadLoading ? (
                <div className="h-9 rounded-md bg-muted animate-pulse" />
              ) : (
                <Input
                  type="email"
                  value={createLeadForm.email}
                  onChange={(e) => setCreateLeadForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder={t("messagesPage.emailAddress")}
                  className="h-9"
                />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("messagesPage.phoneNumber")}</Label>
              {createLeadLoading ? (
                <div className="h-9 rounded-md bg-muted animate-pulse" />
              ) : (
                <Input
                  value={createLeadForm.phone}
                  onChange={(e) => setCreateLeadForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder={t("messagesPage.phoneNumber")}
                  className="h-9"
                />
              )}
            </div>
            {createLeadLoading && (
              <p className="text-[11px] text-muted-foreground text-center animate-pulse">{t("messagesPage.loadingAiSuggestion")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateLeadOpen(false)} disabled={createLeadSubmitting}>{t("messagesPage.cancel")}</Button>
            <Button onClick={submitCreateLead} disabled={createLeadLoading || createLeadSubmitting || !createLeadForm.fullName.trim()} className="gap-1">
              {createLeadSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              {t("messagesPage.createLead")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddStudentModal
        open={addStudentOpen}
        onClose={() => setAddStudentOpen(false)}
        onSuccess={() => {}}
        prefill={addStudentPrefill}
        onCreated={(studentId) => applyMatch("student", studentId)}
      />

      {addDocTarget && detail && selectedId && (detail.lead || detail.student) && (
        <AddAsDocumentModal
          convId={selectedId}
          target={addDocTarget}
          ownerType={detail.student ? "student" : "lead"}
          ownerId={(detail.student?.id ?? detail.lead?.id)!}
          ownerName={`${(detail.student ?? detail.lead)?.firstName ?? ""} ${(detail.student ?? detail.lead)?.lastName ?? ""}`.trim()}
          onClose={() => setAddDocTarget(null)}
          onSaved={() => { setAddDocTarget(null); setDocSummaryRefreshKey((k) => k + 1); }}
        />
      )}

      <Dialog open={tplOpen} onOpenChange={(open) => { setTplOpen(open); if (!open) { setTplId(""); setTplVars([]); setTemplateQuery(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-4 h-4" /> {t("messagesPage.whatsappTemplate")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input className="pl-8 h-9 rounded-lg" placeholder={t("messagesPage.searchTemplates")} value={templateQuery} onChange={(e) => setTemplateQuery(e.target.value)} />
            </div>

            {/* Template list */}
            {tplLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (() => {
              const approved = templates.filter(tpl =>
                tpl.externalTemplateName &&
                (tpl.approvalStatus ?? tpl.status ?? "").toLowerCase() === "approved"
              );
              if (approved.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-6">{t("messagesPage.noApprovedTemplates")}</p>;
              }
              const q = templateQuery.toLowerCase();
              const filtered = approved.filter(tpl =>
                !q ||
                (tpl.externalTemplateName || tpl.name || "").toLowerCase().includes(q) ||
                (tpl.category || "").toLowerCase().includes(q) ||
                (tpl.language || "").toLowerCase().includes(q) ||
                (tpl.content ?? tpl.bodyText ?? "").toLowerCase().includes(q)
              );
              if (filtered.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-6">{t("messagesPage.noTemplatesMatchSearch")}</p>;
              }
              return (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {filtered.map(tpl => {
                    const isSelected = tplId === String(tpl.id);
                    const rawStatus = (tpl.approvalStatus ?? tpl.status ?? "").toUpperCase();
                    const body = tpl.content ?? tpl.bodyText ?? "";
                    const varCount = Array.isArray(tpl.variables) ? tpl.variables.length : (tpl.variableCount ?? (body.match(/\{\{\d+\}\}/g) || []).length);
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setTplId(String(tpl.id));
                          setTplVars(Array.from({ length: varCount }, () => ""));
                        }}
                        className={cn(
                          "w-full text-left rounded-lg border p-2.5 transition-colors hover:bg-muted/50",
                          isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
                        )}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm flex-1 min-w-0 truncate">{tpl.externalTemplateName || tpl.name}</span>
                          {tpl.language && <Badge variant="secondary" className="text-[10px] px-1.5 h-4 shrink-0">{tpl.language.toUpperCase()}</Badge>}
                          {tpl.category && <Badge variant="outline" className="text-[10px] px-1.5 h-4 shrink-0">{tpl.category}</Badge>}
                          {rawStatus && (
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 h-4 shrink-0",
                              rawStatus === "APPROVED" ? "bg-green-50 text-green-700 border-green-200" :
                              rawStatus === "PENDING" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                              "bg-gray-50 text-gray-600"
                            )}>{rawStatus}</Badge>
                          )}
                        </div>
                        {body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{body}</p>}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Variable inputs */}
            {(() => {
              const sel = templates.find(tpl => String(tpl.id) === tplId);
              const selBody = sel ? (sel.content ?? sel.bodyText ?? "") : "";
              const varCount = sel ? (Array.isArray(sel.variables) ? sel.variables.length : (sel.variableCount ?? (selBody.match(/\{\{\d+\}\}/g) || []).length)) : 0;
              if (!sel || varCount === 0) return null;
              return (
                <div className="space-y-2">
                  {Array.from({ length: varCount }, (_, i) => (
                    <div key={i}>
                      <Label className="text-xs">Variable {i + 1} {`({{${i + 1}}})`}</Label>
                      <Input
                        className="h-9 rounded-lg mt-0.5"
                        placeholder={`Value for {{${i + 1}}}`}
                        value={tplVars[i] ?? ""}
                        onChange={(e) => setTplVars(prev => { const next = [...prev]; next[i] = e.target.value; return next; })}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Live preview */}
            {(() => {
              const sel = templates.find(tpl => String(tpl.id) === tplId);
              const previewBody = sel ? (sel.content ?? sel.bodyText ?? "") : "";
              if (!previewBody) return null;
              const preview = previewBody.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => {
                const val = tplVars[parseInt(n, 10) - 1];
                return val?.trim() ? val.trim() : `{{${n}}}`;
              });
              return (
                <div>
                  <Label className="text-xs">{t("messagesPage.preview")}</Label>
                  <div className="mt-1 rounded-xl bg-green-50 border border-green-200 px-3 py-2.5">
                    <p className="text-sm whitespace-pre-wrap text-green-900">{preview}</p>
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>{t("messagesPage.cancel")}</Button>
            <Button
              onClick={sendTemplate}
              disabled={!tplId || ((templates.find(tpl => String(tpl.id) === tplId)?.variables || []).length > 0 && tplVars.some(v => !v.trim()))}
              className="gap-1"
            >
              <Send className="w-3 h-3" /> {t("messagesPage.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkConfirm !== null} onOpenChange={(open) => { if (!open && !bulkBusy) setBulkConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkConfirm?.type === "delete" ? (
                <Trash2 className="w-4 h-4 text-red-600" />
              ) : bulkConfirm?.type === "unarchive" ? (
                <ArchiveRestore className="w-4 h-4" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              {bulkConfirm?.type === "delete"
                ? bulkConfirm.step === 2
                  ? t("inbox.bulk.deleteConfirmTitle2")
                  : t("inbox.bulk.deleteConfirmTitle")
                : bulkConfirm?.type === "unarchive"
                  ? t("inbox.bulk.restoreConfirmTitle")
                  : t("inbox.bulk.archiveConfirmTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {bulkConfirm?.type === "delete"
              ? bulkConfirm.step === 2
                ? t("inbox.bulk.deleteConfirmBody2", { count: selectedIds.size })
                : t("inbox.bulk.deleteConfirmBody", { count: selectedIds.size })
              : bulkConfirm?.type === "unarchive"
                ? t("inbox.bulk.restoreConfirmBody", { count: selectedIds.size })
                : t("inbox.bulk.archiveConfirmBody", { count: selectedIds.size })}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={bulkBusy} onClick={() => setBulkConfirm(null)}>
              {t("messagesPage.cancel")}
            </Button>
            {bulkConfirm?.type === "delete" ? (
              bulkConfirm.step === 1 ? (
                <Button
                  variant="destructive"
                  onClick={() => setBulkConfirm({ type: "delete", step: 2 })}
                  data-testid="button-bulk-delete-step1"
                >
                  {t("inbox.bulk.deleteContinue")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={bulkBusy}
                  onClick={() => runBulk("delete")}
                  className="gap-1"
                  data-testid="button-bulk-delete-step2"
                >
                  {bulkBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  {t("inbox.bulk.deleteForever")}
                </Button>
              )
            ) : (
              <Button
                disabled={bulkBusy}
                onClick={() => runBulk(bulkConfirm?.type === "unarchive" ? "unarchive" : "archive")}
                className="gap-1"
                data-testid="button-bulk-confirm"
              >
                {bulkBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                {bulkConfirm?.type === "unarchive" ? t("inbox.bulk.restore") : t("inbox.bulk.archive")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </>
  );
}

function ConversationList({
  conversations, selectedId, onSelect, onNewConversation, search, setSearch,
  sortOrder, onToggleSort, selectMode, onToggleSelectMode, selectedIds,
  onToggleSelected, onSelectAll, onBulkArchive, onBulkDelete, bulkBusy
}: {
  conversations: Conversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNewConversation: () => void;
  search: string;
  setSearch: (s: string) => void;
  sortOrder: "desc" | "asc";
  onToggleSort: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<number>;
  onToggleSelected: (id: number) => void;
  onSelectAll: () => void;
  onBulkArchive: () => void;
  onBulkDelete: () => void;
  bulkBusy: boolean;
}) {
  const { user } = useAuth();
  const { t } = useI18n();

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">{t("messagesPage.messages")}</h2>
          <Button size="sm" variant="outline" onClick={onNewConversation} className="h-8 gap-1.5 rounded-lg">
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("messagesPage.searchConversations")} className="pl-9 h-8 text-sm rounded-lg" />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground"
            onClick={onToggleSort}
            title={t("inbox.sort.toggle")}
            data-testid="button-internal-sort"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            {sortOrder === "desc" ? t("inbox.sort.newestFirst") : t("inbox.sort.oldestFirst")}
          </Button>
          <div className="flex-1" />
          <Button
            variant={selectMode ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground"
            onClick={onToggleSelectMode}
            data-testid="button-internal-select-mode"
          >
            <ListChecks className="w-3.5 h-3.5" />
            {selectMode ? t("inbox.bulk.cancel") : t("inbox.bulk.select")}
          </Button>
        </div>
        {selectMode && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-xs font-medium text-primary hover:underline shrink-0"
            >
              {selectedIds.size === conversations.length && conversations.length > 0
                ? t("inbox.bulk.clearAll")
                : t("inbox.bulk.selectAll")}
            </button>
            <span className="text-xs text-muted-foreground flex-1 truncate">
              {t("inbox.bulk.selectedCount", { count: selectedIds.size })}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={onBulkArchive}
              data-testid="button-internal-bulk-archive"
            >
              <Archive className="w-3 h-3" /> {t("inbox.bulk.archive")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={selectedIds.size === 0 || bulkBusy}
              onClick={onBulkDelete}
              data-testid="button-internal-bulk-delete"
            >
              <Trash2 className="w-3 h-3" /> {t("inbox.bulk.delete")}
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageCircle className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">{t("messagesPage.noConversationsYet")}</p>
          </div>
        ) : (
          conversations.map(conv => {
            const others = conv.participants.filter(p => p.userId !== user?.id);
            const displayName = conv.title || others.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Conversation";
            const initials = others[0] ? `${others[0].firstName?.[0] || ""}${others[0].lastName?.[0] || ""}` : "?";
            const avatarUrl = others[0]?.avatarUrl || null;
            const isSelected = conv.id === selectedId;
            const isChecked = selectedIds.has(conv.id);

            return (
              <div
                key={conv.id}
                onClick={() => (selectMode ? onToggleSelected(conv.id) : onSelect(conv.id))}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 transition-colors ${isSelected && !selectMode ? "bg-primary/5 border-l-2 border-l-primary" : isChecked ? "bg-primary/10" : "hover:bg-secondary/50"}`}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleSelected(conv.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 shrink-0 accent-primary"
                    data-testid={`checkbox-internal-conv-${conv.id}`}
                  />
                )}
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
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const channel = "internal" as const;
  const [sending, setSending] = useState(false);
  const [participants, setParticipants] = useState<Array<{ userId: number; firstName: string; lastName: string; avatarUrl: string | null; role: string; lastReadAt?: string | null }>>([]);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [togglingReceipts, setTogglingReceipts] = useState(false);
  const [summary, setSummary] = useState<ConversationAiSummary | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasAtBottomRef = useRef(true);
  const justOpenedRef = useRef(true);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await customFetch(`/api/conversations/${conversationId}/messages?limit=100`);
      setMessages((res as any)?.data || res || []);
      if (typeof (res as any)?.readReceiptsEnabled === "boolean") {
        setReadReceiptsEnabled((res as any).readReceiptsEnabled);
      }
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    justOpenedRef.current = true;
    wasAtBottomRef.current = true;
    // Reset the AI summary so a stale summary from the previous conversation
    // doesn't leak across threads. The internal thread is self-contained and
    // has no detail endpoint that returns aiSummary, so we seed it on demand
    // from the summarize response below.
    setSummary(null);
    setReadReceiptsEnabled(true);
    Promise.all([
      fetchMessages(),
      customFetch(`/api/conversations/${conversationId}/participants`).then((r: any) => setParticipants(r?.data || r || [])),
    ]).finally(() => setLoading(false));

    pollRef.current = setInterval(fetchMessages, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [conversationId, fetchMessages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (justOpenedRef.current || wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      wasAtBottomRef.current = true;
      justOpenedRef.current = false;
    }
  }, [messages]);

  // AI summary for internal threads. The summarize endpoint is type/link-
  // independent (it only needs messages), so we reuse the same hook + error
  // mapping as the Inbox tab. The result is stored locally and seeded from the
  // response since the internal thread has no detail endpoint returning it.
  const summarizeMutation = useSummarizeInboxConversation({
    mutation: {
      onSuccess: (resp) => {
        setSummary(resp.data);
        if (!resp.fromCache) toast({ title: t("inbox.aiSummary.generated") });
      },
      onError: (err: any) => {
        const status: number | undefined = err?.status;
        const errBody = err?.data ?? err?.body;
        const errCode = String(errBody?.error ?? "");
        let msg = t("inbox.aiSummary.errorGeneric");
        if (status === 429) msg = t("inbox.aiSummary.errorRateLimit");
        else if (status === 502) msg = t("inbox.aiSummary.errorService");
        else if (status === 400 && /no.*messages|messages.*summarize/i.test(errCode)) {
          msg = t("inbox.aiSummary.errorNoMessages");
        } else if (status === 400) {
          // Internal conversations are link-independent, so a generic 400 here
          // is effectively "nothing to summarize" rather than a missing link.
          msg = t("inbox.aiSummary.errorNoMessages");
        }
        toast({ variant: "destructive", title: msg });
      },
    },
  });

  const handleSummarize = () => {
    summarizeMutation.mutate({ id: conversationId });
  };

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
      if (!uploadResp.ok) throw new Error(t("messagesPage.fileUploadFailed"));
      return {
        fileName: file.name,
        fileUrl: `/api/storage${objectPath}`,
        fileType: file.type,
        fileSize: file.size,
      };
    } catch (err: any) {
      toast({ title: t("messagesPage.uploadFailed"), description: err.message, variant: "destructive" });
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
      toast({ title: t("messagesPage.failedToSend"), description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: t("messagesPage.fileTooLarge"), description: t("messagesPage.maxFileSize25mb"), variant: "destructive" });
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
      if (!res.ok) throw new Error(t("messagesPage.downloadFailed"));
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
      toast({ title: t("messagesPage.downloadFailed"), description: t("messagesPage.couldNotDownloadFile"), variant: "destructive" });
    }
  };

  const others = participants.filter(p => p.userId !== user?.id);
  const threadTitle = others.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Conversation";

  async function toggleReadReceipts() {
    if (togglingReceipts) return;
    setTogglingReceipts(true);
    try {
      const res: any = await customFetch(`/api/conversations/${conversationId}/read-receipts`, { method: "PATCH" });
      if (typeof res?.readReceiptsEnabled === "boolean") setReadReceiptsEnabled(res.readReceiptsEnabled);
    } catch {
      toast({ title: t("messagesPage.readReceiptsToggleFailed"), variant: "destructive" });
    } finally {
      setTogglingReceipts(false);
    }
  }

  const ChannelIcon = channelIcon[channel] || MessageSquare;

  return (
    <>
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-border/50 flex items-center gap-3 shrink-0">
        <Button size="icon" variant="ghost" className="lg:hidden w-8 h-8" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{threadTitle}</p>
          <p className="text-xs text-muted-foreground">{participants.length} participants</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleReadReceipts}
              disabled={togglingReceipts}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
              aria-label={readReceiptsEnabled ? t("messagesPage.readReceiptsOn") : t("messagesPage.readReceiptsOff")}
            >
              {readReceiptsEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {readReceiptsEnabled ? t("messagesPage.readReceiptsOn") : t("messagesPage.readReceiptsOff")}
          </TooltipContent>
        </Tooltip>
        <Badge variant="secondary" className={`text-xs ${channelColor[channel] || ""}`}>
          <ChannelIcon className="w-3 h-3 mr-1" />
          {channel}
        </Badge>
      </div>

      <div className="px-4 pt-3 shrink-0">
        <AiSummaryCard
          summary={summary}
          hasLink
          hasMessages={messages.length > 0}
          isSummarizing={summarizeMutation.isPending}
          onSummarize={handleSummarize}
          onDismiss={() => setSummary(null)}
        />
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">{t("messagesPage.noMessagesYet")}</p>
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
                    {att && isImage(att.fileType!) && (
                      <div className="mb-1 group/att relative">
                        <img src={att.fileUrl!} alt={att.fileName!} className="max-w-full max-h-48 rounded-lg object-cover" />
                        <button
                          onClick={() => handleDownload(att.fileUrl!, att.fileName!)}
                          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity hover:bg-black/70"
                          title={t("messagesPage.download")}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {att && !isImage(att.fileType!) && (
                      <button
                        onClick={() => handleDownload(att.fileUrl!, att.fileName!)}
                        className={`flex items-center gap-2 p-2 rounded-lg mb-1 w-full text-left ${isMe ? "bg-white/10 hover:bg-white/20" : "bg-background hover:bg-background/80"} transition-colors`}
                      >
                        <FileText className="w-5 h-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{att.fileName!}</p>
                          <p className={`text-[10px] ${isMe ? "text-white/60" : "text-muted-foreground"}`}>{formatFileSize(att.fileSize!)}</p>
                        </div>
                        <Download className={`w-4 h-4 shrink-0 ${isMe ? "text-white/60" : "text-muted-foreground"}`} />
                      </button>
                    )}
                    {hasTextContent && <p className="text-sm whitespace-pre-wrap">{msg.content}</p>}
                  </div>
                  <span className={`flex items-center gap-1 text-[10px] text-muted-foreground mt-1 ${isMe ? "justify-end" : ""}`}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {msg.channel !== "internal" && (
                      <span className="ml-1 opacity-70">via {msg.channel}</span>
                    )}
                    {isMe && readReceiptsEnabled && (() => {
                      const isSeen = others.some(p => p.lastReadAt && new Date(p.lastReadAt) >= new Date(msg.createdAt));
                      return isSeen
                        ? <Tooltip><TooltipTrigger asChild><span><CheckCheck className="w-3 h-3 text-primary inline" /></span></TooltipTrigger><TooltipContent side="top" className="text-xs">{t("messagesPage.seen")}</TooltipContent></Tooltip>
                        : <Tooltip><TooltipTrigger asChild><span><Check className="w-3 h-3 opacity-50 inline" /></span></TooltipTrigger><TooltipContent side="top" className="text-xs">{t("messagesPage.delivered")}</TooltipContent></Tooltip>;
                    })()}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-border/50 shrink-0">
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
            placeholder={t("messagesPage.typeMessage")}
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
  const { t } = useI18n();
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
      toast({ title: t("messagesPage.titleAndMessageRequired"), variant: "destructive" });
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
      toast({ title: t("messagesPage.failedToSendBroadcast"), description: err.message, variant: "destructive" });
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
            <Label>{t("messagesPage.title")}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("messagesPage.broadcastTitle")} className="rounded-xl" />
          </div>
          <div className="space-y-2">
            <Label>{t("messagesPage.message")}</Label>
            <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder={t("messagesPage.writeBroadcastMessage")} rows={4} className="rounded-xl" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("messagesPage.channel")}</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">{t("messagesPage.internalInApp")}</SelectItem>
                  <SelectItem value="email">{t("messagesPage.email")}</SelectItem>
                  <SelectItem value="whatsapp">{t("messagesPage.whatsapp")}</SelectItem>
                  <SelectItem value="telegram">{t("messagesPage.telegram")}</SelectItem>
                  <SelectItem value="sms">{t("messagesPage.sms")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("messagesPage.targetAudience")}</Label>
              <Select value={targetAudience} onValueChange={setTargetAudience}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("messagesPage.allActiveUsers")}</SelectItem>
                  <SelectItem value="role">{t("messagesPage.specificRoles")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {targetAudience === "role" && (
            <div className="space-y-2">
              <Label>{t("messagesPage.selectRoles")}</Label>
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
          <h3 className="font-semibold text-foreground">{t("messagesPage.broadcastHistory")}</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></div>
        ) : broadcasts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">{t("messagesPage.noBroadcastsYet")}</div>
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
  externalTemplateName?: string | null;
  approvalStatus?: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
  creatorFirstName: string | null;
  creatorLastName: string | null;
}

function TemplatesTab() {
  const { t: tx } = useI18n();
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

  const [waSyncing, setWaSyncing] = useState(false);
  const [waSyncError, setWaSyncError] = useState<string | null>(null);
  const [waTplOpen, setWaTplOpen] = useState(false);
  const [waDeleteConfirm, setWaDeleteConfirm] = useState<number | null>(null);
  const [waDeleting, setWaDeleting] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waMode, setWaMode] = useState<"custom" | "library">("custom");
  const [waName, setWaName] = useState("");
  const [waLanguage, setWaLanguage] = useState("en");
  const [waCategory, setWaCategory] = useState("utility");
  const [waBodyText, setWaBodyText] = useState("");
  const [waFooterText, setWaFooterText] = useState("");
  const [waLibraryName, setWaLibraryName] = useState("");

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await customFetch("/api/message-templates");
      setTemplates((res as any)?.data || []);
    } catch {
      toast({ title: tx("messagesPage.failedToLoadTemplates"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  const syncWhatsAppTemplates = useCallback(async () => {
    setWaSyncing(true);
    setWaSyncError(null);
    try {
      const res = await customFetch("/api/inbox/whatsapp-templates");
      const synced: Template[] = (res as any)?.data || [];
      setTemplates((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        for (const t of synced) map.set(t.id, t);
        return Array.from(map.values());
      });
    } catch (err: any) {
      setWaSyncError(err?.body?.error || tx("messagesPage.whatsappTemplateSyncFailed"));
    } finally {
      setWaSyncing(false);
    }
  }, [tx]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);
  useEffect(() => { syncWhatsAppTemplates(); }, [syncWhatsAppTemplates]);

  function openNewWaTemplate() {
    setWaMode("custom");
    setWaName("");
    setWaLanguage("en");
    setWaCategory("utility");
    setWaBodyText("");
    setWaFooterText("");
    setWaLibraryName("");
    setWaTplOpen(true);
  }

  async function deleteWaTemplate(id: number, externalName: string) {
    setWaDeleting(true);
    try {
      await customFetch(`/api/inbox/whatsapp-templates/${encodeURIComponent(externalName)}`, {
        method: "DELETE",
      });
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: tx("messagesPage.templateDeleted") });
    } catch (err: any) {
      toast({ title: err?.body?.error || tx("messagesPage.failedToDelete"), variant: "destructive" });
    } finally {
      setWaDeleting(false);
      setWaDeleteConfirm(null);
    }
  }

  async function submitWaTemplate() {
    if (!waName.trim()) {
      toast({ title: tx("messagesPage.nameAndContentRequired"), variant: "destructive" });
      return;
    }
    if (waMode === "custom" && !waBodyText.trim()) {
      toast({ title: tx("messagesPage.nameAndContentRequired"), variant: "destructive" });
      return;
    }
    if (waMode === "library" && !waLibraryName.trim()) {
      toast({ title: tx("messagesPage.nameAndContentRequired"), variant: "destructive" });
      return;
    }
    setWaSaving(true);
    try {
      await customFetch("/api/inbox/whatsapp-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: waMode,
          name: waName.trim(),
          language: waLanguage,
          category: waCategory,
          bodyText: waMode === "custom" ? waBodyText.trim() : undefined,
          footerText: waMode === "custom" ? (waFooterText.trim() || undefined) : undefined,
          libraryTemplateName: waMode === "library" ? waLibraryName.trim() : undefined,
        }),
      });
      toast({ title: tx("messagesPage.whatsappTemplateSubmitted") });
      setWaTplOpen(false);
      fetchTemplates();
    } catch (err: any) {
      toast({ title: err?.body?.error || tx("messagesPage.whatsappTemplateSubmitFailed"), variant: "destructive" });
    } finally {
      setWaSaving(false);
    }
  }

  function waStatusBadge(status?: string | null) {
    const s = status || "unknown";
    const styles: Record<string, string> = {
      approved: "bg-green-500/10 text-green-700",
      pending: "bg-amber-500/10 text-amber-700",
      rejected: "bg-red-500/10 text-red-700",
      unknown: "bg-gray-500/10 text-gray-600",
    };
    const labels: Record<string, string> = {
      approved: tx("messagesPage.waStatusApproved"),
      pending: tx("messagesPage.waStatusPending"),
      rejected: tx("messagesPage.waStatusRejected"),
      unknown: tx("messagesPage.waStatusUnknown"),
    };
    return (
      <Badge variant="secondary" className={`text-[10px] h-5 ${styles[s] || styles.unknown}`}>
        {labels[s] || labels.unknown}
      </Badge>
    );
  }

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
      toast({ title: tx("messagesPage.nameAndContentRequired"), variant: "destructive" });
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
        toast({ title: tx("messagesPage.templateUpdated") });
      } else {
        const res = await customFetch("/api/message-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        fetchTemplates();
        toast({ title: tx("messagesPage.templateCreated") });
      }
      setEditOpen(false);
    } catch (err: any) {
      toast({ title: tx("messagesPage.failedToSaveTemplate"), description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: number) {
    try {
      await customFetch(`/api/message-templates/${id}`, { method: "DELETE" });
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: tx("messagesPage.templateDeleted") });
    } catch (err: any) {
      toast({ title: tx("messagesPage.failedToDelete"), description: err.message, variant: "destructive" });
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
      toast({ title: tx("messagesPage.failedToUpdateTemplate"), variant: "destructive" });
    }
  }

  function copyContent(content: string) {
    navigator.clipboard.writeText(content);
    toast({ title: tx("messagesPage.templateContentCopied") });
  }

  const filtered = templates.filter(t => {
    if (filterCategory !== "all" && t.category !== filterCategory) return false;
    if (searchTerm && !t.name.toLowerCase().includes(searchTerm.toLowerCase()) && !t.content.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const cannedFiltered = filtered.filter(t => !t.externalTemplateName);
  const waFiltered = filtered.filter(t => !!t.externalTemplateName);

  const grouped = cannedFiltered.reduce<Record<string, Template[]>>((acc, t) => {
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
              placeholder={tx("messagesPage.searchTemplates")}
              className="pl-9 rounded-xl"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full sm:w-48 rounded-xl">
              <SelectValue placeholder={tx("messagesPage.category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tx("messagesPage.allCategories")}</SelectItem>
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
            <p className="font-medium">{tx("messagesPage.noTemplatesFound")}</p>
            <p className="text-sm mt-1">{tx("messagesPage.createFirstTemplate")}</p>
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
                              title={tx("messagesPage.copyContent")}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openEdit(t)}
                              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                              title={tx("messagesPage.edit")}
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
                                <button onClick={() => deleteTemplate(t.id)} className="p-1.5 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors" title={tx("messagesPage.confirmDelete")}>
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeleteConfirm(null)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground" title={tx("messagesPage.cancel")}>
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(t.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-600"
                                title={tx("messagesPage.delete")}
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

      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> {tx("messagesPage.whatsappOfficialTemplates")}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {tx("messagesPage.whatsappOfficialTemplatesDesc")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={syncWhatsAppTemplates} disabled={waSyncing} className="rounded-xl gap-2">
              {waSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {tx("messagesPage.refresh")}
            </Button>
            <Button onClick={openNewWaTemplate} className="rounded-xl gap-2">
              <Plus className="w-4 h-4" /> {tx("messagesPage.newWhatsappTemplate")}
            </Button>
          </div>
        </div>

        {waSyncError && (
          <div className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900">
            {waSyncError}
          </div>
        )}

        {waFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="w-10 h-10 mb-3 opacity-20" />
            <p className="font-medium text-sm">{tx("messagesPage.noWhatsappTemplatesFound")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {waFiltered.map(t => (
              <div key={t.id} className={`border rounded-xl p-4 transition-all hover:shadow-md ${!t.isActive ? "opacity-50 bg-secondary/30" : "bg-card hover:border-primary/30"}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{t.name}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {waStatusBadge(t.approvalStatus)}
                    <Badge variant="outline" className="text-[10px] h-5 gap-0.5">
                      <Globe className="w-2.5 h-2.5" /> {t.language.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{t.content}</p>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-[10px] text-muted-foreground capitalize">{t.category}</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyContent(t.content)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      title={tx("messagesPage.copyContent")}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {waDeleteConfirm === t.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => t.externalTemplateName && deleteWaTemplate(t.id, t.externalTemplateName)}
                          disabled={waDeleting}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          title={tx("messagesPage.confirmDelete")}
                        >
                          {waDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setWaDeleteConfirm(null)}
                          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                          title={tx("messagesPage.cancel")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setWaDeleteConfirm(t.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-600"
                        title={tx("messagesPage.delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={waTplOpen} onOpenChange={setWaTplOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> {tx("messagesPage.newWhatsappTemplate")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button type="button" variant={waMode === "custom" ? "default" : "outline"} size="sm" className="rounded-lg" onClick={() => setWaMode("custom")}>
                {tx("messagesPage.waModeCustom")}
              </Button>
              <Button type="button" variant={waMode === "library" ? "default" : "outline"} size="sm" className="rounded-lg" onClick={() => setWaMode("library")}>
                {tx("messagesPage.waModeLibrary")}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{tx("messagesPage.templateNameRequired")}</Label>
                <Input value={waName} onChange={e => setWaName(e.target.value)} placeholder="order_update" className="rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label>{tx("messagesPage.language")}</Label>
                <Select value={waLanguage} onValueChange={setWaLanguage}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_LANGUAGES.map(l => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{tx("messagesPage.category")}</Label>
              <Select value={waCategory} onValueChange={setWaCategory}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">Utility</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="authentication">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {waMode === "custom" ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{tx("messagesPage.contentRequired")}</Label>
                    <p className="text-[10px] text-muted-foreground">{"{{1}}, {{2}} ..."}</p>
                  </div>
                  <Textarea value={waBodyText} onChange={e => setWaBodyText(e.target.value)} rows={5} className="rounded-xl font-mono text-sm" />
                </div>
                <div className="space-y-2">
                  <Label>{tx("messagesPage.waFooterOptional")}</Label>
                  <Input value={waFooterText} onChange={e => setWaFooterText(e.target.value)} className="rounded-xl" />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>{tx("messagesPage.waLibraryTemplateName")}</Label>
                <Input value={waLibraryName} onChange={e => setWaLibraryName(e.target.value)} className="rounded-xl" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaTplOpen(false)} className="rounded-xl">{tx("messagesPage.cancel")}</Button>
            <Button onClick={submitWaTemplate} disabled={waSaving} className="rounded-xl gap-2">
              {waSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {tx("messagesPage.submitForApproval")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label>{tx("messagesPage.templateNameRequired")}</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={tx("messagesPage.egWelcomeEmail")} className="rounded-xl" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{tx("messagesPage.category")}</Label>
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
                <Label>{tx("messagesPage.channel")}</Label>
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
                <Label>{tx("messagesPage.language")}</Label>
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
                <Label>{tx("messagesPage.subjectLine")}</Label>
                <Input value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder={tx("messagesPage.emailSubject")} className="rounded-xl" />
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{tx("messagesPage.contentRequired")}</Label>
                <p className="text-[10px] text-muted-foreground">
                  Use {"{{variable}}"} for dynamic placeholders, e.g. {"{{studentName}}"}, {"{{programName}}"}
                </p>
              </div>
              <Textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                placeholder={tx("messagesPage.writeTemplateContent")}
                rows={8}
                className="rounded-xl font-mono text-sm"
              />
            </div>

            {formContent && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{tx("messagesPage.preview")}</Label>
                <div className="bg-secondary/50 rounded-xl p-4 text-sm whitespace-pre-wrap border border-border/50">
                  {formContent}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-xl">{tx("messagesPage.cancel")}</Button>
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

function MessageConvTracker({ convId }: { convId: number | null }) {
  useEntityViewTracker("message_thread", convId ?? undefined);
  return null;
}

export default function MessagesPage() {
  const { t } = useI18n();
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
  const [internalSort, setInternalSort] = useState<"desc" | "asc">(() => {
    try { return localStorage.getItem("internal_sort_order") === "asc" ? "asc" : "desc"; } catch { return "desc"; }
  });
  const [internalSelectMode, setInternalSelectMode] = useState(false);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<number>>(new Set());
  const [internalBulkConfirm, setInternalBulkConfirm] = useState<null | { type: "archive" | "delete"; step: 1 | 2 }>(null);
  const [internalBulkBusy, setInternalBulkBusy] = useState(false);

  useEffect(() => { try { localStorage.setItem("internal_sort_order", internalSort); } catch {} }, [internalSort]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await customFetch(`/api/conversations?order=${internalSort}${search ? `&search=${search}` : ""}`);
      setConversations((res as any)?.data || res || []);
    } catch {}
  }, [search, internalSort]);

  const toggleInternalSelected = (id: number) => {
    setInternalSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function runInternalBulk(type: "archive" | "delete") {
    const ids = Array.from(internalSelectedIds);
    if (ids.length === 0) return;
    setInternalBulkBusy(true);
    try {
      const path = type === "archive" ? "bulk-archive" : "bulk-delete";
      await customFetch(`/api/inbox/conversations/${path}`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      toast({
        title: type === "archive"
          ? t("inbox.bulk.archivedToast", { count: ids.length })
          : t("inbox.bulk.deletedToast", { count: ids.length }),
      });
      setInternalBulkConfirm(null);
      setInternalSelectMode(false);
      setInternalSelectedIds(new Set());
      if (selectedConv && ids.includes(selectedConv)) setSelectedConv(null);
      fetchConversations();
    } catch (err: any) {
      toast({ title: err?.body?.error || t("inbox.bulk.failed"), variant: "destructive" });
    } finally {
      setInternalBulkBusy(false);
    }
  }

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
      toast({ title: t("messagesPage.selectAtLeastOneUser"), variant: "destructive" });
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
      toast({ title: t("messagesPage.failedToCreateConversation"), description: err.message, variant: "destructive" });
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
        <h1 className="text-2xl font-display font-bold text-foreground">{t("staffMessages.title")}</h1>

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
                <div className={`lg:col-span-4 h-full min-h-0 border-r border-border/50 ${selectedConv !== null ? "hidden lg:block" : ""}`}>
                  <ConversationList
                    conversations={conversations}
                    selectedId={selectedConv}
                    onSelect={setSelectedConv}
                    onNewConversation={() => setNewConvOpen(true)}
                    search={search}
                    setSearch={setSearch}
                    sortOrder={internalSort}
                    onToggleSort={() => setInternalSort((o) => (o === "desc" ? "asc" : "desc"))}
                    selectMode={internalSelectMode}
                    onToggleSelectMode={() => {
                      setInternalSelectMode((v) => !v);
                      setInternalSelectedIds(new Set());
                    }}
                    selectedIds={internalSelectedIds}
                    onToggleSelected={toggleInternalSelected}
                    onSelectAll={() =>
                      setInternalSelectedIds((prev) =>
                        prev.size === conversations.length
                          ? new Set()
                          : new Set(conversations.map((c) => c.id)),
                      )
                    }
                    onBulkArchive={() => setInternalBulkConfirm({ type: "archive", step: 1 })}
                    onBulkDelete={() => setInternalBulkConfirm({ type: "delete", step: 1 })}
                    bulkBusy={internalBulkBusy}
                  />
                </div>
                <div className={`lg:col-span-8 h-full min-h-0 ${selectedConv === null ? "hidden lg:flex lg:items-center lg:justify-center" : ""}`}>
                  {selectedConv === null ? (
                    <div className="text-center text-muted-foreground">
                      <MessageCircle className="w-16 h-16 mx-auto mb-3 opacity-20" />
                      <p className="font-medium">{t("messagesPage.selectConversation")}</p>
                      <p className="text-sm mt-1">{t("messagesPage.orStartNewOne")}</p>
                    </div>
                  ) : (
                    <>
                      <MessageConvTracker convId={selectedConv} />
                      <MessageThread conversationId={selectedConv} onBack={() => setSelectedConv(null)} />
                    </>
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
              <Label>{t("messagesPage.searchUsers")}</Label>
              <Input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder={t("messagesPage.typeToSearch")} className="rounded-xl" />
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
                      {selected && <Badge className="bg-primary text-white text-[10px] h-5">{t("messagesPage.selected")}</Badge>}
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
            <Button variant="outline" onClick={() => setNewConvOpen(false)}>{t("messagesPage.cancel")}</Button>
            <Button onClick={createConversation} disabled={creating || selectedUsers.length === 0}>
              {creating ? "Creating..." : "Start Conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={internalBulkConfirm !== null} onOpenChange={(open) => { if (!open && !internalBulkBusy) setInternalBulkConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {internalBulkConfirm?.type === "delete" ? (
                <Trash2 className="w-4 h-4 text-red-600" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              {internalBulkConfirm?.type === "delete"
                ? internalBulkConfirm.step === 2
                  ? t("inbox.bulk.deleteConfirmTitle2")
                  : t("inbox.bulk.deleteConfirmTitle")
                : t("inbox.bulk.archiveConfirmTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {internalBulkConfirm?.type === "delete"
              ? internalBulkConfirm.step === 2
                ? t("inbox.bulk.deleteConfirmBody2", { count: internalSelectedIds.size })
                : t("inbox.bulk.deleteConfirmBody", { count: internalSelectedIds.size })
              : t("inbox.bulk.archiveConfirmBody", { count: internalSelectedIds.size })}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={internalBulkBusy} onClick={() => setInternalBulkConfirm(null)}>
              {t("messagesPage.cancel")}
            </Button>
            {internalBulkConfirm?.type === "delete" ? (
              internalBulkConfirm.step === 1 ? (
                <Button
                  variant="destructive"
                  onClick={() => setInternalBulkConfirm({ type: "delete", step: 2 })}
                  data-testid="button-internal-bulk-delete-step1"
                >
                  {t("inbox.bulk.deleteContinue")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={internalBulkBusy}
                  onClick={() => runInternalBulk("delete")}
                  className="gap-1"
                  data-testid="button-internal-bulk-delete-step2"
                >
                  {internalBulkBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  {t("inbox.bulk.deleteForever")}
                </Button>
              )
            ) : (
              <Button
                disabled={internalBulkBusy}
                onClick={() => runInternalBulk("archive")}
                className="gap-1"
                data-testid="button-internal-bulk-confirm"
              >
                {internalBulkBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("inbox.bulk.archive")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
