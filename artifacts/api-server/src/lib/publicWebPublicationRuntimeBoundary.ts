import crypto from "node:crypto";

import {
  evaluateActiveTenantCapability,
  verifyVersionedActiveTenantContext,
  type ActiveContextVerificationKey,
  type ResolvedActiveContextState,
} from "./activeTenantContext.js";
import { ABSOLUTE_SESSION_TTL } from "./sessionLifetime.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const SESSION_ID_RE = /^[0-9a-f]{64}$/i;
const CSRF_TOKEN_RE = /^[0-9a-f]{64}$/i;
const MAX_COOKIE_HEADER_BYTES = 8_192;

export const PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY =
  "public_web.content.write";
export const PUBLIC_WEB_PUBLICATION_CACHE_CONTROL = "private, no-store";

const SERVER_AUTH_FIELDS = [
  "activeContextToken",
  "apiTokenAuth",
  "authorizationHeader",
  "csrfCookie",
  "csrfHeader",
  "impersonating",
  "origin",
  "rawCookieHeader",
  "requestUserLegacyId",
  "sessionCookie",
] as const;

const FORBIDDEN_BODY_AUTHORITY_FIELDS = new Set([
  "activeContextExpiresAt",
  "activeContextId",
  "adapterApprovalSha256",
  "actor",
  "actorLegacyUserId",
  "authenticatedUserId",
  "legacyBranchId",
  "membershipId",
  "organizationId",
  "principalId",
  "requestUserLegacyId",
  "runtimeReleaseId",
  "scope",
  "selectionId",
  "sessionFingerprint",
  "sessionGeneration",
  "tenantId",
]);

export type PublicWebPublicationVersionedContextConfig = {
  audience: string;
  environmentId: string;
  cellId: string;
  issuerId: string;
  keyRing: readonly ActiveContextVerificationKey[];
};

export type PublicWebPublicationCurrentSession = {
  selectionId: string;
  sessionFingerprint: string;
  sessionGeneration: number;
  status: "ACTIVE" | "REVOKED" | "ROTATED";
  accountStatus: "ACTIVE" | "INACTIVE" | "DELETED" | "UNVERIFIED";
  authenticatedPrincipalId: string;
  tenantId: string;
  organizationId: string | null;
  legacyBranchId: number | null;
  issuedAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  impersonatorPrincipalId: string | null;
  originalSessionFingerprint: string | null;
};

export type PublicWebPublicationCurrentSelection = {
  id: string;
  tenantId: string;
  organizationId: string | null;
  legacyBranchId: number | null;
  principalId: string;
  membershipId: string;
  legacyUserId: number;
  sessionGeneration: number;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "REPLACED";
  impersonatorPrincipalId: string | null;
};

export type PublicWebPublicationCurrentAuthority = {
  principalLegacyUserId: number;
  session: PublicWebPublicationCurrentSession;
  selection: PublicWebPublicationCurrentSelection;
  state: ResolvedActiveContextState;
};

export type PublicWebPublicationAuthorityResolver = (input: {
  sessionId: string;
  sessionFingerprint: string;
  observedAt: number;
}) => Promise<unknown>;

export type PublicWebPublicationExecutionIdentity = {
  tenantId: string;
  organizationId: string;
  actorLegacyUserId: number;
  principalId: string;
  membershipId: string;
  selectionId: string;
  sessionGeneration: number;
  sessionFingerprint: string;
  activeContextId: string;
  activeContextExpiresAt: number;
  responsePolicy: {
    cacheControl: typeof PUBLIC_WEB_PUBLICATION_CACHE_CONTROL;
  };
};

export type PublicWebPublicationRuntimeBoundaryFailure =
  | "server_auth_invalid"
  | "authorization_header_forbidden"
  | "api_token_forbidden"
  | "origin_untrusted"
  | "session_invalid"
  | "csrf_invalid"
  | "request_body_authority_forbidden"
  | "session_unavailable"
  | "impersonation_forbidden"
  | "legacy_branch_scope_forbidden"
  | "identity_mismatch"
  | "active_context_rejected"
  | "authority_not_current"
  | "capability_denied";

