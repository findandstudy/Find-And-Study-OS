import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Send, Mail, Smartphone, MessageSquare, FormInput } from "lucide-react";

const CHANNEL_ICON: Record<string, any> = {
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
  sms: Smartphone,
  internal: MessageSquare,
  web_form: FormInput,
};

const CHANNEL_COLOR: Record<string, string> = {
  whatsapp: "bg-green-500/10 text-green-600",
  telegram: "bg-sky-500/10 text-sky-600",
  email: "bg-purple-500/10 text-purple-600",
  sms: "bg-amber-500/10 text-amber-600",
  internal: "bg-blue-500/10 text-blue-600",
  web_form: "bg-indigo-500/10 text-indigo-600",
};

interface AllMessagingHistoryProps {
  type: "lead" | "student" | "agent";
  id: number;
}

export function AllMessagingHistory({ type, id }: AllMessagingHistoryProps) {
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    customFetch(`/api/inbox/external-history?type=${type}&id=${id}`)
      .then((r: any) => {
        if (cancelled) return;
        setConversations(r?.conversations || []);
        setMessages(r?.messages || []);
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([]);
          setMessages([]);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </Card>
    );
  }

  if (conversations.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        No external messaging history yet.
      </Card>
    );
  }

  const convMap = new Map(conversations.map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      {conversations.map((conv) => {
        const Icon = CHANNEL_ICON[conv.channel] || MessageCircle;
        const convMessages = messages.filter((m) => m.conversationId === conv.id).slice(0, 20);
        return (
          <Card key={conv.id} className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${CHANNEL_COLOR[conv.channel] || ""}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{conv.title || "(conversation)"}</p>
                <p className="text-[11px] text-muted-foreground">
                  <Badge variant="secondary" className="text-[9px] mr-1">{conv.channel}</Badge>
                  {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleString() : ""}
                </p>
              </div>
              <a
                href={`/staff/messages?conversation=${conv.id}`}
                className="text-xs text-primary hover:underline"
              >
                Open
              </a>
            </div>
            <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
              {convMessages.length === 0 && (
                <p className="text-xs text-muted-foreground">No messages.</p>
              )}
              {convMessages.map((m) => {
                const out = m.direction === "outbound";
                return (
                  <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${out ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className={`text-[10px] mt-0.5 ${out ? "opacity-80" : "text-muted-foreground"}`}>
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
