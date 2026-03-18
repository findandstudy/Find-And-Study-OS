import { useState, useEffect, useRef, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  MessageSquare, Smartphone, Hash, ArrowLeft, Paperclip, ChevronDown
} from "lucide-react";

interface Conversation {
  id: number;
  type: string;
  title: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  participants: Array<{ userId: number; firstName: string; lastName: string; avatarUrl: string | null; role: string }>;
  unreadCount: number;
}

interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  content: string;
  channel: string;
  status: string;
  createdAt: string;
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
};

const channelColor: Record<string, string> = {
  internal: "bg-blue-500/10 text-blue-600",
  whatsapp: "bg-green-500/10 text-green-600",
  telegram: "bg-sky-500/10 text-sky-600",
  email: "bg-purple-500/10 text-purple-600",
  sms: "bg-amber-500/10 text-amber-600",
};

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
            const isSelected = conv.id === selectedId;

            return (
              <div
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-border/30 transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-secondary/50"}`}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center font-bold text-xs text-foreground shrink-0">
                  {initials}
                </div>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

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

  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await customFetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMessage.trim(), channel }),
      });
      setNewMessage("");
      fetchMessages();
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const others = participants.filter(p => p.userId !== user?.id);
  const threadTitle = others.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Conversation";

  const ChannelIcon = channelIcon[channel] || MessageSquare;

  return (
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
            return (
              <div key={msg.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                {!isMe && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary/30 to-accent/30 flex items-center justify-center text-xs font-bold shrink-0">
                    {initials}
                  </div>
                )}
                <div className={`max-w-[70%] ${isMe ? "items-end" : ""}`}>
                  {!isMe && (
                    <p className="text-xs text-muted-foreground mb-1">{msg.senderFirstName} {msg.senderLastName}</p>
                  )}
                  <div className={`rounded-2xl px-4 py-2.5 ${isMe ? "bg-primary text-white rounded-tr-sm" : "bg-secondary rounded-tl-sm"}`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-xl"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          />
          <Button onClick={sendMessage} disabled={sending || !newMessage.trim()} className="rounded-xl gap-1.5">
            <Send className="w-4 h-4" /> Send
          </Button>
        </div>
      </div>
    </div>
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
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold text-foreground">Communication Center</h1>

        <Tabs defaultValue="messages" className="space-y-4">
          <TabsList className="h-10">
            <TabsTrigger value="messages" className="gap-2 px-4">
              <MessageCircle className="w-4 h-4" /> Messages
            </TabsTrigger>
            {canBroadcast && (
              <TabsTrigger value="broadcast" className="gap-2 px-4">
                <Megaphone className="w-4 h-4" /> Broadcast
              </TabsTrigger>
            )}
          </TabsList>

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
    </DashboardLayout>
  );
}
