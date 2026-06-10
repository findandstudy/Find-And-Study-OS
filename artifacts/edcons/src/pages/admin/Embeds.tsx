import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle
} from "@/components/ui/card";
import {
  Tabs, TabsContent, TabsList, TabsTrigger
} from "@/components/ui/tabs";
import {
  Plus, Copy, Trash2, Edit2, Eye, Code2, ExternalLink, Globe, ChevronLeft, ChevronRight, FileText
} from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { ExportImportToolbar } from "@/components/admin/ExportImportToolbar";

const BASE_URL = import.meta.env.BASE_URL || "/";
const API_BASE = `${BASE_URL}api`.replace(/\/+/g, "/");

const FILTER_KEYS = ["country", "city", "universityType", "universityId", "level", "language", "field"];

type Widget = {
  id: number;
  name: string;
  slug: string;
  mode: string;
  presetFilters: Record<string, any>;
  lockedFilters: string[];
  hiddenFilters: string[];
  visibleFilters: string[];
  theme: Record<string, any>;
  allowedDomains: string[];
  embedApiKey?: string | null;
  isActive: boolean;
  createdAt: string;
};

type Submission = {
  id: number;
  widgetId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality: string;
  desiredLevel: string;
  desiredProgram: string;
  preferredUniversity: string;
  message: string;
  programName: string;
  universityName: string;
  sourceWebsite: string;
  sourcePageUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  status: string;
  createdAt: string;
};

