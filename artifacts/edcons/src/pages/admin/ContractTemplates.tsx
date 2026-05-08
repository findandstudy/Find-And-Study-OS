import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import { FileText, Plus, Edit, Trash2, Loader2 } from "lucide-react";

type Template = {
  id: number;
  name: string;
  language: string;
  entityType: "company" | "individual";
  version: number;
  bodyHtml: string;
  intakeSchema: any;
  isActive: boolean;
  updatedAt: string;
};

type IntakeField = { key: string; label: string; type: "text" | "email" | "date" | "textarea"; required?: boolean };

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "fr", label: "Français" },
  { code: "ru", label: "Русский" },
];

const STARTER_BODY = `<h1>Service Agreement</h1>
<p>This Service Agreement is made on {{contract.date}} between Find &amp; Study and {{agent.businessName}}.</p>
<h2>1. Parties</h2>
<p><strong>Agent:</strong> {{agent.firstName}} {{agent.lastName}} — {{agent.businessName}}</p>
<p><strong>Email:</strong> {{agent.email}}</p>
<p><strong>Country:</strong> {{agent.country}}</p>
<p><strong>Tax number:</strong> {{agent.taxNumber}}</p>
<h2>2. Scope</h2>
<p>The Agent agrees to provide student recruitment services in accordance with the standard terms.</p>
<h2>3. Signature</h2>
<p>Signed by {{contract.signerName}} ({{contract.signerEmail}}) on {{contract.date}}.</p>`;

const STARTER_INTAKE: IntakeField[] = [
  { key: "fullName", label: "Full Name", type: "text", required: true },
  { key: "companyName", label: "Company / Trade Name", type: "text" },
  { key: "taxNumber", label: "Tax Number", type: "text" },
  { key: "address", label: "Address", type: "textarea" },
];

export default function ContractTemplatesPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    language: "en",
    entityType: "company" as "company" | "individual",
    version: 1,
    bodyHtml: STARTER_BODY,
    intakeSchema: STARTER_INTAKE,
    isActive: true,
  });

  async function load() {
    setLoading(true);
    try {
      const res: any = await customFetch(`/api/contract-templates`);
      setRows(res.data || []);
    } catch (err: any) {
      toast({ title: t("contractTemplates.error"), description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm({
      name: "", language: "en", entityType: "company", version: 1,
      bodyHtml: STARTER_BODY, intakeSchema: STARTER_INTAKE, isActive: true,
    });
    setShowDialog(true);
  }

  function openEdit(t: Template) {
    setEditing(t);
    setForm({
      name: t.name,
      language: t.language,
      entityType: t.entityType,
      version: t.version,
      bodyHtml: t.bodyHtml,
      intakeSchema: Array.isArray(t.intakeSchema) ? t.intakeSchema : STARTER_INTAKE,
      isActive: t.isActive,
    });
    setShowDialog(true);
  }

  async function save() {
    if (!form.name.trim()) { toast({ title: t("contractTemplates.nameRequired"), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = JSON.stringify(form);
      if (editing) {
        await customFetch(`/api/contract-templates/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body });
      } else {
        await customFetch(`/api/contract-templates`, { method: "POST", headers: { "content-type": "application/json" }, body });
      }
      toast({ title: editing ? t("contractTemplates.updated") : t("contractTemplates.created") });
      setShowDialog(false);
      await load();
    } catch (err: any) {
      toast({ title: t("contractTemplates.error"), description: err.message, variant: "destructive" });
    }
    setSaving(false);
  }

  async function remove(id: number) {
    if (!confirm(t("contractTemplates.confirmDelete"))) return;
    try {
      await customFetch(`/api/contract-templates/${id}`, { method: "DELETE" });
      toast({ title: t("contractTemplates.deleted") });
      await load();
    } catch (err: any) {
      toast({ title: t("contractTemplates.error"), description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6" /> {t("contractTemplates.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("contractTemplates.subtitle")} <code className="text-xs">{`{{agent.field}}, {{intake.field}}, {{contract.date}}, {{contract.signerName}}`}</code></p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" /> {t("contractTemplates.newTemplate")}</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">{t("contractTemplates.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-3 font-medium">{t("contractTemplates.colName")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("contractTemplates.colLanguage")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("contractTemplates.colType")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("contractTemplates.colVersion")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("contractTemplates.colStatus")}</th>
                <th className="text-right px-4 py-3 font-medium">{t("contractTemplates.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(tpl => (
                <tr key={tpl.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{tpl.name}</td>
                  <td className="px-4 py-3 uppercase">{tpl.language}</td>
                  <td className="px-4 py-3">{tpl.entityType === "individual" ? t("contractTemplates.entityIndividual") : t("contractTemplates.entityCompany")}</td>
                  <td className="px-4 py-3">v{tpl.version}</td>
                  <td className="px-4 py-3">{tpl.isActive ? <Badge>{t("contractTemplates.statusActive")}</Badge> : <Badge variant="secondary">{t("contractTemplates.statusInactive")}</Badge>}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(tpl)}><Edit className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(tpl.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("contractTemplates.editTemplate") : t("contractTemplates.newTemplate")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>{t("contractTemplates.colName")} *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>{t("contractTemplates.colLanguage")}</Label>
                  <Select value={form.language} onValueChange={v => setForm(f => ({ ...f, language: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("contractTemplates.colType")}</Label>
                  <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company">{t("contractTemplates.entityCompany")}</SelectItem>
                      <SelectItem value="individual">{t("contractTemplates.entityIndividual")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("contractTemplates.colVersion")}</Label>
                  <Input type="number" min={1} value={form.version} onChange={e => setForm(f => ({ ...f, version: parseInt(e.target.value, 10) || 1 }))} />
                </div>
              </div>
            </div>
            <div>
              <Label>{t("contractTemplates.bodyLabel")}</Label>
              <Textarea
                rows={14}
                value={form.bodyHtml}
                onChange={e => setForm(f => ({ ...f, bodyHtml: e.target.value }))}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label>{t("contractTemplates.intakeSchemaLabel")}</Label>
              <Textarea
                rows={6}
                value={JSON.stringify(form.intakeSchema, null, 2)}
                onChange={e => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    if (Array.isArray(parsed)) setForm(f => ({ ...f, intakeSchema: parsed }));
                  } catch {
                    // ignore parse errors during typing
                  }
                }}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("contractTemplates.intakeSchemaHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <input id="isActive" type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
              <Label htmlFor="isActive">{t("contractTemplates.statusActive")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>{t("contractTemplates.cancel")}</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} {t("contractTemplates.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
