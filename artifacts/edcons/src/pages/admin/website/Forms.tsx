import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, Plus, Pencil, Trash2, Loader2, Check, GripVertical,
  ChevronUp, ChevronDown, Eye, EyeOff, Inbox, ExternalLink, Copy,
  Settings2, MailOpen,
} from "lucide-react";

interface WebsiteForm {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  submitAction: string;
  submitEmail: string | null;
  submitWebhookUrl: string | null;
  successMessage: string | null;
  crmSource: string | null;
  crmPipelineStage: string | null;
  pageSourceTag: string | null;
  isActive: boolean;
  createdAt: string;
}

interface FormField {
  id: number;
  formId: number;
  fieldType: string;
  label: string;
  name: string;
  placeholder: string | null;
  isRequired: boolean;
  validationRules: Record<string, unknown>;
  options: unknown[];
  sortOrder: number;
}

interface FormSubmission {
  id: number;
  formId: number;
  data: Record<string, unknown>;
  sourceUrl: string | null;
  ipAddress: string | null;
  status: string;
  createdAt: string;
  leadId: number | null;
}

interface FormFormData {
  name: string;
  slug: string;
  description: string;
  submitAction: string;
  submitEmail: string;
  submitWebhookUrl: string;
  successMessage: string;
  errorMessage: string;
  crmSource: string;
  crmPipelineStage: string;
  pageSourceTag: string;
  isActive: boolean;
}

interface FieldFormData {
  fieldType: string;
  label: string;
  name: string;
  placeholder: string;
  isRequired: boolean;
  options: string;
  minLength: string;
  maxLength: string;
  pattern: string;
}

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Text Area" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
];

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
}

