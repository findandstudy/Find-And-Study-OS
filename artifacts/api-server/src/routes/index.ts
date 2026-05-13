import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import leadsRouter from "./leads";
import studentsRouter from "./students";
import agentsRouter from "./agents";
import applicationsRouter from "./applications";
import documentsRouter from "./documents";
import universitiesRouter from "./universities";
import financeRouter from "./finance";
import contentRouter from "./content";
import settingsRouter from "./settings";
import auditRouter from "./audit";
import statsRouter from "./stats";
import catalogRouter from "./catalog";
import aiExtractRouter from "./ai-extract";
import pipelineRouter from "./pipeline";
import courseFinderRouter from "./course-finder";
import storageRouter from "./storage";
import rolesRouter from "./roles";
import messagesRouter from "./messages";
import notificationsRouter from "./notifications";
import integrationsRouter from "./integrations";
import activityRouter from "./activity";
import applicationStageDocumentsRouter from "./applicationStageDocuments";
import embedRouter from "./embed";
import publicApplyRouter from "./public-apply";
import destinationsRouter from "./destinations";
import quickLinksRouter from "./quickLinks";
import exportRouter from "./export";
import programDocumentRequirementsRouter from "./programDocumentRequirements";
import degreeDocumentRequirementsRouter from "./degreeDocumentRequirements";
import websiteRouter from "./website";
import tasksRouter from "./tasks";
import campaignsRouter from "./campaigns";
import inboxRouter from "./inbox";
import popupsRouter from "./popups";
import branchesRouter from "./branches";
import contractTemplatesRouter from "./contractTemplates";
import contractsRouter from "./contracts";
import publicSigningRouter from "./publicSigning";
import universityContractsRouter from "./universityContracts";
import agentOnboardingRouter, { ONBOARDING_HELPERS } from "./agentOnboarding";
import leadAssignmentRulesRouter from "./leadAssignmentRules";

const router: IRouter = Router();

// ────────────────────────────────────────────────────────────────────────────
// Agent onboarding gate. Runs after the global authMiddleware. For users in
// AGENT_ROLES, blocks all but the allow-listed endpoints until the user has
// (a) verified their email, AND (b) signed their primary onboarding contract.
// Returns 403 with an explicit code so the client can render the right lock
// screen (verify-email, sign-contract, contract-expired).
// ────────────────────────────────────────────────────────────────────────────
const AGENT_ROLES = new Set(["agent", "sub_agent", "agent_staff"]);
const ALLOWLIST_EXACT = new Set([
  "/auth/me", "/auth/logout",
  "/agents/me/onboarding-status",
  "/agents/me/resend-verification",
  "/agents/me/verify-email",
  "/contracts/me",
  "/contracts/me/sign",
  "/settings/branding",
  "/settings/branding/logo",
  "/settings/available-years",
  "/health",
]);
const ALLOWLIST_PREFIX = ["/storage/", "/auth/"];

router.use(async (req, res, next) => {
  // Public/unauth endpoints just pass through.
  if (!req.user || !AGENT_ROLES.has(req.user.role)) { next(); return; }
  const path = req.path;
  if (ALLOWLIST_EXACT.has(path)) { next(); return; }
  for (const p of ALLOWLIST_PREFIX) { if (path.startsWith(p)) { next(); return; } }
  // Email gate.
  if (!req.user.emailVerified) {
    res.status(403).json({ error: "Email verification required", code: "EMAIL_VERIFICATION_REQUIRED" });
    return;
  }
  // Contract gate (primary onboarding only).
  try {
    const agent = await ONBOARDING_HELPERS.loadAgentForUser(req.user.id, req.user.role);
    if (!agent) { next(); return; }
    let session = await ONBOARDING_HELPERS.loadOnboardingSession(agent.id);
    if (!session) { next(); return; }
    session = await ONBOARDING_HELPERS.lazyExpire(session);
    if (session.status === "signed") { next(); return; }
    if (session.status === "expired") {
      res.status(403).json({ error: "Onboarding contract expired", code: "CONTRACT_EXPIRED" });
      return;
    }
    if (session.status === "revoked") {
      res.status(403).json({ error: "Onboarding contract revoked", code: "CONTRACT_EXPIRED" });
      return;
    }
    res.status(403).json({ error: "Contract signature required", code: "CONTRACT_SIGNATURE_REQUIRED" });
  } catch (err) {
    console.error("[agent-onboarding-gate]", err);
    next();
  }
});

router.use(healthRouter);
router.use(storageRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(leadsRouter);
router.use(studentsRouter);
router.use(agentsRouter);
router.use(applicationsRouter);
router.use(documentsRouter);
router.use(universitiesRouter);
router.use(financeRouter);
router.use(contentRouter);
router.use(settingsRouter);
router.use(auditRouter);
router.use(statsRouter);
router.use(catalogRouter);
router.use(aiExtractRouter);
router.use(pipelineRouter);
router.use(courseFinderRouter);
router.use(rolesRouter);
router.use(messagesRouter);
router.use(notificationsRouter);
router.use(integrationsRouter);
router.use(activityRouter);
router.use(applicationStageDocumentsRouter);
router.use(embedRouter);
router.use(publicApplyRouter);
router.use(destinationsRouter);
router.use(quickLinksRouter);
router.use(exportRouter);
router.use(programDocumentRequirementsRouter);
router.use(degreeDocumentRequirementsRouter);
router.use(websiteRouter);
router.use(tasksRouter);
router.use(campaignsRouter);
router.use(inboxRouter);
router.use(popupsRouter);
router.use(branchesRouter);
router.use(contractTemplatesRouter);
router.use(contractsRouter);
router.use(publicSigningRouter);
router.use(universityContractsRouter);
router.use(agentOnboardingRouter);
router.use(leadAssignmentRulesRouter);

export default router;
