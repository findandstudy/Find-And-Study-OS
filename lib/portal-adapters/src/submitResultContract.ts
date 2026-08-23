import type { SubmitResult } from "./types.js";

const TERMINAL_FLAGS = [
  "submitted",
  "alreadyExists",
  "programMissing",
  "programFull",
  "exclusiveRegion",
  "skippedNotMember",
] as const satisfies readonly (keyof SubmitResult)[];

export class InvalidSubmitResultError extends Error {
  readonly code = "ADAPTER_RESULT_INVALID";

  constructor(
    readonly adapterKey: string,
    readonly issues: readonly string[],
  ) {
    super(`${adapterKey}: invalid adapter result (${issues.join("; ")})`);
    this.name = "InvalidSubmitResultError";
  }
}

/**
 * Enforce the shared meaning of SubmitResult before the runner writes any
 * portal state back to CRM. This deliberately validates only structural
 * facts; portal-specific success proof remains the adapter's responsibility.
 */
export function assertSubmitResultContract(
  adapterKey: string,
  result: SubmitResult,
): void {
  const issues: string[] = [];
  const terminalFlags = TERMINAL_FLAGS.filter((flag) => result[flag] === true);

  if (terminalFlags.length > 1) {
    issues.push(`contradictory terminal outcomes: ${terminalFlags.join(",")}`);
  }

  if (result.externalRef !== undefined && result.externalRef.trim() === "") {
    issues.push("externalRef must be omitted instead of empty");
  }

  if (result.resolution === "not_in_dropdown") {
    if (!result.programMissing) {
      issues.push("not_in_dropdown requires programMissing=true");
    }
    if (!Array.isArray(result.availablePrograms)) {
      issues.push("not_in_dropdown requires availablePrograms");
    }
  }
  if (result.availablePrograms !== undefined && !result.programMissing) {
    issues.push("availablePrograms requires programMissing=true");
  }

  if (result.programFull) {
    if (!result.requestedProgram?.name?.trim()) {
      issues.push("programFull requires requestedProgram.name");
    }
    if (!Array.isArray(result.openPrograms)) {
      issues.push("programFull requires openPrograms");
    }
  }
  if (result.openPrograms !== undefined && !result.programFull) {
    issues.push("openPrograms requires programFull=true");
  }

  if (result.skippedNotMember && result.routeTo !== "direct") {
    issues.push("skippedNotMember requires routeTo=direct");
  }
  if (result.exclusiveAgency?.trim() && !result.exclusiveRegion) {
    issues.push("exclusiveAgency requires exclusiveRegion=true");
  }

  const missing = new Set((result.missingDocuments ?? []).map(normalizeSlot));
  const overlap = (result.uploadedSlots ?? [])
    .map(normalizeSlot)
    .filter((slot) => slot !== "" && missing.has(slot));
  if (overlap.length > 0) {
    issues.push(`document slots cannot be both missing and uploaded: ${[...new Set(overlap)].join(",")}`);
  }

  if (result.submitted && (result.missingDocuments?.length ?? 0) > 0) {
    issues.push("submitted result cannot contain missingDocuments");
  }

  if (issues.length > 0) {
    throw new InvalidSubmitResultError(adapterKey, issues);
  }
}

function normalizeSlot(value: string): string {
  return String(value).trim().toLowerCase();
}