export default function Embeds() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [subPage, setSubPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<Widget | null>(null);
  const [codeDialog, setCodeDialog] = useState<Widget | null>(null);
  const [viewWidget, setViewWidget] = useState<Widget | null>(null);
  const [subTab, setSubTab] = useState<string>("submissions");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  function toggleSelect(id: number) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  const { data: widgetsRes, isLoading } = useQuery({
    queryKey: ["embed-widgets", page],
    queryFn: () => customFetch<any>(`/api/embed/widgets?page=${page}&limit=20`),
  });

  const widgets = widgetsRes?.data || [];
  const meta = widgetsRes?.meta || { total: 0, page: 1, totalPages: 1 };

  const { data: subsRes } = useQuery({
    queryKey: ["embed-submissions", viewWidget?.id, subPage],
    queryFn: () => customFetch<any>(`/api/embed/widgets/${viewWidget!.id}/submissions?page=${subPage}&limit=20`),
    enabled: !!viewWidget,
  });
  const submissions: Submission[] = subsRes?.data || [];
  const subMeta = subsRes?.meta || { total: 0, page: 1, totalPages: 1 };

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("adminEmbeds.title")}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t("adminEmbeds.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportImportToolbar
              exportPath="/api/embed/widgets/export"
              importPath="/api/embed/widgets/import"
              templatePath="/api/embed/widgets/template"
              downloadName="embed-widgets"
              selectedIds={selectedIds}
              onImported={() => { qc.invalidateQueries({ queryKey: ["embed-widgets"] }); setSelectedIds([]); }}
            />
            <Button onClick={() => { setEditWidget(null); setDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> New Widget
            </Button>
          </div>
        </div>

        {viewWidget ? (
          <WidgetDetail
            widget={viewWidget}
            submissions={submissions}
            subMeta={subMeta}
            subPage={subPage}
            setSubPage={setSubPage}
            onBack={() => { setViewWidget(null); setSubPage(1); }}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Widgets ({meta.total})</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                </div>
              ) : widgets.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Code2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No widgets yet</p>
                  <p className="text-sm">Create your first embeddable widget to get started</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={widgets.length > 0 && widgets.every((w: Widget) => selectedIds.includes(w.id))}
                            onCheckedChange={(c) => setSelectedIds(c ? widgets.map((w: Widget) => w.id) : [])}
                            aria-label="Select all"
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Slug</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Preset Filters</TableHead>
                        <TableHead>Domains</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {widgets.map((w: Widget) => (
                        <TableRow key={w.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.includes(w.id)}
                              onCheckedChange={() => toggleSelect(w.id)}
                              aria-label={`Select ${w.name}`}
                              data-testid={`checkbox-widget-${w.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{w.name}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{w.slug}</code>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">{w.mode.replace("_", " ")}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(w.presetFilters || {}).map(([k, v]) => (
                                <Badge key={k} variant="secondary" className="text-xs">
                                  {k}: {String(v)}
                                </Badge>
                              ))}
                              {Object.keys(w.presetFilters || {}).length === 0 && (
                                <span className="text-xs text-muted-foreground">None</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {(w.allowedDomains as string[])?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {(w.allowedDomains as string[]).map((d: string) => (
                                  <Badge key={d} variant="outline" className="text-xs">
                                    <Globe className="w-3 h-3 mr-1" />{d}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">All domains</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={w.isActive ? "default" : "secondary"}>
                              {w.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" title="View submissions"
                                onClick={() => { setViewWidget(w); setSubPage(1); }}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Embed code"
                                onClick={() => setCodeDialog(w)}>
                                <Code2 className="w-4 h-4" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Edit"
                                onClick={() => { setEditWidget(w); setDialogOpen(true); }}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <DeleteWidgetBtn id={w.id} name={w.name} onDone={() => qc.invalidateQueries({ queryKey: ["embed-widgets"] })} />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {meta.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">Page {meta.page} of {meta.totalPages}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <WidgetFormDialog
          open={dialogOpen}
          onClose={() => { setDialogOpen(false); setEditWidget(null); }}
          widget={editWidget}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["embed-widgets"] }); setDialogOpen(false); setEditWidget(null); }}
        />

        {codeDialog && (
          <EmbedCodeDialog widget={codeDialog} onClose={() => setCodeDialog(null)} />
        )}
      </div>
  );
}

function WidgetDetail({ widget, submissions, subMeta, subPage, setSubPage, onBack }: {
  widget: Widget;
  submissions: Submission[];
  subMeta: any;
  subPage: number;
  setSubPage: (p: number | ((p: number) => number)) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div>
          <h2 className="text-lg font-bold">{widget.name}</h2>
          <p className="text-xs text-muted-foreground">Submissions from <code>{widget.slug}</code> widget</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {submissions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No submissions yet</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Program / University</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell className="font-medium">{s.firstName} {s.lastName}</TableCell>
                        <TableCell className="text-sm">{s.email}</TableCell>
                        <TableCell className="text-sm">{s.phone || "-"}</TableCell>
                        <TableCell>
                          <div className="text-sm">{s.programName || s.desiredProgram || "-"}</div>
                          {(s.universityName || s.preferredUniversity) && (
                            <div className="text-xs text-muted-foreground">{s.universityName || s.preferredUniversity}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-xs max-w-[200px] truncate" title={s.sourcePageUrl || ""}>
                            {s.sourceWebsite || "-"}
                          </div>
                          {s.utmSource && <Badge variant="outline" className="text-xs mt-0.5">{s.utmSource}</Badge>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={s.status === "new" ? "default" : "secondary"}>{s.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {subMeta.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">Page {subMeta.page} of {subMeta.totalPages} ({subMeta.total} total)</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={subPage <= 1} onClick={() => setSubPage((p: number) => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={subPage >= subMeta.totalPages} onClick={() => setSubPage((p: number) => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WidgetFormDialog({ open, onClose, widget, onSaved }: {
  open: boolean;
  onClose: () => void;
  widget: Widget | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [mode, setMode] = useState("combined");
  const [presetCountry, setPresetCountry] = useState("");
  const [presetCity, setPresetCity] = useState("");
  const [presetUniversityType, setPresetUniversityType] = useState("");
  const [presetUniversityId, setPresetUniversityId] = useState("");
  const [presetLevel, setPresetLevel] = useState("");
  const [presetLanguage, setPresetLanguage] = useState("");
  const [presetField, setPresetField] = useState("");

  const { data: filterOptions } = useQuery({
    queryKey: ["course-finder-filters"],
    queryFn: () => customFetch("/api/course-finder/filters") as Promise<{
      countries: string[];
      cities: string[];
      universityTypes: string[];
      universities: { id: number; name: string }[];
      degrees: string[];
      languages: string[];
      fields: string[];
    }>,
    staleTime: 5 * 60 * 1000,
  });
  const [locked, setLocked] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [domains, setDomains] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [buttonColor, setButtonColor] = useState("#2563eb");
  const [borderRadius, setBorderRadius] = useState("8px");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const isEdit = !!widget;

  useEffect(() => {
    if (!open) return;
    if (widget) {
      setName(widget.name);
      setSlug(widget.slug);
      setMode(widget.mode);
      const pf = widget.presetFilters || {};
      setPresetCountry(pf.country || "");
      setPresetCity(pf.city || "");
      setPresetUniversityType(pf.universityType || "");
      setPresetUniversityId(pf.universityId ? String(pf.universityId) : "");
      setPresetLevel(pf.level || "");
      setPresetLanguage(pf.language || "");
      setPresetField(pf.field || "");
      setLocked(widget.lockedFilters || []);
      setHidden(widget.hiddenFilters || []);
      setDomains((widget.allowedDomains || []).join(", "));
      const th = widget.theme || {};
      setPrimaryColor(th.primaryColor || "#2563eb");
      setButtonColor(th.buttonColor || "#2563eb");
      setBorderRadius(th.borderRadius || "8px");
      setIsActive(widget.isActive);
    } else {
      setName(""); setSlug(""); setMode("combined");
      setPresetCountry(""); setPresetCity(""); setPresetUniversityType(""); setPresetUniversityId(""); setPresetLevel(""); setPresetLanguage(""); setPresetField("");
      setLocked([]); setHidden([]); setDomains("");
      setPrimaryColor("#2563eb"); setButtonColor("#2563eb"); setBorderRadius("8px");
      setIsActive(true);
    }
  }, [open, widget]);

  const handleSave = async () => {
    if (!name.trim() || !slug.trim()) {
      toast({ title: "Name and slug are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const presetFilters: Record<string, any> = {};
    if (presetCountry) presetFilters.country = presetCountry;
    if (presetCity) presetFilters.city = presetCity;
    if (presetUniversityType) presetFilters.universityType = presetUniversityType;
    if (presetUniversityId) presetFilters.universityId = parseInt(presetUniversityId, 10);
    if (presetLevel) presetFilters.level = presetLevel;
    if (presetLanguage) presetFilters.language = presetLanguage;
    if (presetField) presetFilters.field = presetField;

    const body = {
      name: name.trim(),
      slug: slug.trim(),
      mode,
      presetFilters,
      lockedFilters: locked,
      hiddenFilters: hidden,
      visibleFilters: FILTER_KEYS.filter(k => !hidden.includes(k)),
      theme: { primaryColor, buttonColor, borderRadius },
      allowedDomains: domains.split(",").map(d => d.trim()).filter(Boolean),
      isActive,
    };

    try {
      if (isEdit) {
        await customFetch(`/api/embed/widgets/${widget!.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      } else {
        await customFetch(`/api/embed/widgets`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      }
      toast({ title: isEdit ? "Widget updated" : "Widget created" });
      onSaved();
    } catch (err: any) {
      toast({ title: err.message || "Failed to save widget", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleArray = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("adminEmbeds.editWidget") : t("adminEmbeds.newWidget")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">{t("adminEmbeds.tabGeneral")}</TabsTrigger>
            <TabsTrigger value="filters">{t("adminEmbeds.tabFilters")}</TabsTrigger>
            <TabsTrigger value="theme">{t("adminEmbeds.tabTheme")}</TabsTrigger>
            <TabsTrigger value="security">{t("adminEmbeds.tabSecurity")}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Widget Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Okan University Programs" />
            </div>
            <div>
              <label className="text-sm font-medium">Slug (URL identifier)</label>
              <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="e.g., okan-programs" />
              <p className="text-xs text-muted-foreground mt-1">Used in embed code and URLs</p>
            </div>
            <div>
              <label className="text-sm font-medium">Widget Mode</label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="combined">Combined (Course Finder + Application Form)</SelectItem>
                  <SelectItem value="course_finder">Course Finder Only</SelectItem>
                  <SelectItem value="application_only">Application Form Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isActive" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
              <label htmlFor="isActive" className="text-sm font-medium">Active</label>
            </div>
          </TabsContent>

          <TabsContent value="filters" className="space-y-4 mt-4">
            <div>
              <h4 className="text-sm font-semibold mb-2">Preset Filters</h4>
              <p className="text-xs text-muted-foreground mb-3">Set default filter values for this widget. Only matching programs will be shown.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Country</label>
                  <Select value={presetCountry || "__none__"} onValueChange={v => setPresetCountry(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Countries" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Countries</SelectItem>
                      {(filterOptions?.countries || []).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">City</label>
                  <Select value={presetCity || "__none__"} onValueChange={v => setPresetCity(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Cities" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Cities</SelectItem>
                      {(filterOptions?.cities || []).map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">University Type</label>
                  <Select value={presetUniversityType || "__none__"} onValueChange={v => setPresetUniversityType(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Types</SelectItem>
                      {(filterOptions?.universityTypes || []).map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">University</label>
                  <Select value={presetUniversityId || "__none__"} onValueChange={v => setPresetUniversityId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Universities" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Universities</SelectItem>
                      {(filterOptions?.universities || []).map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Level</label>
                  <Select value={presetLevel || "__none__"} onValueChange={v => setPresetLevel(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Levels" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Levels</SelectItem>
                      {(filterOptions?.degrees || []).map(d => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Language</label>
                  <Select value={presetLanguage || "__none__"} onValueChange={v => setPresetLanguage(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Languages" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Languages</SelectItem>
                      {(filterOptions?.languages || []).map(l => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Field of study</label>
                  <Select value={presetField || "__none__"} onValueChange={v => setPresetField(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="All Fields" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All Fields</SelectItem>
                      {(filterOptions?.fields || []).map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Locked Filters</h4>
              <p className="text-xs text-muted-foreground mb-2">Visitors cannot change these filters</p>
              <div className="flex flex-wrap gap-2">
                {FILTER_KEYS.map(k => (
                  <Badge key={k} variant={locked.includes(k) ? "default" : "outline"} className="cursor-pointer"
                    onClick={() => toggleArray(locked, setLocked, k)}>
                    {locked.includes(k) ? "🔒 " : ""}{k}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-2">Hidden Filters</h4>
              <p className="text-xs text-muted-foreground mb-2">These filters won't be shown to visitors</p>
              <div className="flex flex-wrap gap-2">
                {FILTER_KEYS.map(k => (
                  <Badge key={k} variant={hidden.includes(k) ? "destructive" : "outline"} className="cursor-pointer"
                    onClick={() => toggleArray(hidden, setHidden, k)}>
                    {hidden.includes(k) ? "👁‍🗨 " : ""}{k}
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="theme" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Primary Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer" />
                  <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="flex-1" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Button Color</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={buttonColor} onChange={e => setButtonColor(e.target.value)} className="w-10 h-10 rounded cursor-pointer" />
                  <Input value={buttonColor} onChange={e => setButtonColor(e.target.value)} className="flex-1" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Border Radius</label>
                <Input value={borderRadius} onChange={e => setBorderRadius(e.target.value)} placeholder="8px" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Allowed Domains</label>
              <Input value={domains} onChange={e => setDomains(e.target.value)}
                placeholder="e.g., example.com, masterstudyinturkey.com" />
              <p className="text-xs text-muted-foreground mt-1">Comma-separated. Leave empty to allow all domains.</p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Update Widget" : "Create Widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmbedCodeDialog({ widget, onClose }: { widget: Widget; onClose: () => void }) {
  const { toast } = useToast();
  const domain = window.location.origin;
  const apiUrl = `${domain}${API_BASE}`;

  const isRestricted = (widget.allowedDomains || []).length > 0;
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [currentApiKey, setCurrentApiKey] = useState<string | null>(widget.embedApiKey ?? null);

  const rotateKey = async () => {
    setRotating(true);
    try {
      const data = await customFetch(`${API_BASE}/embed/widgets/${widget.id}/rotate-key`, {
        method: "POST",
      } as any) as { embedApiKey: string };
      setCurrentApiKey(data.embedApiKey);
      setApiKeyVisible(true);
      toast({ title: "API key rotated — update your backend with the new key" });
    } catch (err: any) {
      toast({ title: err?.message || "Failed to rotate API key", variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  const tokenUrl = `${apiUrl}/public/embed/${widget.slug}/token`;
  const scriptCode = isRestricted
    ? `<!-- EdCons Widget: ${widget.name} -->\n<!-- Your backend provides the token via data-edcons-token-url — the API key stays server-side only -->\n<div data-edcons-widget="${widget.slug}" data-edcons-token-url="/your-backend/edcons-token"></div>\n<script src="${apiUrl}/public/embed/embed.js"></script>`
    : `<!-- EdCons Widget: ${widget.name} -->\n<div data-edcons-widget="${widget.slug}"></div>\n<script src="${apiUrl}/public/embed/embed.js"></script>`;

  const partnerBackendExample = `// Node.js / Express example for your backend:
// Store EDCONS_WIDGET_API_KEY in your environment — never in HTML!
app.get('/your-backend/edcons-token', async (req, res) => {
  const response = await fetch('${tokenUrl}', {
    headers: { 'X-Widget-Api-Key': process.env.EDCONS_WIDGET_API_KEY },
  });
  const data = await response.json(); // { token, expiresIn }
  res.json(data);
});`;

  const iframeCode = `<iframe
  src="${apiUrl}/public/embed/${widget.slug}/widget"
  style="width:100%;min-height:600px;border:none;"
  loading="lazy"
  allowfullscreen>
</iframe>`;

  const programsEndpoint = `${apiUrl}/public/embed/${widget.slug}/programs`;
  const filtersEndpoint = `${apiUrl}/public/embed/${widget.slug}/filters`;
  const configEndpoint = `${apiUrl}/public/embed/${widget.slug}/config`;

  const apiExample = `// 1. Get widget config
fetch("${configEndpoint}")
  .then(res => res.json())
  .then(config => console.log(config));

// 2. Get filter options (countries, cities, levels, languages)
fetch("${filtersEndpoint}")
  .then(res => res.json())
  .then(filters => console.log(filters));

// 3. Get programs (with optional filters)
const params = new URLSearchParams({
  page: "1",
  limit: "20",
  // country: "Turkey",
  // level: "Bachelor",
  // language: "English",
  // search: "engineering",
});
fetch("${programsEndpoint}?" + params)
  .then(res => res.json())
  .then(data => {
    console.log(data.data);    // array of programs
    console.log(data.meta);    // { total, page, limit, totalPages }
  });`;

  const curlExample = `# Get programs
curl "${programsEndpoint}?page=1&limit=20"

# Get filters
curl "${filtersEndpoint}"

# Get config
curl "${configEndpoint}"

# With filters
curl "${programsEndpoint}?country=Turkey&level=Bachelor&language=English&page=1&limit=20"`;

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Embed Code: {widget.name}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="script">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="script">JavaScript Embed</TabsTrigger>
            <TabsTrigger value="iframe">Iframe Embed</TabsTrigger>
            <TabsTrigger value="api">API</TabsTrigger>
          </TabsList>

          <TabsContent value="script" className="mt-4">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Paste this code into a WordPress Custom HTML block or anywhere in your HTML page.
                The widget will auto-resize to fit its content.
              </p>
              {isRestricted && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-3">
                  <p className="text-xs font-medium text-blue-900">
                    This widget is restricted to specific domains. Partners integrate using a server-side API key — the key is stored on their backend and never placed in HTML.
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-blue-800">Widget API Key (keep this secret — share with partner's backend team only):</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-white border border-blue-200 rounded px-2 py-1 font-mono truncate">
                        {currentApiKey
                          ? (apiKeyVisible ? currentApiKey : "•".repeat(20) + currentApiKey.slice(-6))
                          : "No key — will be generated on save"}
                      </code>
                      {currentApiKey && (
                        <Button size="sm" variant="ghost" className="shrink-0 px-2 h-7 text-xs"
                          onClick={() => setApiKeyVisible((v) => !v)}>
                          {apiKeyVisible ? "Hide" : "Show"}
                        </Button>
                      )}
                      {currentApiKey && (
                        <Button size="sm" variant="ghost" className="shrink-0 px-2 h-7"
                          onClick={() => copy(currentApiKey, "API key")}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <Button size="sm" variant="outline" onClick={rotateKey} disabled={rotating} className="text-xs">
                      {rotating ? "Rotating…" : "Rotate API Key"}
                    </Button>
                    <p className="text-xs text-blue-700">
                      Rotate only if the key is compromised — partners must update their backend immediately after rotation.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-blue-800">Backend integration (add to your server — not your HTML):</p>
                    <div className="relative">
                      <pre className="bg-white border border-blue-100 rounded text-xs overflow-x-auto p-2 font-mono whitespace-pre-wrap">{partnerBackendExample}</pre>
                      <Button size="sm" variant="ghost" className="absolute top-1 right-1 h-6 px-2 text-xs"
                        onClick={() => copy(partnerBackendExample, "Backend example code")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                  {scriptCode}
                </pre>
                <Button size="sm" variant="secondary" className="absolute top-2 right-2"
                  onClick={() => copy(scriptCode, "Script embed code")}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
              {isRestricted && (
                <p className="text-xs text-muted-foreground">Replace <code>/your-backend/edcons-token</code> with your actual backend endpoint URL.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="iframe" className="mt-4">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Use this iframe code as a fallback if JavaScript embed doesn't work.
                Note: iframe won't auto-resize.
              </p>
              <div className="relative">
                <pre className="bg-muted rounded-lg p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                  {iframeCode}
                </pre>
                <Button size="sm" variant="secondary" className="absolute top-2 right-2"
                  onClick={() => copy(iframeCode, "Iframe embed code")}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="api" className="mt-4">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use the REST API to fetch program data directly and build your own custom UI.
                All endpoints are public and return JSON.
              </p>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Endpoints</h4>
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-md">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 shrink-0 mt-0.5">GET</Badge>
                    <div className="min-w-0">
                      <code className="text-xs font-mono break-all">/public/embed/{widget.slug}/programs</code>
                      <p className="text-xs text-muted-foreground mt-0.5">List programs with pagination & filters</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-md">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 shrink-0 mt-0.5">GET</Badge>
                    <div className="min-w-0">
                      <code className="text-xs font-mono break-all">/public/embed/{widget.slug}/filters</code>
                      <p className="text-xs text-muted-foreground mt-0.5">Available filter options (countries, cities, levels, languages)</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-md">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 shrink-0 mt-0.5">GET</Badge>
                    <div className="min-w-0">
                      <code className="text-xs font-mono break-all">/public/embed/{widget.slug}/config</code>
                      <p className="text-xs text-muted-foreground mt-0.5">Widget configuration (name, mode, theme, filters)</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Query Parameters (programs)</h4>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {[
                    ["page", "Page number (default: 1)"],
                    ["limit", "Items per page (default: 20, max: 100)"],
                    ["search", "Search by program or university name"],
                    ["country", "Filter by country"],
                    ["city", "Filter by city"],
                    ["level", "Filter by degree level"],
                    ["language", "Filter by instruction language"],
                    ["feeMin", "Minimum tuition fee"],
                    ["feeMax", "Maximum tuition fee"],
                  ].map(([param, desc]) => (
                    <div key={param} className="flex gap-1.5 p-1.5 bg-muted/30 rounded">
                      <code className="font-mono text-primary font-medium shrink-0">{param}</code>
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">JavaScript Example</h4>
                  <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2"
                    onClick={() => copy(apiExample, "JavaScript API example")}>
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                </div>
                <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto">
                  {apiExample}
                </pre>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">cURL Example</h4>
                  <Button size="sm" variant="secondary" className="h-6 text-[10px] px-2"
                    onClick={() => copy(curlExample, "cURL API example")}>
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                </div>
                <pre className="bg-muted rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono max-h-36 overflow-y-auto">
                  {curlExample}
                </pre>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
          <h4 className="font-semibold text-sm mb-2">WordPress Instructions</h4>
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Go to the page/post where you want the widget</li>
            <li>Add a "Custom HTML" block</li>
            <li>Paste the embed code (JavaScript or iframe)</li>
            <li>Preview/publish the page</li>
          </ol>
        </div>

        <div className="mt-2 flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`${apiUrl}/public/embed/${widget.slug}/widget`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3 h-3 mr-1" /> Preview Widget
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteWidgetBtn({ id, name, onDone }: { id: number; name: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: () => customFetch(`${API_BASE}/embed/widgets/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Widget deleted" }); onDone(); setOpen(false); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });
  return (
    <>
      <Button size="icon" variant="ghost" title="Delete" onClick={() => setOpen(true)}>
        <Trash2 className="w-4 h-4 text-destructive" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Widget</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{name}</strong>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              {del.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
