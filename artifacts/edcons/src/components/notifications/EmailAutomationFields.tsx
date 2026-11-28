import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import type { StageAutomaticEmail } from "@/hooks/use-pipeline-stages";
import { useEmailLibrary } from "./useEmailLibrary";
import { approvedEmailOptions, verifiedEmailSenders, EMAIL_AUTOMATION_PATH, emailAutomationCopy, type EmailTemplate, type EmailTemplateVersion, type EmailSender } from "./emailAutomationModel";

export function EmailLibrarySelection({ templateVersionId, senderAccountId, onChange, enabled = true, stageOnly = false, allowedVariables }: {
  templateVersionId: number | null; senderAccountId: number | null;
  onChange: (selection: { templateVersionId: number | null; senderAccountId: number | null }) => void; enabled?: boolean; stageOnly?: boolean; allowedVariables?: readonly string[];
}) {
  const { lang } = useI18n();
  const copy = emailAutomationCopy(lang);
  const id = useId();
  const { templates, senders, capabilities } = useEmailLibrary(enabled);
  const catalogueLoading = templates.isLoading || senders.isLoading || capabilities.isLoading;
  const failed = templates.isError || senders.isError || capabilities.isError;
  const truncated = templates.data?.truncated || senders.data?.truncated;
  const vars = allowedVariables ?? (stageOnly ? capabilities.data?.stageVariables ?? [] : undefined);
  const catalogueVersions = approvedEmailOptions(templates.data?.templates ?? [], vars);
  const catalogueAccounts = verifiedEmailSenders(senders.data?.senders ?? []);
  // Resolve exact pinned IDs separately so pagination never turns a valid saved
  // reference into an apparently deleted option. Server revalidates on save/send.
  const pinnedVersion = useQuery({ queryKey: ["notification-email", "version", templateVersionId], enabled: enabled && !catalogueLoading && !failed && Boolean(templateVersionId) && !catalogueVersions.some(v => v.id === templateVersionId), retry: false, gcTime: 0,
    queryFn: ({ signal }) => customFetch(`/api/notification-email/versions/${templateVersionId}`, { signal, cache: "no-store" }) as Promise<{ version: EmailTemplateVersion; template: EmailTemplate }> });
  const pinnedSender = useQuery({ queryKey: ["notification-email", "sender", senderAccountId], enabled: enabled && !catalogueLoading && !failed && Boolean(senderAccountId) && !catalogueAccounts.some(a => a.id === senderAccountId), retry: false, gcTime: 0,
    queryFn: ({ signal }) => customFetch(`/api/notification-email/senders/${senderAccountId}`, { signal, cache: "no-store" }) as Promise<{ sender: EmailSender }> });
  const versions = [...catalogueVersions, ...(pinnedVersion.data && !catalogueVersions.some(v => v.id === pinnedVersion.data.version.id) ? approvedEmailOptions([{ ...pinnedVersion.data.template, versions: [pinnedVersion.data.version] }], vars) : [])];
  const accounts = [...catalogueAccounts, ...(pinnedSender.data && !catalogueAccounts.some(a => a.id === pinnedSender.data.sender.id) ? verifiedEmailSenders([pinnedSender.data.sender]) : [])];
  const loading = catalogueLoading || pinnedVersion.isFetching || pinnedSender.isFetching;
  const stale = Boolean(templateVersionId && !versions.some(v => v.id === templateVersionId)) || Boolean(senderAccountId && !accounts.some(a => a.id === senderAccountId));
  return <div className="space-y-3 min-w-0" data-testid="email-library-selection">
    {loading && <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>}
    {failed && <div role="alert" className="text-sm text-destructive">{copy.loadError} <Button type="button" variant="outline" size="sm" onClick={() => { void templates.refetch(); void senders.refetch(); void capabilities.refetch(); }}>{copy.refresh}</Button></div>}
    {truncated && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{copy.copy("The option catalogue is incomplete. Missing selections may be outside the returned range; do not clear them without checking.", "Seçenek kataloğu eksik. Görünmeyen seçimler dönen aralığın dışında olabilir; kontrol etmeden temizlemeyin.")}</p>}
    {!loading && !failed && !truncated && stale && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{copy.unavailable}</p>}
    {capabilities.data && <p className="text-xs text-muted-foreground">{capabilities.data.enabled ? copy.enabled : copy.disabled}</p>}
    <div className="grid sm:grid-cols-2 gap-3">
      <label htmlFor={`${id}-version`} className="space-y-1 text-sm min-w-0"><span>{copy.version}</span>
        <select id={`${id}-version`} className="w-full min-w-0 h-10 rounded-md border bg-background px-2" value={templateVersionId ?? ""} disabled={loading || failed || !enabled} onChange={e => onChange({ templateVersionId: e.target.value ? Number(e.target.value) : null, senderAccountId })}>
          <option value="">{copy.select}</option>
          {templateVersionId && !versions.some(v => v.id === templateVersionId) && <option value={templateVersionId} disabled>#{templateVersionId} — {copy.notVerified}</option>}
          {versions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <label htmlFor={`${id}-sender`} className="space-y-1 text-sm min-w-0"><span>{copy.sender}</span>
        <select id={`${id}-sender`} className="w-full min-w-0 h-10 rounded-md border bg-background px-2" value={senderAccountId ?? ""} disabled={loading || failed || !enabled} onChange={e => onChange({ templateVersionId, senderAccountId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{copy.select}</option>
          {senderAccountId && !accounts.some(a => a.id === senderAccountId) && <option value={senderAccountId} disabled>#{senderAccountId} — {copy.notVerified}</option>}
          {accounts.map(a => <option key={a.id} value={a.id}>{a.displayName} · {a.fromEmail}</option>)}
        </select>
      </label>
    </div>
    <a href={EMAIL_AUTOMATION_PATH} className="text-xs text-primary underline break-words">{copy.libraryLink}</a>
  </div>;
}

export function StageAutomaticEmailFields({ value, onChange, kind="application" }: { kind?:"lead"|"student"|"application"|"work"; value?: StageAutomaticEmail | null; onChange: (value: StageAutomaticEmail | null) => void }) {
  const { lang: uiLanguage } = useUiLanguage();
  const { lang, t } = useI18n();
  const copy = emailAutomationCopy(lang);
  const {capabilities}=useEmailLibrary();
  const id = useId();
  return <section className="space-y-3 rounded-lg border p-4" data-testid="stage-automatic-email">
    <h3 className="font-semibold text-sm">{copy.stageTitle}</h3>
    <p className="text-xs text-muted-foreground">{t("pipelineNotice.location")}</p>
    <p className="text-xs text-muted-foreground">{t("pipelineNotice.hint")}</p>
    <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-2">{copy.stageEnabled}</legend>
      {[true, false].map(enabled => <label key={String(enabled)} className="flex gap-2 items-center"><input type="radio" name={`${id}-enabled`} checked={(value?.enabled === true) === enabled} onChange={() => onChange(enabled ? { enabled: true, policyVersion:2, recipientType:value?.recipientType??"auto", templateVersionId: value?.templateVersionId ?? null, senderAccountId: value?.senderAccountId ?? null, originTypes: value?.originTypes ?? ["direct"] } : null)} />{t(enabled ? "common.yes" : "common.no")}</label>)}
    </fieldset>
    {value?.enabled && <>
      <PipelineNoticeRecipient value={value.recipientType??'auto'} work={kind==='work'} onChange={recipientType=>onChange({...value,policyVersion:2,recipientType})} />
      <EmailLibrarySelection allowedVariables={capabilities.data?.variablesByKind?.[kind]??[]} templateVersionId={value.templateVersionId} senderAccountId={value.senderAccountId} onChange={selection => onChange({ ...value, policyVersion:2, recipientType:value.recipientType??"auto", ...selection })} />
      <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-2">{copy.origin}</legend>
        {(["direct", "agent", "sub_agent"] as const).map(origin => <label key={origin} className="inline-flex gap-2 items-center"><input type="checkbox" checked={value.originTypes.includes(origin)} onChange={e => onChange({ ...value, originTypes: e.target.checked ? [...value.originTypes, origin] : value.originTypes.filter(v => v !== origin) })} />{origin === "direct" ? translateUi(uiLanguage, "Direct") : origin === "agent" ? copy.copy("Agent", "Acente") : copy.copy("Sub-agent", "Alt acente")}</label>)}
      </fieldset><p className="text-xs text-muted-foreground">{copy.originHint}</p>
    </>}
  </section>;
}

export function PipelineNoticeRecipient({value,onChange,work=false}:{value:'auto'|'contact'|'agent'|'assignee';onChange:(v:'auto'|'contact'|'agent'|'assignee')=>void;work?:boolean}){const {t}=useI18n();return <label className="block space-y-1 text-sm"><span>{t('pipelineNotice.recipient')}</span><select className="w-full h-10 rounded-md border bg-background px-2" value={value} onChange={e=>onChange(e.target.value as typeof value)}>{(['auto','contact',...(!work?['agent']:[]),'assignee'] as const).map(v=><option key={v} value={v}>{t('pipelineNotice.'+v)}</option>)}</select></label>;}
