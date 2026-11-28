import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/components/ui/button";
import { emailLibraryKey } from "./useEmailLibrary";
import { emailAutomationCopy } from "./emailAutomationModel";

type Readiness = { runtime: boolean; delivery: boolean; worker: boolean; ready: boolean;
  counts: { approved_versions: number; verified_senders: number; total_stages: number; configured_stages: number; ready_stages: number } };
export function StageEmailReadiness() {
  const { lang, t } = useI18n();
  const copy = emailAutomationCopy(lang);
  const query = useQuery({ queryKey: [...emailLibraryKey, "readiness"], retry: false, staleTime: 0, gcTime: 0,
    queryFn: ({ signal }) => customFetch("/api/notification-email/readiness", { signal, cache: "no-store" }) as Promise<Readiness> });
  const data = query.data;
  return <section className="rounded-lg border p-3 space-y-2 text-sm" aria-label={t("stageEmail.readiness")} data-testid="stage-email-readiness">
    <h3 className="font-semibold">{t("stageEmail.readiness")}</h3>
    {query.isLoading && <p role="status">{copy.loading}</p>}
    {query.isError && <p role="alert">{copy.loadError}</p>}
    {data && <ul className="grid sm:grid-cols-2 gap-2" aria-live="polite">
      {([[t("stageEmail.runtime"), data.runtime], [t("stageEmail.delivery"), data.delivery], [t("stageEmail.worker"), data.worker]] as const).map(([label, ok]) => <li key={label}>{label}: <strong>{ok ? copy.active : copy.inactive}</strong></li>)}
      <li>{copy.version}: <strong>{data.counts.approved_versions}</strong></li>
      <li>{copy.sender}: <strong>{data.counts.verified_senders}</strong></li>
      <li>{t("stageEmail.readyStages")}: <strong>{data.counts.ready_stages} / {data.counts.total_stages}</strong> · {t("stageEmail.configured")}: {data.counts.configured_stages}</li>
    </ul>}
    <a href="/admin/settings?tab=pipeline" className="inline-block text-primary underline">{copy.stageTitle}</a>
    <Button type="button" variant="ghost" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{copy.refresh}</Button>
  </section>;
}
