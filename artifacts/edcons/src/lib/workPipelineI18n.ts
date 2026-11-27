import type { PipelineTranslate } from "@/pages/staff/workPipelinesCopy";
/** Show translated recovery guidance; never expose raw transport or schema errors. */
export function workPipelineError(
  error: unknown,
  t: PipelineTranslate,
): string {
  const status = Number((error as { status?: number })?.status);
  if (status === 400 || status === 422) return t("workPipelines.invalidInput");
  if (status === 403 || status === 404) return t("workPipelines.forbidden");
  if (status === 409) return t("workPipelines.conflict");
  if (
    !status &&
    error instanceof Error &&
    Object.values(localErrors).some((key) => t(key) === error.message)
  )
    return error.message;
  return t("common.error");
}
const localErrors = {
  file: "workPipelines.maximumFileSizeIs5",
  format: "workPipelines.chooseAnExcelOrCSV",
  sheet: "workPipelines.dataSheetNotFound",
  formula: "workPipelines.useFixedValuesInsteadOf",
  count: "workPipelines.fileMustContain12000Records",
};
export function workPipelineHistory(
  text: string,
  t: PipelineTranslate,
): string {
  const labels: Record<string, string> = {
    title: t("workPipelines.recordName"),
    description: t("common.description"),
    stageId: t("common.stage"),
    assigneeId: t("workPipelines.assignee"),
    dueDate: t("tasks.fields.dueDate"),
    priority: t("tasks.fields.priority"),
    status: t("common.status"),
    contactName: t("common.contactPerson"),
    email: t("common.email"),
    phone: t("common.phone"),
    tasks: t("dashboard.tasks"),
  };
  if (["channel", "embed", "web"].includes(text))
    return t(
      text === "channel"
        ? "workPipelines.messages"
        : text === "embed"
          ? "workPipelines.embedForms"
          : "workPipelines.webLead",
    );
  return text
    .split(", ")
    .map(
      (token) =>
        labels[token] ||
        (token.startsWith("assigneeId:")
          ? t("workPipelines.assignee") +
            token.slice(10).replace(/\bnone\b/g, t("workPipelines.none"))
          : token),
    )
    .join(", ");
}
