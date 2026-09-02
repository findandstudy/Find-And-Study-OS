import crypto from "node:crypto";
import type { Request } from "express";
import type { PoolClient } from "pg";

import {
  authorizeInstitutionMutation,
  type InstitutionMutationAuthorizationReceipt,
} from "./institutionAdmissionsAuthorization";
import type { InstitutionCapability } from "./institutionAdmissionsPolicy";
import {
  consumeInstitutionMutationAuthorization,
  resolveInstitutionCurrentAuthority,
  type InstitutionRequestContext,
} from "./institutionAdmissionsStore";
import { getSession, getSessionId } from "./replitAuth";

const MAX_KEY_RING_BYTES = 64 * 1024;

type MutationInput = {
  request: Request;
  client: PoolClient;
  context: InstitutionRequestContext;
  capabilityKey: InstitutionCapability;
  requiredDataScope: string;
  resourceType: string;
  resourceId: string;
  requestHash: string;
  approvalSatisfied: boolean;
};

function oneHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function versionedConfiguration() {
  const audience = process.env.INSTITUTION_ACTIVE_CONTEXT_AUDIENCE;
  const environmentId = process.env.INSTITUTION_ACTIVE_CONTEXT_ENVIRONMENT_ID;
  const cellId = process.env.INSTITUTION_ACTIVE_CONTEXT_CELL_ID;
  const issuerId = process.env.INSTITUTION_ACTIVE_CONTEXT_ISSUER_ID;
  const rawKeyRing = process.env.INSTITUTION_ACTIVE_CONTEXT_KEY_RING_JSON;
  if (
    !audience || !environmentId || !cellId || !issuerId || !rawKeyRing ||
    Buffer.byteLength(rawKeyRing, "utf8") > MAX_KEY_RING_BYTES
  ) throw new Error("institution_authoritative_assurance_required");
  let keyRing: unknown;
  try { keyRing = JSON.parse(rawKeyRing); }
  catch { throw new Error("institution_authoritative_assurance_required"); }
  if (!Array.isArray(keyRing) || keyRing.length < 1 || keyRing.length > 16) {
    throw new Error("institution_authoritative_assurance_required");
  }
  return { audience, environmentId, cellId, issuerId, keyRing };
}

async function serverSessionIdentity(request: Request) {
  const sid = getSessionId(request);
  if (!sid || !/^[0-9a-f]{64}$/i.test(sid)) {
    throw new Error("institution_interactive_session_required");
  }
  const session = await getSession(sid);
  if (!session || session.user.id !== request.user?.id) {
    throw new Error("institution_interactive_session_required");
  }
  return {
    sessionFingerprint: crypto.createHash("sha256").update(sid.toLowerCase(), "ascii").digest("hex"),
    impersonatorPrincipalId: session.originalSid === undefined ? null : "impersonation-present",
  };
}

export async function authorizeInstitutionRouteMutation(
  input: MutationInput,
): Promise<{ authorizationReceiptId: string; receipt: InstitutionMutationAuthorizationReceipt }> {
  if (!input.request.user) throw new Error("institution_interactive_session_required");
  const session = await serverSessionIdentity(input.request);
  if (session.impersonatorPrincipalId !== null) {
    throw new Error("institution_authorization_denied_impersonation_forbidden");
  }
  const config = versionedConfiguration();
  const result = await authorizeInstitutionMutation({
    activeContextToken: oneHeader(input.request, "x-fas-active-context"),
    stepUpReceiptId: oneHeader(input.request, "x-fas-step-up-receipt"),
    versionedActiveContext: config,
    requestIdentity: {
      authenticatedUserId: input.request.user.id,
      authenticatedPrincipalId: input.context.principalId,
      tenantId: input.context.tenantId,
      relationshipId: input.context.relationshipId,
      membershipId: input.context.membershipId,
      sessionFingerprint: session.sessionFingerprint,
      impersonatorPrincipalId: null,
    },
    resource: {
      tenantId: input.context.tenantId,
      relationshipId: input.context.relationshipId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestHash: input.requestHash,
    },
    capabilityKey: input.capabilityKey,
    requiredDataScope: input.requiredDataScope,
    approvalSatisfied: input.approvalSatisfied,
    resolveCurrentAuthority: (authorityInput) =>
      resolveInstitutionCurrentAuthority(input.client, input.context, authorityInput),
  });
  if (!result.ok) {
    const detail = "detail" in result.error ? `_${result.error.detail}` : "";
    throw new Error(`institution_authorization_denied_${result.error.reason}${detail}`);
  }
  const authorizationReceiptId = await consumeInstitutionMutationAuthorization(
    input.client,
    input.context,
    result.receipt,
  );
  return { authorizationReceiptId, receipt: result.receipt };
}
