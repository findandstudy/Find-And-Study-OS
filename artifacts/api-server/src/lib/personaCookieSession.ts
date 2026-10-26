import crypto from "node:crypto";
import { withPersonaSessionPreflight } from "./personaSessionPreflight";
import type { Request } from "express";
import {
  issueActiveContextForHttpSession,
  ACTIVE_CONTEXT_SESSION_GATEWAY_PATH,
  type ActiveContextSessionGatewayOptions,
} from "./activeContextSessionGateway";
import {
  verifyVersionedActiveTenantContext,
  isSelectionBoundActiveTenantContext,
} from "./activeTenantContext";
import type { PersonaMockIdentity } from "./personaScopedMock";
import {
  createPersonaRuntimeBoundary,
  assertPersonaRuntime,
  type PersonaRuntimeBoundary,
} from "./personaRuntimeBoundary";

export class PersonaSessionRateLimited extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterMs: number) {
    super("PERSONA_SESSION_RATE_LIMITED");
    this.retryAfterSeconds =
      Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0
        ? Math.min(60, Math.max(1, Math.ceil(retryAfterMs / 1000)))
        : 60;
  }
}

/** Mock composition: reuses the real cookie/CSRF gateway and session
 * repository. No header-selected actor, client scope, or synthetic role bypass. */
