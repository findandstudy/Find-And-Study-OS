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
import { useI18n } from "@/hooks/use-i18n";
import { formatDateTime } from "@/lib/i18n";
import { Link2, Loader2, Plus, RotateCw, Ban, Copy, Pencil, Trash2 } from "lucide-react";

type Session = {
  id: number; templateId: number; agentId: number | null; mode: string; status: string;
  signerEmail: string; signerName: string | null; expiresAt: string;
  openedAt: string | null; signedAt: string | null; revokedAt: string | null; createdAt: string;
};

type Template = { id: number; name: string; language: string; entityType: string; version: number; isActive: boolean };

const LANG_LABELS: Record<string, string> = {
  en: "English", tr: "Türkçe", ar: "العربية", fr: "Français", ru: "Русский",
  es: "Español", fa: "فارسی", hi: "हिन्दी", id: "Bahasa", zh: "中文",
};

const STATUS_TONE: Record<string, any> = {
  intake_pending: "secondary",
  review_pending: "default",
  signed: "outline",
  revoked: "destructive",
};

// The server builds signUrl from its own resolved base URL, which can fall back
// to http://localhost:5000 when the deployment/domain env vars are not yet
// available at request time. For the link the admin copies/shares, always
// rebuild it against the domain the admin is actually browsing so it is never a
// non-working localhost link. Only the origin is swapped; the /sign/<token>
// path and query are preserved verbatim.
function toBrowserSignUrl(serverUrl?: string | null): string {
  if (!serverUrl) return "";
  try {
    const u = new URL(serverUrl);
    return `${window.location.origin}${u.pathname}${u.search}`;
  } catch {
    return serverUrl;
  }
}

