import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2, FileSignature, RotateCw, Ban, Download } from "lucide-react";

type Session = {
  id: number; templateId: number; agentId: number | null; mode: string; status: string;
  signerEmail: string; signerName: string | null; expiresAt: string;
  openedAt: string | null; signedAt: string | null; revokedAt: string | null; createdAt: string;
  isPrimaryOnboarding?: boolean;
};
type Signed = {
  id: number; signingSessionId: number; agentId: number | null; templateId: number;
  pdfObjectKey: string; evidenceHash: string; signerEmail: string; signerName: string | null; signedAt: string;
};
type Agent = { id: number; firstName: string | null; lastName: string | null; businessName: string | null; email: string | null; entityType?: string | null; preferredContractLanguage?: string | null };

const STATUS_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  intake_pending: { label: "Bilgi bekleniyor", tone: "secondary" },
  review_pending: { label: "İmza bekleniyor", tone: "default" },
  signed: { label: "İmzalandı", tone: "outline" },
  revoked: { label: "İptal edildi", tone: "destructive" },
  expired: { label: "Süresi doldu", tone: "destructive" },
};

export default function ContractsPage() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [signed, setSigned] = useState<Signed[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"sessions" | "signed">("sessions");

  const [showSendDialog, setShowSendDialog] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, sc, a]: any = await Promise.all([
        customFetch(`/api/contracts/sessions?mode=admin_driven`),
        customFetch(`/api/contracts/signed`),
        customFetch(`/api/agents`),
      ]);
      setSessions(s.data || []);
      setSigned(sc.data || []);
      setAgents(a.data || a.agents || []);
    } catch (err: any) {
      toast({ title: "Hata", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function send() {
    const aid = parseInt(agentId, 10);
    if (!aid) { toast({ title: "Acente seçin", variant: "destructive" }); return; }
    setSending(true);
    try {
      const res: any = await customFetch(`/api/contracts/admin-send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: aid, language: language || undefined }),
      });
      toast({ title: "Sözleşme gönderildi", description: `Bağlantı: ${res.data?.signUrl}` });
      setShowSendDialog(false);
      setAgentId(""); setLanguage("");
      await load();
    } catch (err: any) {
      toast({ title: "Hata", description: err.message, variant: "destructive" });
    }
    setSending(false);
  }

  async function revoke(id: number) {
    if (!confirm("Bu imza oturumu iptal edilsin mi?")) return;
    try {
      await customFetch(`/api/contracts/sessions/${id}/revoke`, { method: "POST" });
      toast({ title: "İptal edildi" });
      await load();
    } catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
  }
  async function resendOnboarding(agentId: number) {
    if (!confirm("Bu acente için yeni bir onboarding imza oturumu açılsın mı?")) return;
    try {
      const res: any = await customFetch(`/api/contracts/agent/${agentId}/resend-onboarding`, { method: "POST" });
      toast({ title: "Onboarding yeniden gönderildi", description: `Bitiş: ${new Date(res.data?.expiresAt).toLocaleString()}` });
      await load();
    } catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
  }
  async function resend(id: number) {
    try {
      const res: any = await customFetch(`/api/contracts/sessions/${id}/resend`, { method: "POST" });
      toast({ title: "Yeniden gönderildi", description: `Bağlantı: ${res.data?.signUrl}` });
      await load();
    } catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileSignature className="w-6 h-6" /> Sözleşmeler</h1>
          <p className="text-sm text-muted-foreground mt-1">Acente seç, dil ve şablon otomatik eşleşir, imza isteği e-posta ile gönderilir.</p>
        </div>
        <Button onClick={() => setShowSendDialog(true)}><Send className="w-4 h-4 mr-2" /> İmza isteği gönder</Button>
      </div>

      <div className="flex gap-2 border-b">
        <button onClick={() => setTab("sessions")} className={`px-4 py-2 text-sm font-medium ${tab === "sessions" ? "border-b-2 border-primary" : "text-muted-foreground"}`}>
          Oturumlar ({sessions.length})
        </button>
        <button onClick={() => setTab("signed")} className={`px-4 py-2 text-sm font-medium ${tab === "signed" ? "border-b-2 border-primary" : "text-muted-foreground"}`}>
          İmzalanmış ({signed.length})
        </button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : tab === "sessions" ? (
          sessions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">Henüz oturum yok.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-3">İmzalayan</th>
                  <th className="text-left px-4 py-3">Durum</th>
                  <th className="text-left px-4 py-3">Açıldı</th>
                  <th className="text-left px-4 py-3">Bitiş</th>
                  <th className="text-right px-4 py-3">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium flex items-center gap-2">
                        {s.signerName || "-"}
                        {s.isPrimaryOnboarding && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Onboarding</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.signerEmail}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant={STATUS_LABELS[s.status]?.tone}>{STATUS_LABELS[s.status]?.label || s.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.openedAt ? new Date(s.openedAt).toLocaleString() : "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {s.status !== "signed" && s.status !== "revoked" && (
                        <>
                          <Button size="sm" variant="ghost" title="Yeniden gönder" onClick={() => resend(s.id)}><RotateCw className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" title="İptal et" onClick={() => revoke(s.id)}><Ban className="w-4 h-4 text-red-500" /></Button>
                        </>
                      )}
                      {s.isPrimaryOnboarding && (s.status === "expired" || s.status === "revoked") && s.agentId && (
                        <Button size="sm" variant="outline" title="Onboarding sözleşmesini yeniden gönder" onClick={() => resendOnboarding(s.agentId!)}>
                          <RotateCw className="w-3.5 h-3.5 mr-1" /> Yeniden gönder (onboarding)
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : signed.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">İmzalanmış sözleşme yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3">İmzalayan</th>
                <th className="text-left px-4 py-3">Tarih</th>
                <th className="text-left px-4 py-3">Delil hash</th>
                <th className="text-right px-4 py-3">PDF</th>
              </tr>
            </thead>
            <tbody>
              {signed.map(c => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.signerName || "-"}</div>
                    <div className="text-xs text-muted-foreground">{c.signerEmail}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(c.signedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{c.evidenceHash.slice(0, 16)}…</td>
                  <td className="px-4 py-3 text-right">
                    <a href={`/api/contracts/signed/${c.id}/pdf`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="ghost"><Download className="w-4 h-4" /></Button>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>İmza isteği gönder</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Acente *</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Acente seç" /></SelectTrigger>
                <SelectContent>
                  {agents.filter(a => a.email).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {(a.businessName || `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email)} — {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Şablon otomatik olarak acentenin tipine ve diline göre seçilir.</p>
            </div>
            <div>
              <Label>Dil (opsiyonel — boş bırakılırsa acentenin tercihi)</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue placeholder="Otomatik" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="tr">Türkçe</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="ru">Русский</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>İptal</Button>
            <Button onClick={send} disabled={sending || !agentId}>{sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />} Gönder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