export function createPersonaCookieSession(
  options: Omit<ActiveContextSessionGatewayOptions, "request">,
  runtime: PersonaRuntimeBoundary = createPersonaRuntimeBoundary(),
) {
  const sessionRepository = withPersonaSessionPreflight(options.sessionRepository);
  function assertSessionRuntime() {
    assertPersonaRuntime(runtime);
    if (runtime.mode === "staging-mock" &&
      (options.trustedOrigins.length !== 1 || options.trustedOrigins[0] !== "https://staging.findandstudy.com" ||
        options.issuance.environmentId !== "staging"))
      throw new Error("PERSONA_STAGING_SESSION_CONFIG_REQUIRED");
  }
  assertSessionRuntime();
  async function issue(req: Request): Promise<PersonaMockIdentity> {
    assertSessionRuntime();
    const cookies: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [key, ...value] = part.trim().split("=");
      if (key) cookies[key] = value.join("=");
    }
    let resolvedTenant: string | undefined;
    const issued = await issueActiveContextForHttpSession({
      tokenTtlMs: 60000,
      ...options,
      sessionRepository: {
        withLockedCurrentSession(input, operation) {
          return sessionRepository.withLockedCurrentSession(
            input,
            async (state) => {
              const value = state as { tenantId?: unknown } | null;
              if (typeof value?.tenantId === "string")
                resolvedTenant = value.tenantId;
              return operation(state);
            },
          );
        },
      },
      request: {
        method: "POST",
        path: ACTIVE_CONTEXT_SESSION_GATEWAY_PATH,
        headers: req.headers,
        cookies,
        apiTokenAuth: !!req.headers.authorization,
      },
    });
    if (!issued.ok && issued.reason === "rate_limited")
      throw new PersonaSessionRateLimited(issued.retryAfterMs);
    if (!issued.ok)
      throw new Error(`PERSONA_SESSION_${issued.reason.toUpperCase()}`);
    if (!resolvedTenant) throw new Error("PERSONA_AUTH_REQUIRED");
    const cfg = options.issuance;
    const verified = verifyVersionedActiveTenantContext({
      token: issued.token,
      keyRing: cfg.keyRing,
      expected: {
        audience: cfg.audience,
        environmentId: cfg.environmentId,
        cellId: cfg.cellId,
        issuerId: cfg.issuerId,
        tenantId: resolvedTenant,
      },
      now: Date.now(),
    });
    if (!verified.ok || !isSelectionBoundActiveTenantContext(verified.context))
      throw new Error("PERSONA_AUTH_REQUIRED");
    const context = verified.context;
    const fingerprint = crypto
      .createHash("sha256")
      .update(cookies.sid, "ascii")
      .digest("hex");
    return {
      token: issued.token,
      tenantId: context.tenantId,
      principalId: context.principalId,
      sessionFingerprint: fingerprint,
      async sessionBoundary<T>(operation: () => Promise<T>): Promise<T> {
        assertSessionRuntime();
        // Keep the actual session/account/selection locked through EACH business
        // transaction, including provider invocation and result settlement.
        let result: T;
        let calls = 0;
        await sessionRepository.withLockedCurrentSession(
          {
            sessionId: cookies.sid,
            sessionFingerprint: fingerprint,
            observedAt: Date.now(),
          },
          async (value) => {
            if (++calls !== 1)
              throw new Error("PERSONA_SESSION_CONTRACT_INVALID");
            const s = value as Record<string, unknown> | null;
            if (
              !s ||
              s.status !== "ACTIVE" ||
              s.accountStatus !== "ACTIVE" ||
              s.authenticatedPrincipalId !== context.principalId ||
              s.tenantId !== context.tenantId ||
              s.organizationId !== context.organizationId ||
              s.legacyBranchId !== context.legacyBranchId ||
              s.selectionId !== context.selectionId ||
              s.sessionGeneration !== context.sessionGeneration ||
              s.sessionFingerprint !== fingerprint ||
              s.impersonatorPrincipalId !== null ||
              s.originalSessionFingerprint !== null ||
              !Number.isSafeInteger(s.idleExpiresAt) ||
              !Number.isSafeInteger(s.absoluteExpiresAt) ||
              Number(s.idleExpiresAt) <= Date.now() ||
              Number(s.absoluteExpiresAt) <= Date.now()
            )
              throw new Error("PERSONA_SESSION_REVOKED");
            result = await operation();
            return "persona-session-boundary-complete";
          },
        );
        if (calls !== 1) throw new Error("PERSONA_SESSION_CONTRACT_INVALID");
        return result!;
      },
    };
  }

  // Local composition reuses a short-lived signed envelope, not grants or DB
  // authority. Issuing on every autosave used up the canonical issuance limit.
  // Security headers must match a request already accepted by that gateway.
  const cache = new Map<string, { identity: PersonaMockIdentity; expiresAt: number }>();
  const pending = new Map<string, Promise<PersonaMockIdentity>>();
  function verify(identity: PersonaMockIdentity) {
    const cfg = options.issuance;
    return verifyVersionedActiveTenantContext({
      token: identity.token, keyRing: cfg.keyRing,
      expected: {
        audience: cfg.audience, environmentId: cfg.environmentId,
        cellId: cfg.cellId, issuerId: cfg.issuerId, tenantId: identity.tenantId,
      },
      now: Date.now(),
    });
  }
  return async (req: Request): Promise<PersonaMockIdentity> => {
    assertSessionRuntime();
    const headers = Object.entries(req.headers).filter(([name]) =>
      ["cookie", "origin", "referer", "x-csrf-token", "authorization"].includes(name.toLowerCase()),
    ).sort(([a], [b]) => a.localeCompare(b));
    const cfg = options.issuance;
    const key = crypto.createHash("sha256").update(JSON.stringify([
      headers, options.trustedOrigins, cfg.audience, cfg.environmentId, cfg.cellId,
      cfg.issuerId, cfg.keyId, cfg.keyReference,
    ])).digest("hex");
    for (const [candidate, item] of cache)
      if (item.expiresAt <= Date.now()) cache.delete(candidate);
    const found = cache.get(key);
    if (found) {
      const verified = verify(found.identity);
      if (verified.ok && isSelectionBoundActiveTenantContext(verified.context)) {
        try {
          // Revoked/rotated sessions, changed selection/generation or accounts
          // must fail even within the envelope's short validity window.
          await found.identity.sessionBoundary!(async () => undefined);
          return found.identity;
        } catch (error) { cache.delete(key); throw error; }
      }
      cache.delete(key);
    }
    const existing = pending.get(key);
    if (existing) {
      const identity = await existing;
      await identity.sessionBoundary!(async () => undefined);
      return identity;
    }
    if (pending.size >= 32) throw new PersonaSessionRateLimited(1000);
    const issuance = issue(req);
    pending.set(key, issuance);
    try {
      const identity = await issuance;
      const verified = verify(identity);
      if (!verified.ok || !isSelectionBoundActiveTenantContext(verified.context))
        throw new Error("PERSONA_AUTH_REQUIRED");
      while (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(key, { identity, expiresAt: Math.min(verified.context.expiresAt, Date.now() + 60000) });
      return identity;
    } finally { pending.delete(key); }
  };
}
