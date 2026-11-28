import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import {
  StageAutomaticEmailFields,
  PipelineNoticeRecipient,
} from "./EmailAutomationFields";
import type {
  StageAutomaticEmail,
  StageAutomaticMessage,
} from "@/hooks/use-pipeline-stages";
export function WorkStageNotifications({
  value,
  onChange,
}: {
  value: {
    automaticEmail?: StageAutomaticEmail | null;
    automaticMessage?: StageAutomaticMessage | null;
  };
  onChange: (patch: Partial<typeof value>) => void;
}) {
  const { t } = useI18n();
  const message = value.automaticMessage;
  const templates = useQuery({
    queryKey: ["work-notice", "wa-templates"],
    queryFn: () =>
      customFetch(
        "/api/message-templates?channel=whatsapp&activeOnly=true",
      ) as Promise<any>,
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["work-notice", "wa-accounts"],
    queryFn: () => customFetch("/api/inbox/whatsapp-accounts") as Promise<any>,
    retry: false,
  });
  const rows = templates.data?.data ?? templates.data ?? [];
  const enabled = message?.enabled === true;
  const change = (patch: Partial<StageAutomaticMessage>) =>
    onChange({
      automaticMessage: {
        enabled: true,
        templateId: null,
        channelAccountId: null,
        originTypes: ["direct"],
        ...message,
        ...patch,
        policyVersion: 2,
        recipientType: patch.recipientType ?? message?.recipientType ?? "auto",
      },
    });
  return (
    <details className="w-full rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t("pipelineNotice.title")}
      </summary>
      <div className="mt-3 space-y-3">
        <section className="rounded-lg border p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) =>
                e.target.checked
                  ? change({ enabled: true })
                  : onChange({ automaticMessage: null })
              }
            />
            {t("editStages.sectionAutomaticMessage")}
          </label>
          {enabled && (
            <>
              <PipelineNoticeRecipient
                work
                value={message?.recipientType ?? "auto"}
                onChange={(recipientType) => change({ recipientType })}
              />
              <label className="block text-sm space-y-1">
                <span>{t("editStages.automaticMessageTemplate")}</span>
                <select
                  className="w-full h-10 border rounded-md bg-background px-2"
                  value={message?.templateId ?? ""}
                  disabled={templates.isLoading || templates.isError}
                  onChange={(e) =>
                    change({
                      templateId: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">
                    {t("editStages.automaticMessageSelectTemplate")}
                  </option>
                  {(Array.isArray(rows) ? rows : [])
                    .filter(
                      (r: any) =>
                        r.externalTemplateName &&
                        r.approvalStatus?.toLowerCase() === "approved",
                    )
                    .map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm space-y-1">
                <span>{t("editStages.automaticMessageSender")}</span>
                <select
                  className="w-full h-10 border rounded-md bg-background px-2"
                  value={message?.channelAccountId ?? ""}
                  disabled={accounts.isLoading || accounts.isError}
                  onChange={(e) =>
                    change({
                      channelAccountId: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">
                    {t("editStages.automaticMessageSelectSender")}
                  </option>
                  {(accounts.data?.accounts ?? []).map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {(templates.isError || accounts.isError) && (
                <p role="alert" className="text-sm text-destructive">
                  {t("editStages.automaticMessageLoadFailed")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("pipelineNotice.hint")}
              </p>
            </>
          )}
        </section>
        <StageAutomaticEmailFields
          kind="work"
          value={value.automaticEmail}
          onChange={(automaticEmail) => onChange({ automaticEmail })}
        />
      </div>
    </details>
  );
}