export default function SelfFillLinksPage() {
  const { toast } = useToast();
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Session[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ signerEmail: "", signerName: "", templateId: "" });
  const [lastUrl, setLastUrl] = useState("");

  const [editSession, setEditSession] = useState<Session | null>(null);
  const [editForm, setEditForm] = useState({ signerName: "", signerEmail: "" });
  const [editSaving, setEditSaving] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res: any = await customFetch(`/api/contracts/sessions?mode=self_fill`);
      setRows(res.data || []);
      setSelected(new Set());
    } catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
    setLoading(false);
  }
  async function loadTemplates() {
    try {
      const res: any = await customFetch(`/api/contract-templates?isActive=true`);
      setTemplates(res.data || []);
    } catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
  }
  useEffect(() => { load(); loadTemplates(); }, []);

  async function create() {
    if (!form.templateId) { toast({ title: t("selfFill.selectTemplate"), variant: "destructive" }); return; }
    setCreating(true);
    try {
      const res: any = await customFetch(`/api/contracts/self-fill-link`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signerEmail: form.signerEmail, signerName: form.signerName, templateId: parseInt(form.templateId, 10) }),
      });
      setLastUrl(toBrowserSignUrl(res.data?.signUrl));
      toast({ title: t("selfFill.toast.linkCreated") });
      setForm({ signerEmail: "", signerName: "", templateId: "" });
      await load();
    } catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
    setCreating(false);
  }

  async function revoke(id: number) {
    if (!confirm(t("selfFill.confirmRevoke"))) return;
    try { await customFetch(`/api/contracts/sessions/${id}/revoke`, { method: "POST" }); await load(); }
    catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
  }
  async function resend(id: number) {
    try { const res: any = await customFetch(`/api/contracts/sessions/${id}/resend`, { method: "POST" }); toast({ title: t("selfFill.toast.resent"), description: toBrowserSignUrl(res.data?.signUrl) }); await load(); }
    catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
  }

  function openEdit(s: Session) {
    setEditSession(s);
    setEditForm({ signerName: s.signerName || "", signerEmail: s.signerEmail });
  }

  async function saveEdit() {
    if (!editSession) return;
    setEditSaving(true);
    try {
      await customFetch(`/api/contracts/sessions/${editSession.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ signerName: editForm.signerName, signerEmail: editForm.signerEmail }),
      });
      toast({ title: t("selfFill.toast.signerUpdated") });
      setEditSession(null);
      await load();
    } catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
    setEditSaving(false);
  }

  async function deleteSession(id: number) {
    if (!confirm(t("selfFill.confirmDelete"))) return;
    try {
      await customFetch(`/api/contracts/sessions/${id}`, { method: "DELETE" });
      toast({ title: t("selfFill.toast.deleted") });
      await load();
    } catch (err: any) { toast({ title: t("common.error"), description: err.message, variant: "destructive" }); }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const deletable = rows.filter(r => r.status !== "signed").map(r => r.id);
    if (deletable.every(id => selected.has(id)) && deletable.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deletable));
    }
  }

  async function bulkDelete() {
    if (!confirm(t("common.confirmBulkDelete", { n: selected.size }))) return;
    setBulkDeleting(true);
    let failed = 0;
    for (const id of Array.from(selected)) {
      try { await customFetch(`/api/contracts/sessions/${id}`, { method: "DELETE" }); }
      catch { failed++; }
    }
    if (failed > 0) toast({ title: t("common.error"), description: t("common.bulkDeletePartialFailure", { n: failed }), variant: "destructive" });
    else toast({ title: t("selfFill.toast.bulkDeleted") });
    setBulkDeleting(false);
    await load();
  }

  const deletable = rows.filter(r => r.status !== "signed");
  const allDeletableSelected = deletable.length > 0 && deletable.every(r => selected.has(r.id));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Link2 className="w-6 h-6" /> {t("selfFill.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("selfFill.subtitle")}</p>
        </div>
        <Button onClick={() => setShowDialog(true)}><Plus className="w-4 h-4 mr-2" /> {t("selfFill.newLink")}</Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/60 rounded-lg border">
          <span className="text-sm font-medium">{t("common.selectedCount", { n: selected.size })}</span>
          <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
            {t("common.deleteSelected", { n: selected.size })}
          </Button>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">{t("selfFill.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allDeletableSelected} onChange={toggleAll} className="cursor-pointer" title={t("common.selectAll")} />
                </th>
                <th className="text-left px-4 py-3">{t("selfFill.columns.signer")}</th>
                <th className="text-left px-4 py-3">{t("common.status")}</th>
                <th className="text-left px-4 py-3">{t("selfFill.columns.expires")}</th>
                <th className="text-right px-4 py-3">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-3">
                    {s.status !== "signed" ? (
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="cursor-pointer" />
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.signerName || "-"}</div>
                    <div className="text-xs text-muted-foreground">{s.signerEmail}</div>
                  </td>
                  <td className="px-4 py-3"><Badge variant={STATUS_TONE[s.status]}>{t(`selfFill.status.${s.status}`)}</Badge></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(lang, s.expiresAt)}</td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {s.status !== "signed" && s.status !== "revoked" && (
                      <>
                        <Button size="sm" variant="ghost" title={t("selfFill.actions.resend")} onClick={() => resend(s.id)}><RotateCw className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" title={t("selfFill.actions.revoke")} onClick={() => revoke(s.id)}><Ban className="w-4 h-4 text-red-500" /></Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" title={t("common.edit")} onClick={() => openEdit(s)} disabled={s.status === "signed"}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" title={t("common.delete")} onClick={() => deleteSession(s.id)} disabled={s.status === "signed"}>
                      <Trash2 className={`w-4 h-4 ${s.status !== "signed" ? "text-red-500" : "text-muted-foreground"}`} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) setLastUrl(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("selfFill.modalTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4 min-w-0">
            <div>
              <Label>{t("selfFill.fields.email")}</Label>
              <Input type="email" value={form.signerEmail} onChange={e => setForm(f => ({ ...f, signerEmail: e.target.value }))} />
            </div>
            <div>
              <Label>{t("selfFill.fields.name")}</Label>
              <Input value={form.signerName} onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))} />
            </div>
            <div>
              <Label>{t("selfFill.fields.template")}</Label>
              <Select value={form.templateId} onValueChange={v => setForm(f => ({ ...f, templateId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("selfFill.selectTemplate")} /></SelectTrigger>
                <SelectContent>
                  {templates.map(tpl => (
                    <SelectItem key={tpl.id} value={String(tpl.id)}>
                      {tpl.name} — {LANG_LABELS[tpl.language] || tpl.language} · {tpl.entityType === "individual" ? t("contractTemplates.entityIndividual") : t("contractTemplates.entityCompany")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {lastUrl && (
              <div className="bg-muted/40 rounded-lg p-3 text-xs flex items-center gap-2 min-w-0 overflow-hidden">
                <Copy className="w-4 h-4 shrink-0 cursor-pointer" onClick={() => { navigator.clipboard.writeText(lastUrl); toast({ title: t("common.copied") }); }} />
                <span className="font-mono truncate flex-1 min-w-0">{lastUrl}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>{t("common.close")}</Button>
            <Button onClick={create} disabled={creating}>{creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />} {t("selfFill.actions.createAndSend")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editSession} onOpenChange={o => { if (!o) setEditSession(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("selfFill.editSignerTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("selfFill.fields.name")}</Label>
              <Input value={editForm.signerName} onChange={e => setEditForm(f => ({ ...f, signerName: e.target.value }))} />
            </div>
            <div>
              <Label>{t("selfFill.fields.email")}</Label>
              <Input type="email" value={editForm.signerEmail} onChange={e => setEditForm(f => ({ ...f, signerEmail: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSession(null)}>{t("common.cancel")}</Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
