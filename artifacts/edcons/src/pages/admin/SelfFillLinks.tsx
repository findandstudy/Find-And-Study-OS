import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link2, Loader2, Plus, RotateCw, Ban, Copy } from "lucide-react";

type Session = {
  id: number; templateId: number; agentId: number | null; mode: string; status: string;
  signerEmail: string; signerName: string | null; expiresAt: string;
  openedAt: string | null; signedAt: string | null; revokedAt: string | null; createdAt: string;
};

const STATUS_LABELS: Record<string, { label: string; tone: any }> = {
  intake_pending: { label: "Bilgi bekleniyor", tone: "secondary" },
  review_pending: { label: "İmza bekleniyor", tone: "default" },
  signed: { label: "İmzalandı", tone: "outline" },
  revoked: { label: "İptal edildi", tone: "destructive" },
};

export default function SelfFillLinksPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ signerEmail: "", signerName: "", language: "en", entityType: "company" as "company" | "individual" });
  const [lastUrl, setLastUrl] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res: any = await customFetch(`/api/contracts/sessions?mode=self_fill`);
      setRows(res.data || []);
    } catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.signerEmail.trim()) { toast({ title: "E-posta gerekli", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const res: any = await customFetch(`/api/contracts/self-fill-link`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setLastUrl(res.data?.signUrl || "");
      toast({ title: "Bağlantı oluşturuldu" });
      setForm({ signerEmail: "", signerName: "", language: "en", entityType: "company" });
      await load();
    } catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
    setCreating(false);
  }

  async function revoke(id: number) {
    if (!confirm("Bu bağlantı iptal edilsin mi?")) return;
    try { await customFetch(`/api/contracts/sessions/${id}/revoke`, { method: "POST" }); await load(); }
    catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
  }
  async function resend(id: number) {
    try { const res: any = await customFetch(`/api/contracts/sessions/${id}/resend`, { method: "POST" }); toast({ title: "Yeniden gönderildi", description: res.data?.signUrl }); await load(); }
    catch (err: any) { toast({ title: "Hata", description: err.message, variant: "destructive" }); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Link2 className="w-6 h-6" /> Self-Fill Bağlantıları</h1>
          <p className="text-sm text-muted-foreground mt-1">Henüz sistemde olmayan kişilere kendileri doldurup imzalayacakları link gönderin.</p>
        </div>
        <Button onClick={() => setShowDialog(true)}><Plus className="w-4 h-4 mr-2" /> Yeni bağlantı</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Henüz bağlantı yok.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3">İmzalayan</th>
                <th className="text-left px-4 py-3">Durum</th>
                <th className="text-left px-4 py-3">Bitiş</th>
                <th className="text-right px-4 py-3">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.signerName || "-"}</div>
                    <div className="text-xs text-muted-foreground">{s.signerEmail}</div>
                  </td>
                  <td className="px-4 py-3"><Badge variant={STATUS_LABELS[s.status]?.tone}>{STATUS_LABELS[s.status]?.label || s.status}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(s.expiresAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {s.status !== "signed" && s.status !== "revoked" && (
                      <>
                        <Button size="sm" variant="ghost" title="Yeniden gönder" onClick={() => resend(s.id)}><RotateCw className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" title="İptal et" onClick={() => revoke(s.id)}><Ban className="w-4 h-4 text-red-500" /></Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) setLastUrl(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yeni self-fill bağlantı</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>E-posta *</Label>
              <Input type="email" value={form.signerEmail} onChange={e => setForm(f => ({ ...f, signerEmail: e.target.value }))} />
            </div>
            <div>
              <Label>İsim (opsiyonel)</Label>
              <Input value={form.signerName} onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Dil</Label>
                <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="ru">Русский</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tip</Label>
                <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">Şirket</SelectItem>
                    <SelectItem value="individual">Bireysel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {lastUrl && (
              <div className="bg-muted/40 rounded-lg p-3 text-xs flex items-center gap-2">
                <Copy className="w-4 h-4 cursor-pointer" onClick={() => { navigator.clipboard.writeText(lastUrl); toast({ title: "Kopyalandı" }); }} />
                <span className="font-mono truncate">{lastUrl}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Kapat</Button>
            <Button onClick={create} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />} Oluştur ve gönder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