export type PublicWebPublicationRuntimeBoundaryResult =
  | { ok: true; identity: PublicWebPublicationExecutionIdentity }
  | { ok: false; reason: PublicWebPublicationRuntimeBoundaryFailure };

export type PublicWebPublicationRuntimeBoundaryOptions = {
  serverAuth: unknown;
  requestBody: unknown;
  trustedOrigins: readonly string[];
  versionedActiveContext: PublicWebPublicationVersionedContextConfig;
  resolveCurrentAuthority: PublicWebPublicationAuthorityResolver;
  now?: () => number;
};

type ParsedServerAuth = {
  activeContextToken: string;
  requestUserLegacyId: number;
  sessionId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableUuidV7(value: unknown): value is string | null {
  return value === null || isUuidV7(value);
}

function isNullableBranchId(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null ||
    (typeof value === "string" && SHA256_RE.test(value));
}

function parseOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseTrustedOrigins(value: unknown): Set<string> | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return null;
  }
  const parsed = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const origin = parseOrigin(candidate);
    if (!origin) return null;
    parsed.add(origin);
  }
  return parsed.size === value.length ? parsed : null;
}

function timingSafeCsrfMatch(left: string, right: string): boolean {
  if (!CSRF_TOKEN_RE.test(left) || !CSRF_TOKEN_RE.test(right)) return false;
  const leftBytes = Buffer.from(left.toLowerCase(), "ascii");
  const rightBytes = Buffer.from(right.toLowerCase(), "ascii");
  return leftBytes.length === rightBytes.length &&
    crypto.timingSafeEqual(leftBytes, rightBytes);
}

function parseSecurityCookies(raw: unknown):
  | { ok: true; sessionId: string; csrfToken: string }
  | { ok: false; reason: "session_invalid" | "csrf_invalid" } {
  if (
    typeof raw !== "string" ||
    raw.length < 1 ||
    Buffer.byteLength(raw, "utf8") > MAX_COOKIE_HEADER_BYTES
  ) {
    return { ok: false, reason: "session_invalid" };
  }
  const sessionIds: string[] = [];
  const csrfTokens: string[] = [];
  for (const segment of raw.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 1) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name === "sid") sessionIds.push(value);
    if (name === "csrf_token") csrfTokens.push(value);
  }
  if (sessionIds.length !== 1 || !SESSION_ID_RE.test(sessionIds[0] ?? "")) {
    return { ok: false, reason: "session_invalid" };
  }
  if (csrfTokens.length !== 1 || !CSRF_TOKEN_RE.test(csrfTokens[0] ?? "")) {
    return { ok: false, reason: "csrf_invalid" };
  }
  return {
    ok: true,
    sessionId: sessionIds[0].toLowerCase(),
    csrfToken: csrfTokens[0].toLowerCase(),
  };
}

function parseServerAuth(
  raw: unknown,
  trustedOrigins: Set<string>,
):
  | { ok: true; value: ParsedServerAuth }
  | { ok: false; reason: PublicWebPublicationRuntimeBoundaryFailure } {
  if (!isRecord(raw) || !hasExactKeys(raw, SERVER_AUTH_FIELDS)) {
    return { ok: false, reason: "server_auth_invalid" };
  }
  if (raw.authorizationHeader !== null) {
    return { ok: false, reason: "authorization_header_forbidden" };
  }
  if (raw.apiTokenAuth === true) {
    return { ok: false, reason: "api_token_forbidden" };
  }
  if (raw.apiTokenAuth !== false || typeof raw.impersonating !== "boolean") {
    return { ok: false, reason: "server_auth_invalid" };
  }
  if (raw.impersonating) {
    return { ok: false, reason: "impersonation_forbidden" };
  }
  if (!isPositiveInteger(raw.requestUserLegacyId)) {
    return { ok: false, reason: "server_auth_invalid" };
  }
  if (
    typeof raw.activeContextToken !== "string" ||
    raw.activeContextToken.length < 1 ||
    raw.activeContextToken.length > 16_384
  ) {
    return { ok: false, reason: "active_context_rejected" };
  }
  if (typeof raw.origin !== "string") {
    return { ok: false, reason: "origin_untrusted" };
  }
  const requestOrigin = parseOrigin(raw.origin);
  if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
    return { ok: false, reason: "origin_untrusted" };
  }

  const cookies = parseSecurityCookies(raw.rawCookieHeader);
  if (!cookies.ok) return cookies;
  if (
    typeof raw.sessionCookie !== "string" ||
    !SESSION_ID_RE.test(raw.sessionCookie) ||
    cookies.sessionId !== raw.sessionCookie.toLowerCase()
  ) {
    return { ok: false, reason: "session_invalid" };
  }
  if (
    typeof raw.csrfCookie !== "string" ||
    typeof raw.csrfHeader !== "string" ||
    cookies.csrfToken !== raw.csrfCookie.toLowerCase() ||
    !timingSafeCsrfMatch(raw.csrfCookie, raw.csrfHeader)
  ) {
    return { ok: false, reason: "csrf_invalid" };
  }
  return {
    ok: true,
    value: {
      activeContextToken: raw.activeContextToken,
      requestUserLegacyId: raw.requestUserLegacyId,
      sessionId: cookies.sessionId,
    },
  };
}

