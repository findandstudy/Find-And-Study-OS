import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type CampaignEntityType = "lead" | "student" | "application";

interface ApprovedTemplate {
  id: number;
  name: string;
  content?: string | null;
  language?: string | null;
  category?: string | null;
  externalTemplateName?: string | null;
  approvalStatus?: string | null;
}

interface CampaignResult {
  data?: { id?: number; name?: string };
  summary?: { total: number; queued: number; skipped: number };
}

interface BulkMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: CampaignEntityType;
  entityIds: number[];
  onCreated?: () => void;
}

const ENTITY_LABELS: Record<CampaignEntityType, string> = {
  lead: "leads",
  student: "students",
  application: "applications",
};

function unwrapTemplates(response: any): ApprovedTemplate[] {
  const rows = response?.data ?? response ?? [];
  return Array.isArray(rows) ? rows : [];
}

export function BulkMessageDialog({
  open,
  onOpenChange,
  entityType,
  entityIds,
  onCreated,
}: BulkMessageDialogProps) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<ApprovedTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    setResult(null);
    void customFetch("/api/message-templates?channel=whatsapp&activeOnly=true")
      .then((response: any) => {
        const approved = unwrapTemplates(response).filter((template) => (
          Boolean(template.externalTemplateName)
          && String(template.approvalStatus || "").toLowerCase() === "approved"
        ));
        setTemplates(approved);
        setTemplateId((current) => (
          current && approved.some((template) => template.id === current)
            ? current
            : null
        ));
      })
      .catch((error: any) => {
        setLoadError(error?.message || "Approved WhatsApp templates could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  const filteredTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((template) => (
      template.name.toLowerCase().includes(needle)
      || String(template.externalTemplateName || "").toLowerCase().includes(needle)
      || String(template.content || "").toLowerCase().includes(needle)
    ));
  }, [query, templates]);

  const selectedTemplate = templates.find((template) => template.id === templateId) || null;
  const uniqueEntityIds = useMemo(() => [...new Set(entityIds)], [entityIds]);

  const close = () => {
    if (sending) return;
    onOpenChange(false);
    setQuery("");
    setCampaignName("");
    setResult(null);
  };

  const createCampaign = async () => {
    if (!templateId || uniqueEntityIds.length === 0) return;
    setSending(true);
    try {
      const response = await customFetch("/api/message-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim() || undefined,
          entityType,
          entityIds: uniqueEntityIds,
          templateId,
        }),
      }) as CampaignResult;
      setResult(response);
      const summary = response.summary;
      toast({
        title: `${summary?.queued ?? 0} WhatsApp message(s) queued`,
        description: summary?.skipped
          ? `${summary.skipped} record(s) were skipped because the phone was missing or duplicated.`
          : "The delivery worker will process this campaign in the background.",
      });
      onCreated?.();
    } catch (error: any) {
      toast({
        title: "Campaign could not be created",
        description: error?.message || "The selected recipients were not queued.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) onOpenChange(true); else close(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-emerald-600" />
            Send approved WhatsApp template
          </DialogTitle>
          <DialogDescription>
            Create a tracked CRM campaign for {uniqueEntityIds.length} selected {ENTITY_LABELS[entityType]}.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Campaign queued</AlertTitle>
              <AlertDescription>
                {result.summary?.queued ?? 0} queued, {result.summary?.skipped ?? 0} skipped,
                {" "}{result.summary?.total ?? uniqueEntityIds.length} total recipient record(s).
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              Delivery progress and per-recipient failures are available in Messages → Broadcast → CRM Campaigns.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Safe recipient resolution</AlertTitle>
              <AlertDescription>
                Existing contacts stay on the WhatsApp line they contacted. New contacts use the configured default line.
                Template approval is re-verified for the exact line before every send; missing phones and duplicate numbers are skipped.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign name (optional)</Label>
              <Input
                id="campaign-name"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder={`${selectedTemplate?.externalTemplateName || "WhatsApp campaign"} · ${uniqueEntityIds.length} selected`}
                maxLength={180}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-search">Approved template</Label>
              <Input
                id="template-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search approved templates..."
              />
              <div className="rounded-xl border">
                {loading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading templates...
                  </div>
                ) : loadError ? (
                  <div className="p-4 text-sm text-destructive">{loadError}</div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No approved WhatsApp template found.</div>
                ) : (
                  <ScrollArea className="h-56">
                    <div className="divide-y">
                      {filteredTemplates.map((template) => {
                        const selected = template.id === templateId;
                        return (
                          <button
                            type="button"
                            key={template.id}
                            onClick={() => setTemplateId(template.id)}
                            className={`w-full p-3 text-left transition-colors ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary" : "hover:bg-muted/50"}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-semibold">
                                {template.externalTemplateName || template.name}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Badge variant="outline" className="text-[10px]">{template.language || "EN"}</Badge>
                                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Approved</Badge>
                              </div>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.content || "No preview"}</p>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={sending}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={createCampaign} disabled={!templateId || uniqueEntityIds.length === 0 || sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Queue {uniqueEntityIds.length} recipient(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
