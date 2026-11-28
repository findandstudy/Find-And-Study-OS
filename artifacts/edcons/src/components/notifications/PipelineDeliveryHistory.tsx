import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useI18n } from "@/hooks/use-i18n";

type Delivery = {
  id: string;
  recordId: string;
  stageKey: string;
  channel: "email" | "whatsapp";
  status: string;
  errorCode: string | null;
  providerReference: string | null;
  updatedAt: string;
};

export function PipelineDeliveryHistory({ endpoint, recordType }: {
  endpoint: string;
  recordType?: "lead" | "student" | "application";
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ["pipeline-delivery-history", endpoint],
    queryFn: ({ signal }) => customFetch<{ items: Delivery[] }>(endpoint, { signal, cache: "no-store" }),
    enabled: open,
    staleTime: 5_000,
  });
  const statusLabel = (status: string) => {
    if (status === "sent" || status === "delivered") return t("inbox.status.sent");
    if (status === "queued" || status === "processing" || status === "pending" || status === "retrying") return t("inbox.status.pending");
    if (status === "failed") return t("inbox.status.failed");
    if (status === "skipped" || status === "cancelled") return t("portalAutomation.submissions.statusSkipped");
    return t("common.unknown");
  };
  return <details className="rounded-md border p-2.5 text-xs" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-medium">{t("workPipelines.historyText")} · {t("common.email")} / {t("messagesPage.whatsapp")}</summary>
    {open && <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
      {history.isPending ? <p role="status">{t("common.loading")}</p>
        : history.isError ? <p role="alert">{t("common.error")}</p>
        : history.data?.items.length ? history.data.items.map(item => {
          const record = recordType && /^\d+$/.test(item.recordId) ? `/staff/${recordType}s/${item.recordId}` : null;
          return <div key={item.id} className="rounded border p-2 break-words">
            <div className="flex flex-wrap justify-between gap-1 font-medium">
              <span>{item.channel === "email" ? t("common.email") : t("messagesPage.whatsapp")} · {statusLabel(item.status)}</span>
              <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(lang)}</time>
            </div>
            <p className="mt-1 text-muted-foreground">
              {record && <><Link href={record} className="text-primary underline">#{item.recordId}</Link> · </>}
              {item.stageKey}{item.errorCode && <> · <bdi>{item.errorCode}</bdi></>}
            </p>
            {item.providerReference && <p className="mt-1 text-muted-foreground"><bdi>{item.providerReference}</bdi></p>}
          </div>;
        }) : <p>{t("common.noResults")}</p>}
    </div>}
  </details>;
}
