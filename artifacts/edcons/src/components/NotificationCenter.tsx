import { useState, useEffect, useCallback, useRef } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Check, CheckCheck, X, MessageCircle, FileText,
  Users, DollarSign, AlertCircle, Megaphone, Mail, ChevronRight,
  UserCheck, Building2, FileCheck, Unlink,
} from "lucide-react";

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

const typeIcons: Record<string, any> = {
  "lead.assigned": UserCheck,
  "lead.agent_linked": Building2,
  "lead.agent_unlinked": Unlink,
  "lead.": Users,
  "application.assigned": UserCheck,
  "application.agent_linked": Building2,
  "application.agent_unlinked": Unlink,
  "application.": FileText,
  "student.assigned": UserCheck,
  "student.agent_linked": Building2,
  "student.agent_unlinked": Unlink,
  "student.document_uploaded": FileCheck,
  "student.": Users,
  "document.status_changed": FileCheck,
  "document.": FileText,
  "finance.": DollarSign,
  "agent.": Users,
  "system.": AlertCircle,
  "message.": MessageCircle,
};

function getIcon(type: string) {
  for (const [prefix, Icon] of Object.entries(typeIcons)) {
    if (type.startsWith(prefix)) return Icon;
  }
  return Bell;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationCenter() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await customFetch("/api/notifications/unread-count");
      setUnreadCount((res as any)?.count || 0);
    } catch {}
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customFetch("/api/notifications?limit=20");
      setNotifications((res as any)?.data || res || []);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 15000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  const markRead = async (id: number) => {
    try {
      await customFetch(`/api/notifications/${id}/read`, { method: "PATCH" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await customFetch("/api/notifications/mark-all-read", { method: "POST" });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast({ title: "All notifications marked as read" });
    } catch {}
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl hover:bg-secondary transition-colors"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-in zoom-in">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-96 bg-background border border-border rounded-2xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
            <div className="p-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Notifications</h3>
                {unreadCount > 0 && (
                  <Badge className="bg-red-500 text-white text-[10px] h-5">{unreadCount}</Badge>
                )}
              </div>
              <div className="flex gap-1">
                {unreadCount > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={markAllRead}>
                    <CheckCheck className="w-3 h-3" /> Mark all read
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setOpen(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center">
                  <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Bell className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map(n => {
                  const Icon = getIcon(n.type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (!n.isRead) markRead(n.id);
                        if (n.actionUrl) { setLocation(n.actionUrl); setOpen(false); }
                      }}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-border/30 cursor-pointer transition-colors hover:bg-secondary/50 ${!n.isRead ? "bg-primary/5" : ""}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${!n.isRead ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!n.isRead ? "font-semibold text-foreground" : "text-foreground/80"}`}>{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                        <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                      {!n.isRead && (
                        <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
