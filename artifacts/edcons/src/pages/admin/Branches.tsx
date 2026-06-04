import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/use-i18n";
import {
  Building2, Plus, Edit, Archive, ArchiveRestore, Loader2, Save,
  Mail, Phone, MapPin, Upload, X, Image as ImageIcon, Search,
} from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type Branch = {
  id: number;
  name: string;
  country: string | null;
  city: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
};

type FormState = {
  name: string; country: string; city: string;
  contactName: string; contactEmail: string; contactPhone: string;
  logoUrl: string; notes: string;
};

const emptyForm: FormState = {
  name: "", country: "", city: "",
  contactName: "", contactEmail: "", contactPhone: "",
  logoUrl: "", notes: "",
};

export default function BranchesPage() {
  const { user } = useAuth(true);
  const { toast } = useToast();
  const { t } = useI18n();
  const isSuperAdmin = user?.role === "super_admin";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [stats, setStats] = useState<Record<number, { agents: number }>>({});
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function fetchBranches() {
    setLoading(true);
    try {
      const res: any = await customFetch(`/api/branches?archived=${showArchived ? "1" : "0"}`);
      setBranches(res.data || []);
    } catch (err: any) {
      toast({ title: t("branches.errorTitle"), description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  async function fetchStats() {
    if (!isSuperAdmin) return;
    try {
      const res: any = await customFetch(`/api/branches/stats`);
      setStats(res || {});
    } catch {}
  }

  useEffect(() => { fetchBranches(); }, [showArchived]);
  useEffect(() => { fetchStats(); }, [isSuperAdmin]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowDialog(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name,
      country: b.country || "",
      city: b.city || "",
      contactName: b.contactName || "",
      contactEmail: b.contactEmail || "",
      contactPhone: b.contactPhone || "",
      logoUrl: b.logoUrl || "",
      notes: b.notes || "",
    });
    setShowDialog(true);
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    try {
      const urlRes: any = await customFetch(`/api/storage/uploads/request-url`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.uploadURL) throw new Error(t("branches.uploadLinkFailed"));
      const putRes = await fetch(urlRes.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error(t("branches.uploadFailed"));
      const stripped = urlRes.objectPath.replace(/^\/objects/, "");
      const publicUrl = `${BASE_URL}/api/storage/objects${stripped}`;
      setForm(f => ({ ...f, logoUrl: publicUrl }));
      toast({ title: t("branches.logoUploaded") });
    } catch (err: any) {
      toast({ title: t("branches.uploadFailed"), description: err.message, variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: t("branches.nameRequired"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      country: form.country.trim() || null,
      city: form.city.trim() || null,
      contactName: form.contactName.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      logoUrl: form.logoUrl || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) {
        await customFetch(`/api/branches/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        toast({ title: t("branches.branchUpdated") });
      } else {
        await customFetch(`/api/branches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        toast({ title: t("branches.branchCreated") });
      }
      setShowDialog(false);
      fetchBranches();
      fetchStats();
    } catch (err: any) {
      toast({ title: t("branches.errorTitle"), description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(b: Branch) {
    const action = b.archivedAt ? t("branches.actionRestore") : t("branches.actionArchive");
    if (!confirm(t("branches.archiveConfirm", { name: b.name, action }))) return;
    try {
      await customFetch(`/api/branches/${b.id}/${b.archivedAt ? "unarchive" : "archive"}`, { method: "POST" });
      toast({ title: b.archivedAt ? t("branches.branchRestored") : t("branches.branchArchived") });
      fetchBranches();
    } catch (err: any) {
      toast({ title: t("branches.errorTitle"), description: err.message, variant: "destructive" });
    }
  }

  const filtered = branches.filter(b =>
    !search.trim() ||
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.city || "").toLowerCase().includes(search.toLowerCase()) ||
    (b.country || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">{t("branches.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("branches.subtitle")}
          </p>
        </div>
        {isSuperAdmin && (
          <Button onClick={openCreate} className="rounded-xl gap-2">
            <Plus className="w-4 h-4" /> {t("branches.newBranch")}
          </Button>
        )}
      </div>

      <Card className="border-none shadow-lg shadow-black/5 p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t("branches.searchPlaceholder")} value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant={showArchived ? "secondary" : "outline"} size="sm" onClick={() => setShowArchived(s => !s)} className="rounded-xl">
              {showArchived ? t("branches.hideArchived") : t("branches.showArchived")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Building2 className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">
              {showArchived ? t("branches.emptyArchived") : t("branches.emptyActive")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(b => {
              const archived = !!b.archivedAt;
              const agentCount = stats[b.id]?.agents ?? 0;
              return (
                <Card key={b.id} className={`p-5 border ${archived ? "opacity-60" : ""}`}>
                  <div className="flex items-start gap-3 mb-3">
                    {b.logoUrl ? (
                      <img src={b.logoUrl} alt={b.name} className="w-12 h-12 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center">
                        <Building2 className="w-6 h-6 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display font-bold text-base truncate">{b.name}</h3>
                        {archived && <Badge variant="outline" className="text-xs">{t("branches.archivedBadge")}</Badge>}
                      </div>
                      {(b.city || b.country) && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          {b.country && <CountryFlag code={b.country} size="sm" />}
                          <span>{[b.city, b.country].filter(Boolean).join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground mb-3 min-h-[3.5rem]">
                    {b.contactName && <p className="font-medium text-foreground">{b.contactName}</p>}
                    {b.contactEmail && <p className="flex items-center gap-1.5"><Mail className="w-3 h-3" /> {b.contactEmail}</p>}
                    {b.contactPhone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> {b.contactPhone}</p>}
                    {!b.contactName && !b.contactEmail && !b.contactPhone && (
                      <p className="italic">{t("branches.noContactInfo")}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border/50">
                    <Badge variant="secondary" className="text-xs">{t("branches.agentCount", { count: agentCount })}</Badge>
                    {isSuperAdmin && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => openEdit(b)} title={t("branches.edit")}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => handleArchive(b)}
                          title={archived ? t("branches.restore") : t("branches.archive")}>
                          {archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("branches.editDialogTitle") : t("branches.newBranch")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-semibold">{t("branches.branchNameLabel")}</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("branches.branchNamePlaceholder")} className="rounded-xl mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-semibold">{t("branches.countryLabel")}</Label>
                <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder={t("branches.countryPlaceholder")} className="rounded-xl mt-1.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">{t("branches.cityLabel")}</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder={t("branches.cityPlaceholder")} className="rounded-xl mt-1.5" />
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">{t("branches.contactNameLabel")}</Label>
              <Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} className="rounded-xl mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-semibold">{t("branches.emailLabel")}</Label>
                <Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} className="rounded-xl mt-1.5" />
              </div>
              <div>
                <Label className="text-sm font-semibold">{t("branches.phoneLabel")}</Label>
                <Input value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} className="rounded-xl mt-1.5" />
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">{t("branches.logoLabel")}</Label>
              <div className="flex items-center gap-3 mt-1.5">
                {form.logoUrl ? (
                  <div className="relative">
                    <img src={form.logoUrl} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-border" />
                    <button type="button" onClick={() => setForm(f => ({ ...f, logoUrl: "" }))}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-secondary/40 border border-dashed border-border flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" disabled={logoUploading}
                  onClick={() => logoInputRef.current?.click()} className="rounded-xl gap-2">
                  {logoUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {logoUploading ? t("branches.uploading") : t("branches.uploadLogo")}
                </Button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold">{t("branches.notesLabel")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="rounded-xl mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} className="rounded-xl">{t("branches.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving} className="rounded-xl gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("branches.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