function requestBodyContainsAuthority(value: unknown): boolean {
  if (!isRecord(value)) return true;
  return Object.keys(value).some((key) =>
    FORBIDDEN_BODY_AUTHORITY_FIELDS.has(key));
}

function validVersionedConfig(
  value: unknown,
): value is PublicWebPublicationVersionedContextConfig {
  return isRecord(value) &&
    hasExactKeys(value, [
      "audience",
      "cellId",
      "environmentId",
      "issuerId",
      "keyRing",
    ]) &&
    typeof value.audience === "string" &&
    typeof value.environmentId === "string" &&
    typeof value.cellId === "string" &&
    typeof value.issuerId === "string" &&
    Array.isArray(value.keyRing);
}

function parseSession(value: unknown): PublicWebPublicationCurrentSession | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "absoluteExpiresAt",
      "accountStatus",
      "authenticatedPrincipalId",
      "idleExpiresAt",
      "impersonatorPrincipalId",
      "issuedAt",
      "legacyBranchId",
      "organizationId",
      "originalSessionFingerprint",
      "selectionId",
      "sessionFingerprint",
      "sessionGeneration",
      "status",
      "tenantId",
    ]) ||
    !isUuidV7(value.selectionId) ||
    typeof value.sessionFingerprint !== "string" ||
    !SHA256_RE.test(value.sessionFingerprint) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !["ACTIVE", "REVOKED", "ROTATED"].includes(String(value.status)) ||
    !["ACTIVE", "INACTIVE", "DELETED", "UNVERIFIED"].includes(
      String(value.accountStatus),
    ) ||
    !isUuidV7(value.authenticatedPrincipalId) ||
    !isUuidV7(value.tenantId) ||
    !isNullableUuidV7(value.organizationId) ||
    !isNullableBranchId(value.legacyBranchId) ||
    !isTimestamp(value.issuedAt) ||
    !isTimestamp(value.idleExpiresAt) ||
    !isTimestamp(value.absoluteExpiresAt) ||
    !isNullableUuidV7(value.impersonatorPrincipalId) ||
    !isNullableSha256(value.originalSessionFingerprint)
  ) {
    return null;
  }
  return {
    selectionId: value.selectionId.toLowerCase(),
    sessionFingerprint: value.sessionFingerprint.toLowerCase(),
    sessionGeneration: value.sessionGeneration,
    status: value.status as PublicWebPublicationCurrentSession["status"],
    accountStatus:
      value.accountStatus as PublicWebPublicationCurrentSession["accountStatus"],
    authenticatedPrincipalId: value.authenticatedPrincipalId.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId?.toLowerCase() ?? null,
    legacyBranchId: value.legacyBranchId,
    issuedAt: value.issuedAt,
    idleExpiresAt: value.idleExpiresAt,
    absoluteExpiresAt: value.absoluteExpiresAt,
    impersonatorPrincipalId:
      value.impersonatorPrincipalId?.toLowerCase() ?? null,
    originalSessionFingerprint:
      value.originalSessionFingerprint?.toLowerCase() ?? null,
  };
}

