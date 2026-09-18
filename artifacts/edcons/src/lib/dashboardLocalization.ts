type Translate = (key: string) => string;

// Audit storage stays unchanged. Unknown events retain their exact diagnostic code.
const actions: Record<string, string> = {
  "auth.login.success": "login.signIn",
  "auth.logout": "dashboard.signOut",
  "platform_config.settings.update": "common.update",
  update_user: "common.update",
  create_user: "common.create",
  delete_user: "common.delete",
  create_lead: "common.create", update_lead: "common.update", delete_lead: "common.delete",
  create_student: "common.create", update_student: "common.update", delete_student: "common.delete",
  create_application: "common.create", update_application: "common.update", delete_application: "common.delete",
  create_document: "common.create", delete_document: "common.delete",
};
const resources: Record<string, string> = {
  user: "adminAudit.colUser", settings: "dashboard.settings",
  lead: "followUps.lead", student: "followUps.student",
  application: "dashboard.applications", conversation: "dashboard.messages",
  document: "dashboard.documents", agent: "dashboard.agent",
};

export function dashboardActivityLabels(action: string, resource: string, t: Translate) {
  return {
    actionLabel: Object.hasOwn(actions, action) ? t(actions[action]) : action,
    resourceLabel: Object.hasOwn(resources, resource) ? t(resources[resource]) : resource,
  };
}

export function dashboardActivityHref(portal: "staff" | "agent", resource: string, id: unknown) {
  const paths: Record<string, string> = { application: "applications", student: "students", lead: "leads" };
  return Object.hasOwn(paths, resource) && Number.isSafeInteger(Number(id)) && Number(id) > 0
    ? `/${portal}/${paths[resource]}/${id}` : null;
}
