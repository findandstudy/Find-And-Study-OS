import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, Phone, MessageSquare, Send, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type Channel = "email" | "whatsapp" | "internal";

const CHANNELS: { key: Channel; label: string; icon: typeof Mail; color: string }[] = [
  { key: "internal", label: "Internal", icon: MessageSquare, color: "bg-blue-500/10 text-blue-600 border-blue-200 hover:bg-blue-500/20" },
  { key: "email", label: "Email", icon: Mail, color: "bg-purple-500/10 text-purple-600 border-purple-200 hover:bg-purple-500/20" },
  { key: "whatsapp", label: "WhatsApp", icon: Phone, color: "bg-green-500/10 text-green-600 border-green-200 hover:bg-green-500/20" },
];

interface QuickContactProps {
  name: string;
  email?: string | null;
  phone?: string | null;
  entityType: "lead" | "student" | "agent" | "application";
  entityId: number;
}

export function QuickContactButtons({ name, email, phone, entityType, entityId }: QuickContactProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("internal");

  function openDialog(ch: Channel) {
    setChannel(ch);
    setDialogOpen(true);
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 gap-1 text-xs rounded-lg bg-blue-500/10 text-blue-600 border-blue-200 hover:bg-blue-500/20"
          onClick={() => openDialog("internal")}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Message</span>
        </Button>
        {email && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 gap-1 text-xs rounded-lg bg-purple-500/10 text-purple-600 border-purple-200 hover:bg-purple-500/20"
            onClick={() => openDialog("email")}
          >
            <Mail className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Email</span>
          </Button>
        )}
        {phone && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 gap-1 text-xs rounded-lg bg-green-500/10 text-green-600 border-green-200 hover:bg-green-500/20"
            onClick={() => openDialog("whatsapp")}
          >
            <Phone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">WhatsApp</span>
          </Button>
        )}
      </div>
      <QuickContactDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        channel={channel}
        setChannel={setChannel}
        name={name}
        email={email}
        phone={phone}
        entityType={entityType}
        entityId={entityId}
      />
    </>
  );
}

export function QuickContactDialog({
  open,
  onClose,
  channel,
  setChannel,
  name,
  email,
  phone,
  entityType,
  entityId,
}: {
  open: boolean;
  onClose: () => void;
  channel: Channel;
  setChannel: (ch: Channel) => void;
  name: string;
  email?: string | null;
  phone?: string | null;
  entityType: string;
  entityId: number;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);

  const channelMeta = CHANNELS.find(c => c.key === channel)!;

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const resp = await fetch(`${BASE}/api/quick-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel,
          recipientName: name,
          recipientEmail: email,
          recipientPhone: phone,
          subject: subject.trim() || undefined,
          message: message.trim(),
          entityType,
          entityId,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed to send" }));
        throw new Error(err.error || "Failed to send");
      }
      toast({ title: "Message sent", description: `${channelMeta.label} message sent to ${name}` });
      setMessage("");
      setSubject("");
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Send Message to {name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Channel</Label>
            <div className="flex gap-2">
              {CHANNELS.map(ch => {
                const disabled = (ch.key === "email" && !email) || (ch.key === "whatsapp" && !phone);
                return (
                  <Badge
                    key={ch.key}
                    variant="outline"
                    className={`cursor-pointer px-3 py-1.5 text-xs transition-all ${
                      channel === ch.key
                        ? ch.color + " ring-1 ring-offset-1"
                        : disabled
                        ? "opacity-30 cursor-not-allowed"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => { if (!disabled) setChannel(ch.key); }}
                  >
                    <ch.icon className="w-3.5 h-3.5 mr-1" />
                    {ch.label}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
            {channel === "email" && email && (
              <><Mail className="w-3.5 h-3.5" /> To: {email}</>
            )}
            {channel === "whatsapp" && phone && (
              <><Phone className="w-3.5 h-3.5" /> To: {phone}</>
            )}
            {channel === "internal" && (
              <><MessageSquare className="w-3.5 h-3.5" /> Internal message to {name}</>
            )}
          </div>

          {channel === "email" && (
            <div>
              <Label>Subject</Label>
              <Input
                className="mt-1"
                placeholder="Email subject..."
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
            </div>
          )}

          <div>
            <Label>Message</Label>
            <Textarea
              className="mt-1 min-h-[120px]"
              placeholder={`Type your ${channelMeta.label.toLowerCase()} message...`}
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSend(); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Ctrl+Enter to send</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || !message.trim()}>
            {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</> : <><Send className="w-4 h-4 mr-2" /> Send</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
