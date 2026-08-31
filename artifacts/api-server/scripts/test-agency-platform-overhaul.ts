import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const api = (relative: string) => readFile(path.resolve(here, "../src", relative), "utf8");
const ui = (relative: string) => readFile(path.resolve(here, "../../edcons/src", relative), "utf8");
const uiRoot = (relative: string) => readFile(path.resolve(here, "../../edcons", relative), "utf8");
const migration = (name: string) => readFile(path.resolve(here, "../../../lib/db/drizzle", name), "utf8");

test("agency codes use an immutable FAS date-linked default", async () => {
  const sql = await migration("0059_fas_agency_codes.sql");
  const agents = await api("routes/agents.ts");
  assert.match(sql, /FAS-/);
  assert.match(sql, /YYYYMMDD/);
  assert.match(sql, /legacy_agency_code/);
  assert.match(sql, /UPDATE agents[\s\S]*SET agency_code/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS agents_fas_agency_code_unique/);
  assert.match(agents, /ilike\(agentsTable\.legacyAgencyCode/);
});

test("platform and agency assignment lanes are physically independent", async () => {
  const sql = await migration("0060_scoped_record_assignments.sql");
  const leads = await api("routes/leads.ts");
  const students = await api("routes/students.ts");
  const inbound = await api("lib/inbox/processInbound.ts");
  assert.match(sql, /leads[\s\S]*agency_assigned_to_id/);
  assert.match(sql, /students[\s\S]*agency_assigned_to_id/);
  assert.match(leads, /agencyAssignedToId/);
  assert.match(students, /agencyAssignedToId/);
  assert.match(inbound, /applyLeadAssignmentRules\(\{[\s\S]*agentId: matched\.id/);
});

test("pipeline audience and automatic-message origin are independently configured", async () => {
  const sql = await migration("0061_pipeline_stage_audiences.sql");
  const route = await api("routes/pipeline.ts");
  const audience = await api("lib/pipelineAudience.ts");
  const applications = await api("routes/applications.ts");
  const leads = await api("routes/leads.ts");
  const students = await api("routes/students.ts");
  const editor = await ui("components/EditStagesDialog.tsx");
  assert.match(sql, /visible_to_roles/);
  assert.match(sql, /transition_allowed_roles/);
  assert.match(sql, /originTypes/);
  assert.match(route, /stageAudienceAllows/);
  assert.match(audience, /canTransitionToPipelineStage/);
  assert.match(applications, /canTransitionToPipelineStage/);
  assert.ok((leads.match(/canTransitionToPipelineStage/g) ?? []).length >= 2, "lead single and bulk transitions must be guarded");
  assert.ok((students.match(/canTransitionToPipelineStage/g) ?? []).length >= 2, "student single and bulk transitions must be guarded");
  assert.ok((applications.match(/canTransitionToPipelineStage/g) ?? []).length >= 2, "application single and bulk transitions must be guarded");
  assert.match(editor, /visibleToRoles/);
  assert.match(editor, /transitionAllowedRoles/);
  assert.match(editor, /Direct/);
});

test("tenant packages, branding and integrations are isolated and encrypted", async () => {
  const sql = await migration("0062_agent_tenant_capabilities.sql");
  const agents = await api("routes/agents.ts");
  const features = await api("lib/agentFeatures.ts");
  assert.match(sql, /agent_integrations/);
  assert.match(sql, /primary_brand_color/);
  assert.match(sql, /secondary_brand_color/);
  assert.match(features, /embed_ai/);
  assert.match(features, /whatsapp_integration/);
  assert.match(agents, /encryptConfig/);
  assert.match(agents, /maskSecrets/);
  assert.match(agents, /channelAvailability/);
});

test("agency SMTP sends manual and student notification email without leaking into local runs", async () => {
  const email = await api("lib/email.ts");
  const notifications = await api("lib/notificationDispatcher.ts");
  const messages = await api("routes/messages.ts");
  assert.match(email, /export async function sendTenantEmail/);
  assert.match(email, /isLiveIntegrationsEnabled/);
  assert.doesNotMatch(email, /ALLOW_LIVE_INTEGRATIONS !== "true"/);
  assert.match(email, /assertSafeTenantSmtpDestination/);
  assert.match(email, /host: resolvedHost/);
  assert.match(email, /tlsServername: isIP\(originalHost\)/);
  assert.match(notifications, /getStudentTenantSmtp/);
  assert.match(notifications, /getStudentTenantWhatsApp/);
  assert.match(notifications, /resolveAgentFeatures\(owned\.planTier, owned\.featureOverrides\)\.email_integration/);
  assert.match(notifications, /resolveAgentFeatures\(owned\.planTier, owned\.featureOverrides\)\.whatsapp_integration/);
  assert.match(notifications, /await sendTenantEmail\(tenantSmtp, user\.email, emailContent\)/);
  assert.match(notifications, /tenantConfig \|\| await getWhatsAppConfig\(\)/);
  assert.match(messages, /dispatched = await sendTenantEmail/);
});

test("agency embed is tenant-scoped and AI is entitlement gated", async () => {
  const route = await api("routes/agentEmbed.ts");
  const agents = await api("routes/agents.ts");
  const publicEmbed = await api("routes/embed.ts");
  const account = await ui("pages/agent/Account.tsx");
  assert.match(route, /eq\(embedWidgetsTable\.agentId, agent\.id\)/);
  assert.match(route, /features\.embed_standard/);
  assert.match(route, /features\.embed_ai/);
  assert.match(route, /value === "combined"/);
  assert.match(route, /value === "course_finder"/);
  assert.match(route, /normalizeAgentEmbedFilters/);
  assert.match(route, /values\.presetFilters = normalizedFilters\.presetFilters/);
  assert.match(route, /values\.lockedFilters = normalizedFilters\.lockedFilters/);
  assert.match(route, /embedApiKey: _secret/);
  assert.doesNotMatch(route, /theme\.logoUrl/);
  assert.match(account, /AI study assistant/);
  assert.match(account, /Course finder \+ application form/);
  assert.match(account, /Program catalog \+ Apply/);
  assert.match(account, /Website Widgets/);
  assert.match(account, /Contact \/ Lead Form/);
  assert.match(account, /Legacy HTML Form/);
  assert.match(account, /<Collapsible open=\{legacyFormOpen\}/);
  assert.match(account, /Program catalog filters/);
  assert.match(account, /Select universities/);
  assert.match(account, /presetFilters/);
  assert.match(account, /data-edcons-widget/);
  assert.match(account, /data-edcons-token-url/);
  assert.match(account, /onsubmit="this\.phone\.value=this\.phoneCode\.value\+this\.phoneNumber\.value/);
  assert.match(account, /\/api\/agents\/me\/web-to-lead-preview/);
  assert.match(agents, /style-src 'unsafe-inline'; script-src 'none'/);
  assert.match(publicEmbed, /\/public\/embed\/:slug\/agent-token/);
  assert.match(publicEmbed, /originMatchesAllowedDomains/);
  assert.match(publicEmbed, /eq\(leadsTable\.agentId, widget\.agentId\)/);
  assert.match(publicEmbed, /eq\(studentsTable\.agentId, widget\.agentId\)/);
  assert.doesNotMatch(publicEmbed, /if\(MODE!=='course_finder'\)\{\s*h\+='<button class="ew-btn" data-apply=/);
});

test("agency message channels are capability-driven and API-enforced", async () => {
  const route = await api("routes/messages.ts");
  const quickContact = await ui("components/QuickContact.tsx");
  assert.match(quickContact, /channelAvailability/);
  assert.match(quickContact, /availability\[ch\.key\]/);
  assert.match(route, /channel_not_enabled/);
  assert.match(route, /tenantAgentId/);
  assert.match(route, /await sendWhatsAppText/);
  assert.doesNotMatch(route, /graph\.facebook\.com\/v21\.0/);
  assert.match(route, /liveIntegrationsDisabled: true/);
  assert.match(route, /sendTenantEmail/);
  assert.match(route, /tenantRecipientEmail/);
  assert.match(route, /allowedContacts\.has\(recipientUserId\)/);
  assert.match(quickContact, /!hideEmail && \(!isAgentSide \|\| availability\.email\)/);
  assert.match(quickContact, /!hideWhatsApp && \(!isAgentSide \|\| availability\.whatsapp\)/);
});

test("agent document uploads are both feature-gated and ownership-scoped", async () => {
  const leadRoute = await api("routes/leads.ts");
  const documentRoute = await api("routes/documents.ts");
  const leadUi = await ui("pages/staff/LeadDetail.tsx");
  assert.match(leadRoute, /lead_document_upload/);
  assert.match(leadRoute, /callerOwnsObject/);
  assert.match(documentRoute, /lead_document_upload/);
  assert.match(documentRoute, /callerOwnsObject/);
  assert.match(leadUi, /canUploadLeadDocuments/);
});

test("internal message filters and notification read sync are present", async () => {
  const route = await api("routes/messages.ts");
  const page = await ui("pages/staff/Messages.tsx");
  assert.match(route, /audience/);
  assert.match(route, /readState/);
  assert.match(route, /conversationParticipantsTable\.lastReadAt/);
  assert.match(route, /notificationsTable\.data/);
  assert.match(route, /\/agent\/messages\?conversation=/);
  assert.match(route, /\/staff\/messages\?tab=internal&conversation=/);
  assert.match(page, /internalAudience/);
  assert.match(page, /internalReadState/);
  assert.match(page, /internalArchived/);
  assert.match(page, /params\.get\("tab"\) === "internal"/);
});

test("agency application evidence remains linked to the approved agency profile", async () => {
  const applications = await api("routes/agentApplications.ts");
  const agents = await api("routes/agents.ts");
  const objectAuthz = await api("lib/objectAuthz.ts");
  assert.match(applications, /logoUrl: application\.logoFileKey/);
  assert.match(applications, /agentIdProofUrl: application\.representativeIdFileKey/);
  assert.match(applications, /businessCertUrl: application\.businessRegistrationFileKey/);
  assert.match(agents, /browserStorageUrl\(agent\.logoUrl\)/);
  assert.match(agents, /browserStorageUrl\(agent\.businessCertUrl\)/);
  assert.match(objectAuthz, /matchKey\(agentsTable\.logoUrl, key\)/);
  assert.match(objectAuthz, /matchKey\(agentsTable\.agentIdProofUrl, key\)/);
  assert.match(objectAuthz, /matchKey\(agentsTable\.businessCertUrl, key\)/);
});

test("academy and agency favicon branding are tenant capability scoped", async () => {
  const sso = await api("routes/academySso.ts");
  const agents = await api("routes/agents.ts");
  const layout = await ui("components/layout/DashboardLayout.tsx");
  const brandingHook = await ui("hooks/use-agency-branding.ts");
  const html = await uiRoot("index.html");
  const favicon = await uiRoot("public/favicon.svg");
  assert.match(sso, /tenantAcademyEnabled/);
  assert.match(sso, /resolveAgentFeatures/);
  assert.match(agents, /async function withAcademyAccess/);
  assert.match(agents, /async function resolveAcademyAccessByUserIds/);
  assert.match(agents, /rolesTable\.permissions/);
  assert.match(agents, /applyPermissionOverrides/);
  assert.doesNotMatch(agents, /user\.role === "super_admin" \|\| user\.role === "admin"/);
  assert.match(agents, /async function setUserAcademyAccessOverride/);
  assert.match(agents, /await setUserAcademyAccessOverride\(targetAgent\.userId, parsed\.data\.academyAccess\)/);
  assert.doesNotMatch(agents, /parsed\.data\.academyAccess === roleDefault/);
  assert.match(agents, /data: dataWithAcademyAccess/);
  assert.match(agents, /Not your sub-agent/);
  assert.match(layout, /academyAvailable/);
  assert.doesNotMatch(layout, /agentIcon/);
  assert.match(brandingHook, /queryKey:\s*\["agent-me"\]/);
  assert.match(brandingHook, /link\[rel="icon"\]/);
  assert.match(html, /%BASE_URL%favicon\.svg/);
  assert.match(html, /%BASE_URL%apple-touch-icon\.png/);
  assert.match(favicon, /F&amp;S/);
});

test("agent dashboard prioritizes deadlines and follow-ups before growth", async () => {
  const dashboard = await ui("pages/agent/Dashboard.tsx");
  const leadRoute = await api("routes/leads.ts");
  const deadlinesIndex = dashboard.indexOf("<OfferDeadlinesWidget");
  const followUpsIndex = dashboard.indexOf("<UpcomingFollowUpsWidget");
  const growthIndex = dashboard.indexOf('t("agentDash.growthOverview")');
  assert.ok(deadlinesIndex >= 0, "offer deadline widget must be rendered");
  assert.ok(followUpsIndex > deadlinesIndex, "follow-ups must sit beside deadlines");
  assert.ok(growthIndex > followUpsIndex, "growth overview must follow the operational widgets");
  assert.match(dashboard, /grid-cols-1 lg:grid-cols-2/);
  assert.match(leadRoute, /staffPermissions\.has\("leads"\)/);
  assert.match(leadRoute, /staffPermissions\.has\("students"\)/);
});

test("lead and student document type pickers are searchable", async () => {
  const lead = await ui("pages/staff/LeadDetail.tsx");
  const student = await ui("pages/staff/StudentDetail.tsx");
  for (const source of [lead, student]) {
    assert.match(source, /<SearchableSelect/);
    assert.match(source, /searchPlaceholder="Search document types\.\.\."/);
  }
});

test("course finder counts mandatory documents and reuses accepted files on record", async () => {
  const finder = await ui("pages/staff/CourseFinder.tsx");
  const courseFinderRoute = await api("routes/course-finder.ts");
  const mandatory = await api("lib/mandatoryDocs.ts");
  assert.match(finder, /requiredDocKeys = currentDocs\.filter\(d => d\.required\)/);
  assert.match(finder, /findMissingMandatoryTypes\(\[k\], existingDocTypes\)/);
  assert.match(finder, /missingRequiredCount/);
  assert.match(mandatory, /ne\(documentsTable\.status, "rejected"\)/);
  assert.match(mandatory, /findMissingMandatoryTypes/);
  assert.match(mandatory, /const openStageRequests[\s\S]*if \(openStageRequests\.length > 0\) return false/);
  assert.match(courseFinderRoute, /assignedToId: student\.assignedToId \|\| null/);
});

test("agent messaging contacts stay tenant-scoped and dashboard deep links preselect recipients", async () => {
  const messages = await api("routes/messages.ts");
  const dashboard = await ui("pages/agent/Dashboard.tsx");
  const agentMessages = await ui("pages/agent/Messages.tsx");
  assert.match(messages, /getAgentContactUserIds/);
  assert.match(messages, /getAgencyStaffWithLegacy/);
  assert.match(messages, /usersTable\.managingAgentId/);
  assert.match(messages, /studentsTable\.agentId/);
  assert.match(messages, /allowedContacts\.has\(targetUserId\)/);
  assert.match(dashboard, /\/agent\/messages\?recipient=/);
  assert.match(agentMessages, /params\.get\("recipient"\)/);
  assert.match(agentMessages, /startConversation\(recipientParam\)/);
  assert.match(agentMessages, /s\.email \|\| ""/);
});