export default function WebsiteForms() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [formDialog, setFormDialog] = useState(false);
  const [editingForm, setEditingForm] = useState<WebsiteForm | null>(null);
  const [selectedForm, setSelectedForm] = useState<WebsiteForm | null>(null);
  const [fieldDialog, setFieldDialog] = useState(false);
  const [editingField, setEditingField] = useState<FormField | null>(null);
  const [activeTab, setActiveTab] = useState("fields");

  const { data: pipelineStages } = useQuery<{ key: string; label: string }[]>({
    queryKey: ["pipeline-stages", "lead"],
    queryFn: () => customFetch("/api/pipeline-stages/lead"),
  });

  const [formData, setFormData] = useState<FormFormData>({
    name: "", slug: "", description: "", submitAction: "crm",
    submitEmail: "", submitWebhookUrl: "", successMessage: "Thank you! Your submission has been received.",
    errorMessage: "Something went wrong. Please try again later.",
    crmSource: "", crmPipelineStage: "", pageSourceTag: "", isActive: true,
  });

  const [fieldData, setFieldData] = useState<FieldFormData>({
    fieldType: "text", label: "", name: "", placeholder: "", isRequired: false, options: "", minLength: "", maxLength: "", pattern: "",
  });

  const { data: forms = [], isLoading } = useQuery<WebsiteForm[]>({
    queryKey: ["/api/website/forms"],
    queryFn: () => customFetch("/api/website/forms"),
  });

  const { data: fields = [] } = useQuery<FormField[]>({
    queryKey: ["/api/website/forms", selectedForm?.id, "fields"],
    queryFn: () => customFetch(`/api/website/forms/${selectedForm!.id}/fields`),
    enabled: !!selectedForm,
  });

  const { data: submissionsData } = useQuery<{ data: FormSubmission[]; meta: { total: number } }>({
    queryKey: ["/api/website/forms", selectedForm?.id, "submissions"],
    queryFn: () => customFetch(`/api/website/forms/${selectedForm!.id}/submissions?limit=50`),
    enabled: !!selectedForm && activeTab === "submissions",
  });

  const saveFormMutation = useMutation({
    mutationFn: (data: { form: FormFormData; id?: number }) => {
      if (data.id) {
        return customFetch(`/api/website/forms/${data.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.form),
        });
      }
      return customFetch("/api/website/forms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.form),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/website/forms"] });
      setFormDialog(false);
      setEditingForm(null);
      toast({ title: editingForm ? "Form updated" : "Form created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteFormMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/forms/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/website/forms"] });
      if (selectedForm) setSelectedForm(null);
      toast({ title: "Form deleted" });
    },
  });

  const saveFieldMutation = useMutation({
    mutationFn: (data: { field: Record<string, unknown>; id?: number }) => {
      if (data.id) {
        return customFetch(`/api/website/form-fields/${data.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.field),
        });
      }
      return customFetch("/api/website/form-fields", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.field),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/website/forms", selectedForm?.id, "fields"] });
      setFieldDialog(false);
      setEditingField(null);
      toast({ title: editingField ? "Field updated" : "Field added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteFieldMutation = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/form-fields/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/website/forms", selectedForm?.id, "fields"] });
      toast({ title: "Field removed" });
    },
  });

  const moveFieldMutation = useMutation({
    mutationFn: (data: { id: number; sortOrder: number }) =>
      customFetch(`/api/website/form-fields/${data.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: data.sortOrder }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/website/forms", selectedForm?.id, "fields"] }),
  });

  function openFormDialog(form?: WebsiteForm) {
    if (form) {
      setEditingForm(form);
      const meta = form as unknown as Record<string, unknown>;
      setFormData({
        name: form.name, slug: form.slug, description: form.description || "",
        submitAction: form.submitAction, submitEmail: form.submitEmail || "",
        submitWebhookUrl: form.submitWebhookUrl || "", successMessage: form.successMessage || "",
        errorMessage: (meta.errorMessage as string) || "Something went wrong. Please try again later.",
        crmSource: form.crmSource || "",
        crmPipelineStage: form.crmPipelineStage || "",
        pageSourceTag: form.pageSourceTag || "",
        isActive: form.isActive,
      });
    } else {
      setEditingForm(null);
      setFormData({
        name: "", slug: "", description: "", submitAction: "crm",
        submitEmail: "", submitWebhookUrl: "", successMessage: "Thank you! Your submission has been received.",
        errorMessage: "Something went wrong. Please try again later.",
        crmSource: "", crmPipelineStage: "", pageSourceTag: "", isActive: true,
      });
    }
    setFormDialog(true);
  }

  function openFieldDialog(field?: FormField) {
    if (field) {
      setEditingField(field);
      const rules = (field.validationRules || {}) as Record<string, string>;
      setFieldData({
        fieldType: field.fieldType, label: field.label, name: field.name,
        placeholder: field.placeholder || "", isRequired: field.isRequired,
        options: Array.isArray(field.options) ? (field.options as string[]).join(", ") : "",
        minLength: rules.minLength || "", maxLength: rules.maxLength || "", pattern: rules.pattern || "",
      });
    } else {
      setEditingField(null);
      setFieldData({ fieldType: "text", label: "", name: "", placeholder: "", isRequired: false, options: "", minLength: "", maxLength: "", pattern: "" });
    }
    setFieldDialog(true);
  }

  function handleSaveForm() {
    const slug = formData.slug || slugify(formData.name);
    saveFormMutation.mutate({ form: { ...formData, slug }, id: editingForm?.id });
  }

  function handleSaveField() {
    if (!selectedForm) return;
    const name = fieldData.name || slugify(fieldData.label);
    const options = fieldData.options ? fieldData.options.split(",").map(o => o.trim()).filter(Boolean) : [];
    const validationRules: Record<string, string | number> = {};
    if (fieldData.minLength) validationRules.minLength = fieldData.minLength;
    if (fieldData.maxLength) validationRules.maxLength = fieldData.maxLength;
    if (fieldData.pattern) validationRules.pattern = fieldData.pattern;
    const payload: Record<string, unknown> = {
      formId: selectedForm.id,
      fieldType: fieldData.fieldType,
      label: fieldData.label,
      name,
      placeholder: fieldData.placeholder || null,
      isRequired: fieldData.isRequired,
      validationRules,
      options,
      sortOrder: editingField?.sortOrder ?? fields.length,
    };
    saveFieldMutation.mutate({ field: payload, id: editingField?.id });
  }

  function moveField(field: FormField, direction: "up" | "down") {
    const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(f => f.id === field.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    moveFieldMutation.mutate({ id: field.id, sortOrder: sorted[swapIdx].sortOrder });
    moveFieldMutation.mutate({ id: sorted[swapIdx].id, sortOrder: field.sortOrder });
  }

  const submissions = submissionsData?.data || [];
  const totalSubmissions = submissionsData?.meta?.total || 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="w-6 h-6 text-primary" /> Forms</h1>
            <p className="text-sm text-muted-foreground mt-1">Build and manage website forms with CRM integration.</p>
          </div>
          <Button onClick={() => openFormDialog()} className="gap-2">
            <Plus className="w-4 h-4" /> New Form
          </Button>
        </div>

        {!selectedForm ? (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : forms.length === 0 ? (
              <Card className="p-10 text-center">
                <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-lg font-semibold">No forms yet</p>
                <p className="text-muted-foreground text-sm mb-4">Create your first form to collect submissions.</p>
                <Button onClick={() => openFormDialog()} className="gap-2"><Plus className="w-4 h-4" /> Create Form</Button>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {forms.map(form => (
                  <Card key={form.id} className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setSelectedForm(form); setActiveTab("fields"); }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{form.name}</p>
                          <Badge variant={form.isActive ? "default" : "secondary"} className="text-[10px]">{form.isActive ? "Active" : "Inactive"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">/{form.slug}</p>
                        {form.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{form.description}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); openFormDialog(form); }}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); if (confirm("Delete this form?")) deleteFormMutation.mutate(form.id); }}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" /> {form.submitAction}</span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setSelectedForm(null)} className="gap-1 text-muted-foreground">← Back</Button>
              <div>
                <h2 className="font-semibold">{selectedForm.name}</h2>
                <p className="text-xs text-muted-foreground">/{selectedForm.slug}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openFormDialog(selectedForm)} className="gap-1"><Pencil className="w-3 h-3" /> Edit</Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="fields" className="gap-1"><GripVertical className="w-3 h-3" /> Fields ({fields.length})</TabsTrigger>
                <TabsTrigger value="submissions" className="gap-1"><Inbox className="w-3 h-3" /> Submissions ({totalSubmissions})</TabsTrigger>
                <TabsTrigger value="embed" className="gap-1"><ExternalLink className="w-3 h-3" /> Embed</TabsTrigger>
              </TabsList>

              <TabsContent value="fields" className="space-y-4 mt-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => openFieldDialog()} className="gap-1"><Plus className="w-3 h-3" /> Add Field</Button>
                </div>
                {fields.length === 0 ? (
                  <Card className="p-8 text-center">
                    <p className="text-muted-foreground text-sm">No fields yet. Add fields to build your form.</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {[...fields].sort((a, b) => a.sortOrder - b.sortOrder).map((field, i) => (
                      <Card key={field.id} className="p-3 flex items-center gap-3">
                        <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{field.label}</span>
                            <Badge variant="outline" className="text-[10px]">{field.fieldType}</Badge>
                            {field.isRequired && <Badge variant="destructive" className="text-[10px]">Required</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">name: {field.name}{field.placeholder ? ` · placeholder: "${field.placeholder}"` : ""}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveField(field, "up")}><ChevronUp className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" disabled={i === fields.length - 1} onClick={() => moveField(field, "down")}><ChevronDown className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => openFieldDialog(field)}><Pencil className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm("Remove this field?")) deleteFieldMutation.mutate(field.id); }}>
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
                <Card className="p-3 bg-muted/30 border-dashed">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> A hidden honeypot field is automatically injected to prevent spam.
                  </p>
                </Card>
              </TabsContent>

              <TabsContent value="submissions" className="mt-4">
                {submissions.length === 0 ? (
                  <Card className="p-8 text-center">
                    <MailOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm">No submissions yet.</p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {submissions.map(sub => (
                      <Card key={sub.id} className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant={sub.status === "new" ? "default" : "secondary"} className="text-[10px]">{sub.status}</Badge>
                          <span className="text-xs text-muted-foreground">{new Date(sub.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {Object.entries(sub.data as Record<string, unknown>).map(([key, val]) => (
                            <div key={key}>
                              <span className="text-xs text-muted-foreground">{key}:</span>
                              <p className="font-medium text-sm truncate">{String(val)}</p>
                            </div>
                          ))}
                        </div>
                        {sub.leadId && <p className="text-xs text-muted-foreground mt-2">Lead ID: #{sub.leadId}</p>}
                        {sub.sourceUrl && <p className="text-xs text-muted-foreground">Source: {sub.sourceUrl}</p>}
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="embed" className="mt-4">
                <Card className="p-5 space-y-4">
                  <h3 className="font-semibold">Embed Code</h3>
                  <p className="text-sm text-muted-foreground">Use this endpoint to submit form data from your website:</p>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <code className="text-xs break-all">POST /api/public/website-forms/{selectedForm.slug}/submit</code>
                  </div>
                  <p className="text-sm text-muted-foreground">Include a hidden <code className="text-xs">_hp</code> field (leave empty) for honeypot spam protection.</p>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <pre className="text-xs whitespace-pre-wrap">{`<form action="/api/public/website-forms/${selectedForm.slug}/submit" method="POST">
  <input type="hidden" name="_hp" value="" style="display:none" />
${fields.map(f => `  <label>${f.label}</label>\n  <input type="${f.fieldType}" name="${f.name}" ${f.isRequired ? 'required' : ''} />`).join('\n')}
  <button type="submit">Submit</button>
</form>`}</pre>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(`POST /api/public/website-forms/${selectedForm.slug}/submit`);
                      toast({ title: "Copied to clipboard" });
                    }}>
                    <Copy className="w-3 h-3" /> Copy Endpoint
                  </Button>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <Dialog open={formDialog} onOpenChange={setFormDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingForm ? "Edit Form" : "New Form"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Form Name</Label>
              <Input value={formData.name} onChange={e => {
                const name = e.target.value;
                setFormData(f => ({ ...f, name, slug: editingForm ? f.slug : slugify(name) }));
              }} placeholder="Contact Form" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Slug</Label>
              <Input value={formData.slug} onChange={e => setFormData(f => ({ ...f, slug: slugify(e.target.value) }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))} rows={2} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Submit Action</Label>
              <Select value={formData.submitAction} onValueChange={v => setFormData(f => ({ ...f, submitAction: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="crm">CRM / Web-to-Lead</SelectItem>
                  <SelectItem value="email">Email Notification</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.submitAction === "email" && (
              <div>
                <Label className="text-xs">Notification Email</Label>
                <Input type="email" value={formData.submitEmail} onChange={e => setFormData(f => ({ ...f, submitEmail: e.target.value }))} className="mt-1" />
              </div>
            )}
            {formData.submitAction === "webhook" && (
              <div>
                <Label className="text-xs">Webhook URL</Label>
                <Input value={formData.submitWebhookUrl} onChange={e => setFormData(f => ({ ...f, submitWebhookUrl: e.target.value }))} placeholder="https://..." className="mt-1" />
              </div>
            )}
            {formData.submitAction === "crm" && (
              <>
                <div>
                  <Label className="text-xs">CRM Lead Source Tag</Label>
                  <Input value={formData.crmSource} onChange={e => setFormData(f => ({ ...f, crmSource: e.target.value }))} placeholder="e.g. contact-page, landing-1" className="mt-1" />
                  <p className="text-[10px] text-muted-foreground mt-1">Used as the lead source. Defaults to "website-form:{'{'}slug{'}'}" if empty.</p>
                </div>
                <div>
                  <Label className="text-xs">Page Source Tag</Label>
                  <Input value={formData.pageSourceTag} onChange={e => setFormData(f => ({ ...f, pageSourceTag: e.target.value }))} placeholder="e.g. homepage, pricing, about-us" className="mt-1" />
                  <p className="text-[10px] text-muted-foreground mt-1">Identifies which page this form is embedded on for analytics/CRM tracking.</p>
                </div>
                <div>
                  <Label className="text-xs">Destination Pipeline Stage</Label>
                  <Select value={formData.crmPipelineStage || "__none__"} onValueChange={v => setFormData(f => ({ ...f, crmPipelineStage: v === "__none__" ? "" : v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Default (first stage)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Default (first stage)</SelectItem>
                      {(pipelineStages || []).map((s: { key: string; label: string }) => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">Pipeline stage where new leads from this form will be placed.</p>
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Success Message</Label>
              <Textarea value={formData.successMessage} onChange={e => setFormData(f => ({ ...f, successMessage: e.target.value }))} rows={2} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Error Message</Label>
              <Textarea value={formData.errorMessage} onChange={e => setFormData(f => ({ ...f, errorMessage: e.target.value }))} rows={2} className="mt-1" placeholder="Shown to visitors if submission fails" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formData.isActive} onCheckedChange={v => setFormData(f => ({ ...f, isActive: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setFormDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveForm} disabled={!formData.name || saveFormMutation.isPending}>
              {saveFormMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {editingForm ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={fieldDialog} onOpenChange={setFieldDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingField ? "Edit Field" : "Add Field"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Field Type</Label>
              <Select value={fieldData.fieldType} onValueChange={v => setFieldData(f => ({ ...f, fieldType: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Label</Label>
              <Input value={fieldData.label} onChange={e => {
                const label = e.target.value;
                setFieldData(f => ({ ...f, label, name: editingField ? f.name : slugify(label) }));
              }} placeholder="Full Name" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Field Name (API key)</Label>
              <Input value={fieldData.name} onChange={e => setFieldData(f => ({ ...f, name: slugify(e.target.value) }))} className="mt-1 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">Placeholder</Label>
              <Input value={fieldData.placeholder} onChange={e => setFieldData(f => ({ ...f, placeholder: e.target.value }))} className="mt-1" />
            </div>
            {(fieldData.fieldType === "select") && (
              <div>
                <Label className="text-xs">Options (comma-separated)</Label>
                <Input value={fieldData.options} onChange={e => setFieldData(f => ({ ...f, options: e.target.value }))} placeholder="Option 1, Option 2, Option 3" className="mt-1" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={fieldData.isRequired} onCheckedChange={v => setFieldData(f => ({ ...f, isRequired: v }))} />
              <Label className="text-xs">Required</Label>
            </div>
            {["text", "textarea", "email", "phone", "url"].includes(fieldData.fieldType) && (
              <div className="space-y-3 pt-2 border-t">
                <Label className="text-xs font-semibold text-muted-foreground">Validation Rules</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px]">Min Length</Label>
                    <Input type="number" value={fieldData.minLength} onChange={e => setFieldData(f => ({ ...f, minLength: e.target.value }))} placeholder="0" className="mt-0.5 h-7 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Max Length</Label>
                    <Input type="number" value={fieldData.maxLength} onChange={e => setFieldData(f => ({ ...f, maxLength: e.target.value }))} placeholder="255" className="mt-0.5 h-7 text-xs" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px]">Pattern (RegEx)</Label>
                  <Input value={fieldData.pattern} onChange={e => setFieldData(f => ({ ...f, pattern: e.target.value }))} placeholder="e.g. ^[A-Za-z]+$" className="mt-0.5 h-7 text-xs font-mono" />
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setFieldDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveField} disabled={!fieldData.label || saveFieldMutation.isPending}>
              {saveFieldMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {editingField ? "Update" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