function parseSelection(
  value: unknown,
): PublicWebPublicationCurrentSelection | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "impersonatorPrincipalId",
      "legacyBranchId",
      "legacyUserId",
      "membershipId",
      "organizationId",
      "principalId",
      "sessionGeneration",
      "status",
      "tenantId",
    ]) ||
    !isUuidV7(value.id) ||
    !isUuidV7(value.tenantId) ||
    !isNullableUuidV7(value.organizationId) ||
    !isNullableBranchId(value.legacyBranchId) ||
    !isUuidV7(value.principalId) ||
    !isUuidV7(value.membershipId) ||
    !isPositiveInteger(value.legacyUserId) ||
    !isPositiveInteger(value.sessionGeneration) ||
    !["ACTIVE", "REVOKED", "EXPIRED", "REPLACED"].includes(
      String(value.status),
    ) ||
    !isNullableUuidV7(value.impersonatorPrincipalId)
  ) {
    return null;
  }
  return {
    id: value.id.toLowerCase(),
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId?.toLowerCase() ?? null,
    legacyBranchId: value.legacyBranchId,
    principalId: value.principalId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    legacyUserId: value.legacyUserId,
    sessionGeneration: value.sessionGeneration,
    status: value.status as PublicWebPublicationCurrentSelection["status"],
    impersonatorPrincipalId:
      value.impersonatorPrincipalId?.toLowerCase() ?? null,
  };
}

function parseAuthority(
  value: unknown,
): PublicWebPublicationCurrentAuthority | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "principalLegacyUserId",
      "selection",
      "session",
      "state",
    ]) ||
    !isPositiveInteger(value.principalLegacyUserId) ||
    !isRecord(value.state)
  ) {
    return null;
  }
  const session = parseSession(value.session);
  const selection = parseSelection(value.selection);
  if (!session || !selection) return null;
  return {
    principalLegacyUserId: value.principalLegacyUserId,
    session,
    selection,
    state: value.state as ResolvedActiveContextState,
  };
}

function validCurrentSession(
  session: PublicWebPublicationCurrentSession,
  expectedFingerprint: string,
  now: number,
): boolean {
  const expectedAbsoluteExpiry = session.issuedAt + ABSOLUTE_SESSION_TTL;
  return session.status === "ACTIVE" &&
    session.accountStatus === "ACTIVE" &&
    session.sessionFingerprint === expectedFingerprint &&
    Number.isSafeInteger(expectedAbsoluteExpiry) &&
    session.absoluteExpiresAt === expectedAbsoluteExpiry &&
    session.idleExpiresAt > session.issuedAt &&
    session.idleExpiresAt <= session.absoluteExpiresAt &&
    session.issuedAt <= now &&
    now < session.idleExpiresAt &&
    now < session.absoluteExpiresAt;
}

function sameScope(
  left: {
    tenantId: string;
    organizationId: string | null;
    legacyBranchId: number | null;
  },
  right: {
    tenantId: string;
    organizationId: string | null;
    legacyBranchId: number | null;
  },
): boolean {
  return left.tenantId === right.tenantId &&
    left.organizationId === right.organizationId &&
    left.legacyBranchId === right.legacyBranchId;
}

