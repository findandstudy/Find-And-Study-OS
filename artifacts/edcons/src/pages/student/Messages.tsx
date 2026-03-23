import { useState, useRef, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, ArrowLeft, Loader2, User, Paperclip, FileText, X, Download } from "lucide-react";
import { useLocation } from "wouter";

function getInitials(first?: string | null, last?: string | null) {
  return `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase() || "?";
}

export default function StudentMessages() {
  const { user } = useAuth(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: advisor, isLoading: advisorLoading } = useQuery<any>({
    queryKey: ["my-advisor"],
    queryFn: async () => {
      try { return await customFetch("/api/students/my-advisor"); } catch { return null; }
    },
    enabled: !!user,
  });

  const { data: conversationsResp } = useQuery<any>({
    queryKey: ["student-conversations"],
    queryFn: () => customFetch("/api/student/conversations"),
    enabled: !!user,
  });

  const allConversations: any[] = conversationsResp?.data || [];
  const conversations = advisor
    ? allConversations.filter((c: any) =>
        c.participants?.some((p: any) => p.userId === advisor.id)
      )
    : [];

  useEffect(() => {
    if (conversations.length > 0 && !conversationId) {
      setConversationId(conversations[0].id);
    }
  }, [conversations, conversationId]);

  const { data: messagesResp, isLoading: msgsLoading } = useQuery<any>({
    queryKey: ["student-messages", conversationId],
    queryFn: () => customFetch(`/api/student/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    refetchInterval: 5000,
  });

  const msgs: any[] = messagesResp?.data || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  const uploadFile = async (file: File) => {
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
      return { fileName: file.name, fileUrl: `/api/storage${objectPath}`, fileType: file.type, fileSize: file.size };
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const sendMutation = useMutation({
    mutationFn: (payload: { content: string; metadata?: any }) =>
      customFetch(`/api/student/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setMessage("");
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["student-messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["student-conversations"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  async function startConversation() {
    if (!advisor) return;
    setStarting(true);
    try {
      const conv = await customFetch("/api/student/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setConversationId(conv.id);
      await qc.invalidateQueries({ queryKey: ["student-conversations"] });
    } catch (err: any) {
      toast({ title: "Could not start conversation", description: err.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  async function handleSend() {
    if ((!message.trim() && !pendingFile) || !conversationId) return;
    let metadata: any;
    if (pendingFile) {
      const att = await uploadFile(pendingFile);
      if (!att) return;
      metadata = { attachment: att };
    }
    sendMutation.mutate({ content: message.trim() || "", metadata });
  }

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

  const isImageType = (type: string) => type.startsWith("image/");

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

  const hasConversation = !!conversationId;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setLocation("/student")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-display font-bold text-2xl">Messages</h1>
            {advisor && (
              <p className="text-sm text-muted-foreground">
                Conversation with {advisor.firstName} {advisor.lastName}
              </p>
            )}
          </div>
        </div>

        <Card className="border-none shadow-lg shadow-black/5 flex flex-col" style={{ height: "calc(100vh - 220px)" }}>
          {advisorLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : !advisor ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <User className="w-16 h-16 mb-4 opacity-20" />
              <p className="font-display font-bold text-lg text-foreground">No Advisor Assigned</p>
              <p className="text-sm mt-1">An advisor will be assigned to you soon. You'll be able to message them here.</p>
            </div>
          ) : !hasConversation && conversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl shadow-lg mb-6">
                {getInitials(advisor.firstName, advisor.lastName)}
              </div>
              <p className="font-display font-bold text-lg text-foreground">{advisor.firstName} {advisor.lastName}</p>
              <p className="text-sm text-muted-foreground mt-1 mb-6">Start a conversation with your advisor</p>
              <Button
                className="rounded-xl gap-2 px-8 bg-gradient-to-r from-primary to-accent hover:opacity-90"
                onClick={startConversation}
                disabled={starting}
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Start Conversation
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 border-b">
                {advisor.avatarUrl ? (
                  <img src={advisor.avatarUrl} alt="" className="w-10 h-10 rounded-xl object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-bold text-sm">
                    {getInitials(advisor.firstName, advisor.lastName)}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-sm">{advisor.firstName} {advisor.lastName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{advisor.role?.replace(/_/g, " ")}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : msgs.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No messages yet. Say hello to your advisor!</p>
                  </div>
                ) : (
                  msgs.map((msg: any) => {
                    const isMe = msg.senderId === user?.id;
                    const att = msg.metadata?.attachment;
                    const hasTextContent = msg.content && !msg.content.startsWith("\u{1F4CE}");
                    return (
                      <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                          isMe
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-secondary text-foreground rounded-bl-md"
                        }`}>
                          {att && isImageType(att.fileType) && (
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
                          {att && !isImageType(att.fileType) && (
                            <button
                              onClick={() => handleDownload(att.fileUrl, att.fileName)}
                              className={`flex items-center gap-2 p-2 rounded-lg mb-1 w-full text-left ${isMe ? "bg-white/10 hover:bg-white/20" : "bg-background hover:bg-background/80"} transition-colors`}
                            >
                              <FileText className="w-5 h-5 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">{att.fileName}</p>
                                <p className={`text-[10px] ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>{formatFileSize(att.fileSize)}</p>
                              </div>
                              <Download className={`w-4 h-4 shrink-0 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`} />
                            </button>
                          )}
                          {hasTextContent && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                          <p className={`text-[10px] mt-1 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-4 border-t">
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
                <form
                  className="flex gap-2"
                  onSubmit={e => { e.preventDefault(); handleSend(); }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-xl shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sendMutation.isPending || uploading}
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <Input
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-xl"
                    disabled={sendMutation.isPending || uploading}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="rounded-xl shrink-0"
                    disabled={(!message.trim() && !pendingFile) || sendMutation.isPending || uploading}
                  >
                    {(sendMutation.isPending || uploading) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </form>
              </div>
            </>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
