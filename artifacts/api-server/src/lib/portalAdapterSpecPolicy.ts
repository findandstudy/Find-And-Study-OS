import { createHash } from "node:crypto";
import {
  parseAdapterSpec,
  specHasJsHook,
  specIsPrivileged,
  type AdapterSpec,
} from "@workspace/portal-adapters";
import { canonicalJson } from "./jsonCanonical.js";

export const MAX_PORTAL_ADAPTER_SPEC_BYTES = 512 * 1024;

export type PortalAdapterSpecActivationBlocker =
  | "INVALID_SPEC"
  | "PRIVILEGED_APPROVAL_REQUIRED"
  | "JSHOOK_APPROVAL_REQUIRED";

export interface PortalAdapterSpecPolicySnapshot {
  canonicalSpec: Record<string, unknown>;
  sha256: string;
  byteLength: number;
  hasJsHook: boolean;
  privileged: boolean;
  activationBlockers: PortalAdapterSpecActivationBlocker[];
}

/**
 * Persist only the schema-parsed form. Zod removes unknown properties, which
 * prevents an AI-generated upload from smuggling unused secrets or metadata
 * into the database beside an otherwise-valid spec.
 */
export function canonicalizePortalAdapterSpec(
  parsedSpec: AdapterSpec,
): Record<string, unknown> {
  return JSON.parse(canonicalJson(parsedSpec)) as Record<string, unknown>;
}

export function portalAdapterSpecSha256(spec: unknown): string {
  return createHash("sha256").update(canonicalJson(spec), "utf8").digest("hex");
}

export function portalAdapterSpecByteLength(spec: unknown): number {
  return Buffer.byteLength(canonicalJson(spec), "utf8");
}

export function portalAdapterSpecActivationBlockers(input: {
  spec: unknown;
  privilegedApproved: boolean;
  jsHookApproved: boolean;
}): PortalAdapterSpecActivationBlocker[] {
  const parsed = parseAdapterSpec(input.spec);
  if (!parsed.ok) return ["INVALID_SPEC"];

  const blockers: PortalAdapterSpecActivationBlocker[] = [];
  if (specIsPrivileged(parsed.spec) && !input.privilegedApproved) {
    blockers.push("PRIVILEGED_APPROVAL_REQUIRED");
  }
  if (specHasJsHook(parsed.spec) && !input.jsHookApproved) {
    blockers.push("JSHOOK_APPROVAL_REQUIRED");
  }
  return blockers;
}

export function buildPortalAdapterSpecPolicySnapshot(
  parsedSpec: AdapterSpec,
  approvals: { privilegedApproved: boolean; jsHookApproved: boolean },
): PortalAdapterSpecPolicySnapshot {
  const canonicalSpec = canonicalizePortalAdapterSpec(parsedSpec);
  const byteLength = portalAdapterSpecByteLength(canonicalSpec);
  return {
    canonicalSpec,
    sha256: portalAdapterSpecSha256(canonicalSpec),
    byteLength,
    hasJsHook: specHasJsHook(canonicalSpec),
    privileged: specIsPrivileged(canonicalSpec),
    activationBlockers: portalAdapterSpecActivationBlockers({
      spec: canonicalSpec,
      ...approvals,
    }),
  };
}