export async function resolvePublicWebPublicationExecutionIdentity(
  options: PublicWebPublicationRuntimeBoundaryOptions,
): Promise<PublicWebPublicationRuntimeBoundaryResult> {
  if (
    !options ||
    !validVersionedConfig(options.versionedActiveContext) ||
    typeof options.resolveCurrentAuthority !== "function" ||
    (options.now !== undefined && typeof options.now !== "function")
  ) {
    throw new Error("public_web_publication_runtime_configuration_invalid");
  }
  const trustedOrigins = parseTrustedOrigins(options.trustedOrigins);
  if (!trustedOrigins) {
    throw new Error("public_web_publication_runtime_configuration_invalid");
  }
  if (requestBodyContainsAuthority(options.requestBody)) {
    return { ok: false, reason: "request_body_authority_forbidden" };
  }
  const parsedAuth = parseServerAuth(options.serverAuth, trustedOrigins);
  if (!parsedAuth.ok) return parsedAuth;

  const now = options.now ?? Date.now;
  const startedAt = now();
  if (!isTimestamp(startedAt)) {
    return { ok: false, reason: "session_invalid" };
  }
  const sessionFingerprint = crypto
    .createHash("sha256")
    .update(parsedAuth.value.sessionId, "ascii")
    .digest("hex");

  let rawAuthority: unknown;
  try {
    rawAuthority = await options.resolveCurrentAuthority({
      sessionId: parsedAuth.value.sessionId,
      sessionFingerprint,
      observedAt: startedAt,
    });
  } catch {
    return { ok: false, reason: "session_unavailable" };
  }
  const completedAt = now();
  if (!isTimestamp(completedAt) || completedAt < startedAt) {
    return { ok: false, reason: "session_invalid" };
  }
  const authority = parseAuthority(rawAuthority);
  if (
    !authority ||
    !validCurrentSession(authority.session, sessionFingerprint, completedAt)
  ) {
    return { ok: false, reason: "session_invalid" };
  }
  const { session, selection } = authority;
  if (
    session.impersonatorPrincipalId !== null ||
    session.originalSessionFingerprint !== null ||
    selection.impersonatorPrincipalId !== null
  ) {
    return { ok: false, reason: "impersonation_forbidden" };
  }
  if (session.legacyBranchId !== null || selection.legacyBranchId !== null) {
    return { ok: false, reason: "legacy_branch_scope_forbidden" };
  }
  if (
    authority.principalLegacyUserId !== parsedAuth.value.requestUserLegacyId ||
    selection.legacyUserId !== parsedAuth.value.requestUserLegacyId
  ) {
    return { ok: false, reason: "identity_mismatch" };
  }
  if (
    session.organizationId === null ||
    selection.status !== "ACTIVE" ||
    selection.id !== session.selectionId ||
    selection.sessionGeneration !== session.sessionGeneration ||
    selection.principalId !== session.authenticatedPrincipalId ||
    !sameScope(selection, session)
  ) {
    return { ok: false, reason: "authority_not_current" };
  }

  const verification = verifyVersionedActiveTenantContext({
    token: parsedAuth.value.activeContextToken,
    keyRing: options.versionedActiveContext.keyRing,
    expected: {
      audience: options.versionedActiveContext.audience,
      environmentId: options.versionedActiveContext.environmentId,
      cellId: options.versionedActiveContext.cellId,
      issuerId: options.versionedActiveContext.issuerId,
      tenantId: session.tenantId,
    },
    expectedSelectionBinding: {
      selectionId: session.selectionId,
      sessionGeneration: session.sessionGeneration,
    },
    now: completedAt,
  });
  if (!verification.ok) {
    return { ok: false, reason: "active_context_rejected" };
  }
  const context = verification.context;
  if (
    context.principalId !== session.authenticatedPrincipalId ||
    context.membershipId !== selection.membershipId ||
    !sameScope(context, session)
  ) {
    return { ok: false, reason: "authority_not_current" };
  }

  const decision = evaluateActiveTenantCapability({
    context,
    state: authority.state,
    capabilityKey: PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY,
    resource: {
      type: "PUBLIC_WEB_CONTENT",
      id: session.organizationId,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      legacyBranchId: null,
    },
    stepUpSatisfied: false,
    approvalSatisfied: false,
    now: completedAt,
  });
  if (!decision.allowed) {
    return { ok: false, reason: "capability_denied" };
  }

  return {
    ok: true,
    identity: {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      actorLegacyUserId: parsedAuth.value.requestUserLegacyId,
      principalId: session.authenticatedPrincipalId,
      membershipId: selection.membershipId,
      selectionId: session.selectionId,
      sessionGeneration: session.sessionGeneration,
      sessionFingerprint: session.sessionFingerprint,
      activeContextId: context.contextId,
      activeContextExpiresAt: context.expiresAt,
      responsePolicy: {
        cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL,
      },
    },
  };
}
