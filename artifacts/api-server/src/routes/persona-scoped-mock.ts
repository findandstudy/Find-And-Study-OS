import { Router, json, type Request, type ErrorRequestHandler } from "express";
import { PersonaSessionRateLimited } from "../lib/personaCookieSession";
import {
  createPersonaRuntimeBoundary,
  assertPersonaRuntime,
  type PersonaRuntimeBoundary,
} from "../lib/personaRuntimeBoundary";
import { z } from "zod";
import { createPersonaWorkflowRunner } from "../lib/personaWorkflowRunner";
import {
  createPersonaScopedMock,
  type PersonaMockIdentity,
} from "../lib/personaScopedMock";

/** Explicit composition supplies its own
 * authenticated session adapter; caller-supplied roles/project grants ignored. */
export function createPersonaScopedMockRouter(
  service: ReturnType<typeof createPersonaScopedMock>,
  resolveSession: (req: Request) => Promise<PersonaMockIdentity | null>,
  runtime: PersonaRuntimeBoundary = createPersonaRuntimeBoundary(),
) {
  assertPersonaRuntime(runtime);
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
      assertPersonaRuntime(runtime);
    } catch {
      res.status(403).json({ error: "PERSONA_MOCK_ONLY" });
      return;
    }
    next();
  });
  router.use(json({ limit: "32kb" }));
  const rejectInvalidJson: ErrorRequestHandler = (_error, _req, res, _next) => {
    // Do not return body-parser diagnostics, payloads or stack traces.
    res.status(400).json({ error: "PERSONA_INVALID_BODY" });
  };
  router.use(rejectInvalidJson);
  const uuid = z.string().uuid();
  const id = z.coerce.number().int().positive();
  const endpoint =
    (
      operation: (
        identity: PersonaMockIdentity,
        project: string,
        req: Request,
      ) => Promise<unknown>,
    ) =>
    async (req: Request, res: any) => {
      res.set("Cache-Control", "private, no-store");
      try {
        const identity = await resolveSession(req);
        if (!identity) {
          res.status(401).json({ error: "PERSONA_AUTH_REQUIRED" });
          return;
        }
        const project = uuid.parse(req.params.project);
        const result = await operation(identity, project, req);
        res.set("Cache-Control", "private, no-store").json(result);
      } catch (error) {
        if (error instanceof PersonaSessionRateLimited) {
          res.set("Retry-After", String(error.retryAfterSeconds));
          res.status(429).json({
            error: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          });
          return;
        }
        const code =
          error instanceof Error && /^PERSONA_[A-Z_]+$/.test(error.message)
            ? error.message
            : "PERSONA_REQUEST_REJECTED";
        res
          .status(error instanceof z.ZodError ? 400 : 409)
          .json({ error: code });
      }
    };
  router.get("/:project/context", endpoint((a, p) => service.workspaceContext(a, p)));
  router.get("/:project/social-content/:brief", endpoint((a, p, req) => service.socialSource(a, p, uuid.parse(req.params.brief))));
  router.get("/:project/social-content/:brief/workflows", endpoint((a, p, req) => service.socialLinks(a, p, uuid.parse(req.params.brief))));
  router.get("/:project/workflows/:id/social-source", endpoint((a, p, req) => service.workflowSocialSource(a, p, id.parse(req.params.id))));
  router.post("/:project/social-links", endpoint((a, p, req) => service.linkSocialWorkflow(a, p, req.body)));
  router.get(
    "/:project/personas",
    endpoint((a, p) => service.list(a, p)),
  );
  router.post(
    "/:project/messages",
    endpoint((a, p, r) => service.appendMessage(a, p, r.body)),
  );
  router.get(
    "/:project/conversations/:id",
    endpoint((a, p, r) => service.conversation(a, p, uuid.parse(r.params.id))),
  );
  router.post(
    "/:project/messages/purge-expired",
    endpoint((a, p) => service.purgeExpiredMessages(a, p)),
  );
  router.post(
    "/:project/workflows",
    endpoint((a, p, r) => {
      const b = z
        .object({
          requestKey: z.string().min(8).max(100),
          document: z.unknown(),
        })
        .strict()
        .parse(r.body);
      return service.createWorkflow(a, p, b.requestKey, b.document);
    }),
  );
  router.get(
    "/:project/workflows",
    endpoint((a, p) => service.workflows(a, p)),
  );
  router.get(
    "/:project/workflows/:id",
    endpoint((a, p, r) => service.workflow(a, p, id.parse(r.params.id))),
  );
  router.post(
    "/:project/workflows/:id/review",
    endpoint((a, p, r) => {
      const b = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(r.body);
      return service.reviewWorkflowResult(
        a,
        p,
        id.parse(r.params.id),
        b.digest,
      );
    }),
  );
  router.post(
    "/:project/workflows/:id/advance",
    endpoint((a, p, r) => service.advanceWorkflow(a, p, id.parse(r.params.id))),
  );
  router.post(
    "/:project/workflows/:id/run-step",
    endpoint((a, p, r) =>
      createPersonaWorkflowRunner(service)(a, p, id.parse(r.params.id)),
    ),
  );
  router.post(
    "/:project/workflows/:id/cancel",
    endpoint((a, p, r) => service.cancelWorkflow(a, p, id.parse(r.params.id))),
  );
  router.get(
    "/:project/teams",
    endpoint((a, p) => service.teams(a, p)),
  );
  router.post(
    "/:project/team-drafts/:id/install",
    endpoint((a, p, r) => {
      const body = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(r.body);
      return service.installTeam(a, p, id.parse(r.params.id), body.digest);
    }),
  );
  router.post(
    "/:project/teams/:id/pause",
    endpoint((a, p, r) => {
      const body = z.object({ paused: z.boolean() }).strict().parse(r.body);
      return service.setTeamPaused(a, p, uuid.parse(r.params.id), body.paused);
    }),
  );
  router.get(
    "/:project/team-drafts",
    endpoint((a, p) => service.teamDrafts(a, p)),
  );
  router.get(
    "/:project/team-workspace",
    endpoint((a, p) => service.teamWorkspace(a, p)),
  );
  router.put(
    "/:project/team-workspace",
    endpoint((a, p, r) => service.saveTeamWorkspace(a, p, r.body)),
  );
  router.post(
    "/:project/team-drafts",
    endpoint((a, p, r) => {
      const body = z
        .object({ personaId: id.optional(), document: z.unknown() })
        .strict()
        .parse(r.body);
      return service.proposeTeam(a, p, body.personaId, body.document);
    }),
  );
  router.post(
    "/:project/team-drafts/:id/approve",
    endpoint((a, p, r) => {
      const body = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(r.body);
      return service.approveTeam(a, p, id.parse(r.params.id), body.digest);
    }),
  );
  router.get(
    "/:project/history",
    endpoint((a, p) => service.history(a, p)),
  );
  router.get(
    "/:project/approvals/:id",
    endpoint((a, p, r) => service.review(a, p, id.parse(r.params.id))),
  );
  router.post(
    "/:project/proposals",
    endpoint((a, p, r) => {
      const body = z
        .object({
          personaId: id,
          content: z.string().min(1).max(16000),
          target: z.string().min(1).max(256),
        })
        .strict()
        .parse(r.body);
      return service.propose(a, p, body.personaId, body.content, body.target);
    }),
  );
  router.get(
    "/:project/proposals",
    endpoint((a, p) => service.proposals(a, p)),
  );
  router.post(
    "/:project/approvals/:id",
    endpoint((a, p, r) => {
      const body = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(r.body);
      return service.approve(a, p, id.parse(r.params.id), body.digest);
    }),
  );
  router.post(
    "/:project/executions/:id",
    endpoint((a, p, r) => service.execute(a, p, id.parse(r.params.id))),
  );
  router.post(
    "/:project/reconcile/:id",
    endpoint((a, p, r) => service.reconcile(a, p, uuid.parse(r.params.id))),
  );
  return router;
}
