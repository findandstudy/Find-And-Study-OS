import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
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

export default function ContractsPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [signed, setSigned] = useState<Signed[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"sessions" | "signed">("sessions");

  const [showSendDialog, setShowSendDialog] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [sending, setSending] = useState(false);

  const STATUS_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
    intake_pending: { label: t("contracts.statusIntakePending"), tone: "secondary" },
    review_pending: { label: t("contracts.statusReviewPending"), tone: "default" },
    signed: { label: t("contracts.statusSigned"), tone: "outline" },
    revoked: { label: t("contracts.statusRevoked"), tone: "destructive" },
    expired: { label: t("contracts.statusExpired"), tone: "destructive" },
  };

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
      toast({ title: t("contracts.error"), description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function send() {
    const aid = parseInt(agentId, 10);
    if (!aid) { toast({ title: t("contracts.selectAgent"), variant: "destructive" }); return; }
    setSending(true);
    try {
      const res: any = await customFetch(`/api/contracts/admin-send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: aid, language: language || undefined }),
      });
      toast({ title: t("contracts.sentTitle"), description: t("contracts.sentDesc", { url: res.data?.signUrl }) });
      setShowSendDialog(false);
      setAgentId(""); setLanguage("");
      await load();
    } catch (err: any) {
      toast({ title: t("contracts.error"), description: err.message, variant: "destructive" });
    }
    setSending(false);
  }

  async function revoke(id: number) {
    if (!confirm(t("contracts.confirmRevoke"))) return;
    try {
      await customFetch(`/api/contracts/sessions/${id}/revoke`, { method: "POST" });
      toast({ title: t("contracts.revokedTitle") });
      await load();
    } catch (err: any) { toast({ title: t("contracts.error"), description: err.message, variant: "destructive" }); }
  }
  async function resendOnboarding(agentId: number) {
    if (!confirm(t("contracts.confirmResendOnboarding"))) return;
    try {
      const res: any = await customFetch(`/api/contracts/agent/${agentId}/resend-onboarding`, { method: "POST" });
      toast({ title: t("contracts.onboardingResentTitle"), description: t("contracts.onboardingResentDesc", { date: new Date(res.data?.expiresAt).toLocaleString() }) });
      await load();
    } catch (err: any) { toast({ title: t("contracts.error"), description: err.message, variant: "destructive" }); }
  }
  async function resend(id: number) {
    try {
      const res: any = await customFetch(`/api/contracts/sessions/${id}/resend`, { method: "POST" });
      toast({ title: t("contracts.resentTitle"), description: t("contracts.sentDesc", { url: res.data?.signUrl }) });
      await load();
    } catch (err: any) { toast({ title: t("contracts.error"), description: err.message, variant: "destructive" }); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileSignature className="w-6 h-6" /> {t("contracts.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("contracts.subtitle")}</p>
        </div>
        <Button onClick={() => setShowSendDialog(true)}><Send className="w-4 h-4 mr-2" /> {t("contracts.sendSigningRequest")}</Button>
      </div>

      <div className="flex gap-2 border-b">
        <button onClick={() => setTab("sessions")} className={`px-4 py-2 text-sm font-medium ${tab === "sessions" ? "border-b-2 border-primary" : "text-muted-foreground"}`}>
          {t("contracts.tabSessions")} ({sessions.length})
        </button>
        <button onClick={() => setTab("signed")} className={`px-4 py-2 text-sm font-medium ${tab === "signed" ? "border-b-2 border-primary" : "text-muted-foreground"}`}>
          {t("contracts.tabSigned")} ({signed.length})
        </button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : tab === "sessions" ? (
          sessions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">{t("contracts.noSessions")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-3">{t("contracts.colSigner")}</th>
                  <th className="text-left px-4 py-3">{t("contracts.colStatus")}</th>
                  <th className="text-left px-4 py-3">{t("contracts.colOpened")}</th>
                  <th className="text-left px-4 py-3">{t("contracts.colExpires")}</th>
                  <th className="text-right px-4 py-3">{t("contracts.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium flex items-center gap-2">
                        {s.signerName || "-"}
                        {s.isPrimaryOnboarding && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t("contracts.onboarding")}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.signerEmail}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant={STATUS_LABELS[s.status]?.tone}>{STATUS_LABELS[s.status]?.label || s.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.openedAt ? new Date(s.openedAt).toLocaleString() : "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {s.status !== "signed" && s.status !== "revoked" && (
                        <>
                          <Button size="sm" variant="ghost" title={t("contracts.actionResend")} onClick={() => resend(s.id)}><RotateCw className="w-4 h-4" /></Button>
                          <Button size="sm" variant="ghost" title={t("contracts.actionRevoke")} onClick={() => revoke(s.id)}><Ban className="w-4 h-4 text-red-500" /></Button>
                        </>
                      )}
                      {s.isPrimaryOnboarding && (s.status === "expired" || s.status === "revoked") && s.agentId && (
                        <Button size="sm" variant="outline" title={t("contracts.actionResendOnboarding")} onClick={() => resendOnboarding(s.agentId!)}>
                          <RotateCw className="w-3.5 h-3.5 mr-1" /> {t("contracts.resendOnboardingShort")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : signed.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">{t("contracts.noSigned")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3">{t("contracts.colSigner")}</th>
                <th className="text-left px-4 py-3">{t("contracts.colDate")}</th>
                <th className="text-left px-4 py-3">{t("contracts.colEvidenceHash")}</th>
                <th className="text-right px-4 py-3">{t("contracts.colPdf")}</th>
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
          <DialogHeader><DialogTitle>{t("contracts.sendSigningRequest")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("contracts.agent")} *</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder={t("contracts.selectAgentPlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {agents.filter(a => a.email).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {(a.businessName || `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email)} — {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{t("contracts.templateAutoHint")}</p>
            </div>
            <div>
              <Label>{t("contracts.languageOptional")}</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue placeholder={t("contracts.languageAuto")} /></SelectTrigger>
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
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>{t("contracts.cancel")}</Button>
            <Button onClick={send} disabled={sending || !agentId}>{sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />} {t("contracts.send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
