import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/hooks/use-i18n";
import { useAuth } from "@/hooks/use-auth";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import DOMPurify from "isomorphic-dompurify";
import { emailLibraryKey, useEmailLibrary } from "./useEmailLibrary";
import { canApproveEmail, canVerifyEmailSender, emailAutomationCopy, emailStatusLabel, emailTemplateVariables, safeEmailPreview, type EmailTemplate, type EmailTemplateVersion, type EmailSender, type EmailHistoryItem } from "./emailAutomationModel";

type TemplateDraft = { templateId?: number; name: string; category: string; language: string; subject: string; content: string };
type SenderDraft = { id?: number; expectedRevision?: number; displayName: string; fromEmail: string; fromName: string; replyTo: string; host: string; port: number; username: string; password: string; isActive: boolean };
type Confirmation = { path: string; body?: object; note: string };
const blankTemplate = (): TemplateDraft => ({ name: "", category: "applications", language: "en", subject: "", content: "" });
const blankSender = (): SenderDraft => ({ displayName: "", fromEmail: "", fromName: "", replyTo: "", host: "", port: 587, username: "", password: "", isActive: false });

export function EmailAutomationManager({ view = "all" }: { view?: "all" | "senders" } = {}) {
  const { lang, dir } = useI18n();
  const copy = emailAutomationCopy(lang);
  const { user } = useAuth();
  const client = useQueryClient();
  const library = useEmailLibrary();
  const [tab, setTab] = useState<"templates" | "senders" | "history">(view === "senders" ? "senders" : "templates");
  const [historySource, setHistorySource] = useState<"stage" | "system">("stage");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [senderDraft, setSenderDraft] = useState<SenderDraft | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (window.location.hash === "#notification-email") document.getElementById("notification-email")?.scrollIntoView({ block: "start" }); }, []);
  const history = useQuery({ queryKey: [...emailLibraryKey, "history", historySource], queryFn: ({ signal }) => customFetch(`/api/notification-email/history?source=${historySource}`, { signal, cache: "no-store" }) as Promise<{ items: EmailHistoryItem[]; nextCursor?: string | null }>, enabled: tab === "history", retry: false, staleTime: 0, gcTime: 0 });
  const capability = library.capabilities.data;
  const templates = library.templates.data?.templates ?? [];
  const senders = library.senders.data?.senders ?? [];
  const activeQuery = tab === "templates" ? library.templates : tab === "senders" ? library.senders : history;
  const statusLabel = (status: string) => emailStatusLabel(status, lang);

  async function action(path: string, body: object = {}, method = "POST"): Promise<unknown | null> {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const result = await customFetch(`/api/notification-email${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await client.invalidateQueries({ queryKey: emailLibraryKey });
      return result;
    } catch { if (mounted.current) setError(true); return null; }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function newVersion(template: EmailTemplate, version: EmailTemplateVersion) {
    setError(false); setDraft({ templateId: template.id, name: template.name, category: template.category, language: version.language, subject: version.subject, content: version.content });
  }
  function editSender(sender: EmailSender) {
    setError(false); setSenderDraft({ id: sender.id, expectedRevision: sender.revision, displayName: sender.displayName, fromEmail: sender.fromEmail, fromName: sender.fromName, replyTo: sender.replyTo ?? "", host: sender.config.host, port: sender.config.port, username: sender.config.username, password: "", isActive: false });
  }
  async function saveTemplate(event: React.FormEvent) {
    event.preventDefault(); if (!draft) return;
    const { templateId, ...fields } = draft;
    const body = templateId ? { language: fields.language, subject: fields.subject, content: fields.content } : fields;
    if (await action(templateId ? `/templates/${templateId}/versions` : "/templates", body)) setDraft(null);
  }
  async function saveSender(event: React.FormEvent) {
    event.preventDefault(); if (!senderDraft) return;
    const { id, password, ...fields } = senderDraft;
    if (await action(id ? `/senders/${id}` : "/senders", { ...fields, ...(password ? { password } : {}) }, id ? "PATCH" : "POST")) setSenderDraft(null);
  }
  async function showPreview(version: EmailTemplateVersion) {
    const variables = Object.fromEntries(version.variables.map(variable => [variable, `Sample ${variable}`]));
    const result = await action(`/versions/${version.id}/preview`, { variables }) as { subject: string; html: string } | null;
    if (result && mounted.current) setPreview(result);
  }
  const errorNotice = error ? <p role="alert" className="text-sm text-destructive">{copy.error}</p> : null;
  return <Card id="notification-email" className="p-4 sm:p-6 space-y-4 min-w-0 scroll-mt-6" data-testid="email-automation-manager" dir={dir}>
    <header className="space-y-2"><h2 className="font-semibold text-lg">{copy.title}</h2><p className="text-sm text-muted-foreground">{copy.intro}</p>
      <a href="/staff/messages?tab=templates" className="block text-sm text-primary underline">{copy.copy("WhatsApp / message templates — existing Messages library", "WhatsApp / mesaj şablonları — mevcut Mesajlar kütüphanesi")}</a>
      {lang !== "tr" && lang !== "en" && <p className="text-xs text-muted-foreground">{copy.fallback}</p>}
      {library.capabilities.isError ? <p role="alert" className="text-sm text-destructive">{copy.loadError} <Button variant="outline" size="sm" onClick={() => void library.capabilities.refetch()}>{copy.refresh}</Button></p> : capability ? <p className="rounded-md border bg-secondary/40 p-3 text-sm" data-testid="email-runtime-status">{capability.enabled ? copy.enabled : copy.disabled}</p> : <p role="status">{copy.loading}</p>}
    </header>
    <div className="flex flex-wrap gap-2" role="group" aria-label={copy.title}>
      {(view === "senders" ? ["senders"] as const : ["templates", "senders", "history"] as const).map(key => <Button key={key} type="button" size="sm" variant={tab === key ? "default" : "outline"} aria-pressed={tab === key} onClick={() => { setTab(key); setError(false); }}>{copy[key]}</Button>)}
      <Button type="button" variant="ghost" size="sm" className="ms-auto" disabled={activeQuery.isFetching || busy} onClick={() => { void activeQuery.refetch(); void library.capabilities.refetch(); }}>{copy.refresh}</Button>
    </div>
    {errorNotice}
    {activeQuery.isLoading && <p role="status" className="py-6 text-sm">{copy.loading}</p>}
    {activeQuery.isError && <p role="alert" className="text-sm text-destructive">{copy.loadError}</p>}
    {(library.templates.data?.truncated || library.senders.data?.truncated) && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{copy.copy("The catalogue exceeds the current retrieval limit; some versions or senders are not shown.", "Katalog mevcut sorgu sınırını aşıyor; bazı sürümler veya göndericiler gösterilmiyor.")}</p>}
    {tab === "templates" && <div className="space-y-4" data-testid="email-template-library">
      <p className="text-xs text-muted-foreground">{copy.makerChecker}</p>
      <Button disabled={busy || !capability?.canManage} onClick={() => { setError(false); setDraft(blankTemplate()); }}>{copy.newTemplate}</Button>
      {!library.templates.isLoading && !library.templates.isError && templates.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      {templates.map(template => <article key={template.id} className="rounded-lg border p-3 sm:p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap gap-2 items-center"><h3 className="font-semibold break-words">{template.name}</h3><Badge variant="outline">{template.category}</Badge>{!template.isActive && <Badge variant="outline">{copy.inactive}</Badge>}</div>
        {template.versions.length === 0 && <Button size="sm" variant="outline" disabled={busy || !capability?.canManage} onClick={() => { setError(false); setDraft({ ...blankTemplate(), templateId: template.id, name: template.name, category: template.category, language: template.language || "en" }); }}>{copy.newVersion}</Button>}
        {template.versions.map(version => <div key={version.id} className="border-t pt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-sm items-center"><span>v{version.version} · {version.language.toUpperCase()}</span><Badge variant={version.status === "approved" ? "default" : "secondary"}>{statusLabel(version.status)}</Badge></div>
          <p className="text-sm break-words">{version.subject}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void showPreview(version)}>{copy.preview}</Button>
            <Button size="sm" variant="outline" disabled={busy || !capability?.canManage} onClick={() => newVersion(template, version)}>{copy.newVersion}</Button>
            {version.status === "draft" && <Button size="sm" disabled={busy || !capability?.canManage} onClick={() => void action(`/versions/${version.id}/submit`)}>{copy.submit}</Button>}
            {version.status === "review" && <Button size="sm" disabled={busy || !canApproveEmail(version, user?.id) || !capability?.canManage} title={copy.makerChecker} onClick={() => setConfirmation({ path: `/versions/${version.id}/approve`, note: copy.approvalNote })}>{copy.approve}</Button>}
            {version.status === "approved" && <Button size="sm" variant="outline" disabled={busy || !capability?.canManage} onClick={() => setConfirmation({ path: `/versions/${version.id}/retire`, note: copy.retireNote })}>{copy.retire}</Button>}
          </div>
        </div>)}
      </article>)}
    </div>}
    {tab === "senders" && <div className="space-y-4" data-testid="email-sender-library">
      <p className="text-xs text-muted-foreground">{copy.senderHint}</p><p className="text-xs text-muted-foreground">{copy.verifyNote}</p>
      <Button disabled={busy || !capability?.canManage} onClick={() => { setError(false); setSenderDraft(blankSender()); }}>{copy.newSender}</Button>
      {!library.senders.isLoading && !library.senders.isError && senders.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      {senders.map(sender => <article key={sender.id} className="rounded-lg border p-3 space-y-3 min-w-0">
        <h3 className="font-semibold break-words">{sender.displayName}</h3><p className="text-sm break-all" dir="ltr">{sender.fromEmail}</p>
        <div className="flex flex-wrap gap-2"><Badge variant={sender.verified ? "default" : "secondary"}>{sender.verified ? copy.verified : copy.notVerified}</Badge><Badge variant="outline">{sender.isActive ? copy.active : copy.inactive}</Badge><span className="text-xs text-muted-foreground">r{sender.revision}</span></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !capability?.canManage} onClick={() => editSender(sender)}>{copy.edit}</Button>
          <Button size="sm" variant="outline" disabled={busy || !capability?.verificationAllowed || !canVerifyEmailSender(sender, user?.id)} onClick={() => setConfirmation({ path: `/senders/${sender.id}/verify`, body: { expectedRevision: sender.revision }, note: copy.verifyNote })}>{copy.verify}</Button></div>
      </article>)}
    </div>}
    {tab === "history" && <div className="space-y-3" data-testid="email-delivery-history">
      <p className="text-xs text-muted-foreground">{copy.historyNote}</p>
      <label className="block space-y-1 text-sm"><span>{copy.copy("Source", "Kaynak")}</span><select aria-label={copy.copy("Source", "Kaynak")} className="w-full sm:w-auto h-10 rounded-md border bg-background px-2" value={historySource} onChange={e => setHistorySource(e.target.value as "stage" | "system")}><option value="stage">{copy.copy("Application stages", "Başvuru aşamaları")}</option><option value="system">{copy.copy("System notification rules", "Sistem bildirim kuralları")}</option></select></label>
      {!history.isLoading && !history.isError && !history.data?.items.length && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      {history.data?.items.map(item => <article key={item.id} className="rounded-lg border p-3 grid sm:grid-cols-2 gap-2 text-sm">
        {historySource === "stage" ? <><div>{copy.application}: {Number.isSafeInteger(item.applicationId) && Number(item.applicationId) > 0 ? <a className="text-primary underline" href={`/admin/applications/${item.applicationId}`}>#{item.applicationId}</a> : "—"}</div><div>{copy.stage}: <span className="break-all">{item.stageKey}</span></div></> : <><div>{copy.version}: #{item.templateVersionId}</div><div>{copy.sender}: #{item.senderAccountId}</div></>}
        <div>{copy.status}: {statusLabel(item.status)}{item.queueStatus && item.queueStatus !== item.status ? ` · ${statusLabel(item.queueStatus)}` : ""}</div>
        <div>{copy.date}: {Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toLocaleString(lang) : "—"}</div>
        {item.errorCode && <div className="sm:col-span-2 break-all text-muted-foreground">{copy.reason}: {item.errorCode}</div>}
      </article>)}
      {history.data?.nextCursor && <p className="text-xs text-muted-foreground" data-testid="email-history-limit">{copy.copy("Only the latest 100 records are shown.", "Son 100 kayıt gösteriliyor.")}</p>}
    </div>}

    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !busy) setDraft(null); }}><DialogContent dir={dir} className="max-w-2xl max-h-[90vh] overflow-y-auto w-[calc(100%-2rem)]"><DialogHeader><DialogTitle>{draft?.templateId ? copy.newVersion : copy.newTemplate}</DialogTitle></DialogHeader>
      {draft && <form onSubmit={saveTemplate} className="space-y-3" data-testid="email-template-form">
        {errorNotice}<p className="text-xs text-muted-foreground">{copy.makerChecker}</p>
        {!draft.templateId && <label className="block text-sm space-y-1"><span>{copy.name}</span><Input required maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>}
        <div className="grid sm:grid-cols-2 gap-3">
          {!draft.templateId && <label className="block text-sm space-y-1"><span>{copy.category}</span><select className="w-full h-10 rounded-md border bg-background px-2" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{(capability?.categories ?? ["applications"]).map(category => <option key={category} value={category}>{category}</option>)}</select></label>}
          <label className="block text-sm space-y-1"><span>{copy.language}</span><select className="w-full h-10 rounded-md border bg-background px-2" value={draft.language} onChange={e => setDraft({ ...draft, language: e.target.value })}>{SUPPORTED_LANGUAGES.map(language => <option key={language} value={language}>{language.toUpperCase()}</option>)}</select></label>
        </div>
        <label className="block text-sm space-y-1"><span>{copy.subject}</span><Input required maxLength={240} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} /></label>
        <label className="block text-sm space-y-1"><span>{copy.content}</span><Textarea required rows={9} maxLength={100000} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></label>
        <p className="text-xs text-muted-foreground">{copy.variablesHint}</p>
        <p className="text-xs break-words">{copy.variables}: {emailTemplateVariables(draft.subject, draft.content).join(", ") || "—"}</p>
        <details className="text-xs"><summary>{copy.copy("Supported variables", "Desteklenen değişkenler")}</summary><p className="mt-2 break-words">{capability?.variables.map(variable => `{{${variable}}}`).join(" · ")}</p></details>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>{copy.cancel}</Button><Button type="submit" disabled={busy || !capability?.canManage}>{busy ? copy.loading : copy.saveDraft}</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={Boolean(senderDraft)} onOpenChange={open => { if (!open && !busy) setSenderDraft(null); }}><DialogContent dir={dir} className="max-w-2xl max-h-[90vh] overflow-y-auto w-[calc(100%-2rem)]"><DialogHeader><DialogTitle>{senderDraft?.id ? copy.edit : copy.newSender}</DialogTitle></DialogHeader>
      {senderDraft && <form onSubmit={saveSender} className="space-y-3" autoComplete="off" data-testid="email-sender-form">
        {errorNotice}<p className="text-xs text-muted-foreground">{copy.senderHint}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["displayName", "fromEmail", "fromName", "replyTo", "host", "username"] as const).map(field => <label key={field} className="block text-sm space-y-1 min-w-0"><span>{field === "displayName" ? copy.name : copy[field]}</span><Input required={field !== "replyTo"} maxLength={254} type={field === "fromEmail" || field === "replyTo" ? "email" : "text"} value={senderDraft[field]} onChange={e => setSenderDraft({ ...senderDraft, [field]: e.target.value })} /></label>)}
          <label className="block text-sm space-y-1"><span>{copy.port}</span><Input required type="number" min={1} max={65535} value={senderDraft.port} onChange={e => setSenderDraft({ ...senderDraft, port: Number(e.target.value) })} /></label>
          <label className="block text-sm space-y-1"><span>{copy.password}</span><Input required={!senderDraft.id} type="password" autoComplete="new-password" maxLength={4096} value={senderDraft.password} onChange={e => setSenderDraft({ ...senderDraft, password: e.target.value })} /></label>
        </div>
        <p className="text-xs text-muted-foreground">{copy.passwordHint}</p>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setSenderDraft(null)}>{copy.cancel}</Button><Button type="submit" disabled={busy || !capability?.canManage}>{busy ? copy.loading : copy.save}</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}><DialogContent dir={dir} className="w-[calc(100%-2rem)]"><DialogHeader><DialogTitle>{copy.confirmation}</DialogTitle></DialogHeader>
      <p className="text-sm">{confirmation?.note}</p>{errorNotice}<div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>{copy.cancel}</Button><Button disabled={busy} onClick={async () => { if (confirmation && await action(confirmation.path, confirmation.body)) setConfirmation(null); }}>{busy ? copy.loading : copy.continue}</Button></div>
    </DialogContent></Dialog>
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null); }}><DialogContent dir={dir} className="max-w-3xl w-[calc(100%-2rem)]"><DialogHeader><DialogTitle>{copy.preview}</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">{copy.previewNote}</p><p className="font-semibold break-words">{preview?.subject}</p>
      {preview && <iframe title={copy.preview} sandbox="" referrerPolicy="no-referrer" srcDoc={safeEmailPreview(DOMPurify.sanitize(preview.html, { FORBID_TAGS: ["meta", "link", "form", "script", "iframe", "object", "embed"], FORBID_ATTR: ["href", "target", "action", "formaction"] }))} className="w-full h-[50vh] rounded border bg-white" />}
    </DialogContent></Dialog>
  </Card>;
}
