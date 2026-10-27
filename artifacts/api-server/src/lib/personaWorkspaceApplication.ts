import { Router } from "express";
import { createPersonaCookieSession } from "./personaCookieSession";
import { createPersonaScopedMock } from "./personaScopedMock";
import { createPersonaScopedMockRouter } from "../routes/persona-scoped-mock";
import { createPersonaRuntimeBoundary, assertPersonaRuntime, type PersonaRuntimeBoundary } from "./personaRuntimeBoundary";
import { createPersonaAdminSession, type PersonaAdminSessionOptions } from "./personaAdminSession";

export type PersonaWorkspaceApplicationOptions = {
  pool: Parameters<typeof createPersonaScopedMock>[0];
  runtime?: PersonaRuntimeBoundary;
  socialContentLinks?: true;
} & ({
  session: Parameters<typeof createPersonaCookieSession>[0];
  adminSession?: never;
} | {
  session?: never;
  adminSession: Omit<PersonaAdminSessionOptions, "pool">;
});

/** Product-facing composition, default closed. Bootstrap must supply the real
 * cookie/session/authority adapters; no header identities, grants, keys, schema
 * creation, external provider, background polling or legacy runner fallback.
 * Mount at /api/persona-workspace BEFORE a broader API router/body parser.
 */
export function createPersonaWorkspaceApplication(options?: PersonaWorkspaceApplicationOptions) {
  if (!options) {
    const disabled = Router();
    disabled.use((_req, res) => {
      res.set("Cache-Control", "private, no-store").status(503)
        .json({ error: "PERSONA_WORKSPACE_NOT_CONFIGURED" });
    });
    return disabled;
  }
  const runtime = options.runtime ?? createPersonaRuntimeBoundary();
  assertPersonaRuntime(runtime);
  if (options.adminSession) {
    const authority = createPersonaAdminSession({ ...options.adminSession, pool: options.pool }, runtime);
    const service = createPersonaScopedMock(options.pool, { adminSession: authority }, undefined, runtime);
    const router = Router();
    // Discover only the explicitly provisioned project, using the exact same
    // current-session/project authorization as every workspace operation.
    router.get("/projects", async (request, response) => {
      response.set("Cache-Control", "private, no-store");
      try {
        const identity = await authority.resolveSession(request);
        const projectId = options.adminSession.project.projectId;
        const context = await service.workspaceContext(identity, projectId);
        response.json({ projects: [{ id: projectId, label: context.project.label }], mode: runtime.mode });
      } catch {
        response.status(403).json({ error: "PERSONA_PROJECT_ACCESS_REQUIRED" });
      }
    });
    router.use(createPersonaScopedMockRouter(service, authority.resolveSession, runtime));
    return router;
  }
  const resolve = createPersonaCookieSession(options.session, runtime);
  // Derive verifier pins from the very same issuance configuration. A separate
  // client-supplied project/role or mismatched token verifier cannot be installed.
  const { audience, environmentId, cellId, issuerId, keyRing } = options.session.issuance;
  const service = createPersonaScopedMock(options.pool, {
    audience, environmentId, cellId, issuerId, keyRing, socialContentLinks: options.socialContentLinks,
  }, undefined, runtime);
  return createPersonaScopedMockRouter(service, async (request) => {
    const identity = await resolve(request);
    if (typeof identity.sessionBoundary !== "function")
      throw new Error("PERSONA_SESSION_BOUNDARY_REQUIRED");
    return identity;
  }, runtime);
}
