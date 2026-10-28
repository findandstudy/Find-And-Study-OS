import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { AiWritingField } from "./adminAiWriting";

type Action = "generate" | "improve" | "shorten" | "expand";
type Copy = (en: string, tr: string) => string;

export function AiWritingAssistant({
  locale,
  context,
  fields,
  allowedVariables = [],
  onApply,
  copy,
}: {
  locale: string;
  context: string;
  fields: AiWritingField[];
  allowedVariables?: string[];
  onApply: (path: string, value: string) => void;
  copy: Copy;
}) {
  const { toast } = useToast();
  const [fieldPath, setFieldPath] = useState(fields[0]?.path ?? "");
  const [action, setAction] = useState<Action>(fields[0]?.value.trim() ? "improve" : "generate");
  const [instruction, setInstruction] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [suggestionMeta, setSuggestionMeta] = useState<{ path: string; provider: string; action: Action } | null>(null);
  const field = useMemo(() => fields.find(item => item.path === fieldPath) ?? fields[0] ?? null, [fields, fieldPath]);

  useEffect(() => {
    if (!fields.some(item => item.path === fieldPath)) setFieldPath(fields[0]?.path ?? "");
  }, [fields, fieldPath]);
  useEffect(() => {
    setSuggestion("");
    setSuggestionMeta(null);
    setAction(field?.value.trim() ? "improve" : "generate");
  }, [field?.path]);

  const status = useQuery<{ configured: boolean; provider: string | null; message?: string; settingsPath?: string }>({
    queryKey: ["/api/website/ai/status"],
    queryFn: () => customFetch("/api/website/ai/status"),
    staleTime: 60_000,
  });
  const write = useMutation({
    mutationFn: () => customFetch<{ result: string; provider: string; action: Action }>("/api/website/ai/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        locale,
        fieldLabel: field?.label,
        context,
        currentText: field?.value ?? "",
        instruction,
        format: field?.format,
        maxLength: field?.maxLength,
        allowedVariables,
      }),
    }),
    onSuccess: data => {
      setSuggestion(data.result);
      setSuggestionMeta({ path: field!.path, provider: data.provider, action: data.action });
    },
    onError: error => toast({ title: copy("Suggestion could not be created", "Öneri oluşturulamadı"), description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
  });
  if (!fields.length) return null;
  const configured = status.data?.configured ?? false;
  const canRun = configured && !!field && (action === "generate" || !!field.value.trim()) && !write.isPending;
  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-600" />{copy("AI writing suggestion", "AI metin önerisi")}</h4>
        <Badge variant={configured ? "default" : "secondary"}>{configured ? `${status.data?.provider ?? "AI"} ${copy("ready", "hazır")}` : copy("AI not configured", "AI yapılandırılmadı")}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{copy("Choose the exact field and review the suggestion before applying it. Nothing is saved or published automatically.", "Tam alanı seçin ve uygulamadan önce öneriyi inceleyin. Hiçbir şey otomatik kaydedilmez veya yayınlanmaz.")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>{copy("Target field", "Hedef alan")}</Label><Select value={field?.path ?? ""} onValueChange={setFieldPath}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{fields.map(item => <SelectItem key={item.path} value={item.path}>{item.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label>{copy("Action", "İşlem")}</Label><Select value={action} onValueChange={value => setAction(value as Action)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="generate">{copy("Write new text", "Yeni metin yaz")}</SelectItem><SelectItem value="improve" disabled={!field?.value.trim()}>{copy("Improve", "İyileştir")}</SelectItem><SelectItem value="shorten" disabled={!field?.value.trim()}>{copy("Shorten", "Kısalt")}</SelectItem><SelectItem value="expand" disabled={!field?.value.trim()}>{copy("Expand", "Genişlet")}</SelectItem></SelectContent></Select></div>
      </div>
      <div className="space-y-1"><Label>{copy("Optional instruction", "İsteğe bağlı yönlendirme")}</Label><Textarea value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={1000} rows={2} placeholder={copy("Example: Make it clearer for prospective international students.", "Örnek: Uluslararası öğrenci adayları için daha anlaşılır yap.")} /></div>
      {!configured && <div className="rounded-lg bg-muted p-2 text-xs text-muted-foreground"><p>{status.data?.message || copy("Enable OpenAI or Anthropic in Settings > Integrations to use this tool.", "Bu aracı kullanmak için Ayarlar > Entegrasyonlar alanında OpenAI veya Anthropic bağlantısını etkinleştirin.")}</p><a className="mt-1 inline-block font-medium text-primary underline underline-offset-2" href={status.data?.settingsPath || "/admin/settings?tab=integrations#ai-provider-integrations"}>{copy("Open AI settings", "AI ayarlarını aç")}</a></div>}
      <Button type="button" size="sm" disabled={!canRun} onClick={() => write.mutate()}>{write.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Sparkles className="me-2 h-4 w-4" />}{copy("Create suggestion", "Öneri oluştur")}</Button>
      {suggestion && suggestionMeta?.path === field?.path && <div className="space-y-2 rounded-lg border bg-background p-3">
        <div className="grid gap-3 lg:grid-cols-2"><div><p className="mb-1 text-xs font-semibold text-muted-foreground">{copy("Current", "Mevcut")}</p><div className="max-h-48 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 text-sm">{field.value || copy("Empty", "Boş")}</div></div><div><p className="mb-1 text-xs font-semibold text-muted-foreground">{copy("Suggestion", "Öneri")}</p><div className="max-h-48 overflow-auto whitespace-pre-wrap rounded border p-2 text-sm">{suggestion}</div></div></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">{suggestionMeta.provider} · {suggestionMeta.action} · {locale.toUpperCase()}</span><Button type="button" size="sm" onClick={() => { onApply(field.path, suggestion); setSuggestion(""); setSuggestionMeta(null); toast({ title: copy("Suggestion applied to the draft", "Öneri taslağa uygulandı") }); }}><Check className="me-2 h-4 w-4" />{copy("Apply to selected field", "Seçili alana uygula")}</Button></div>
      </div>}
    </div>
  );
}
