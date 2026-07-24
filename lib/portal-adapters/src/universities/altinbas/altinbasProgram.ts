import type { PortalProgramOption } from "../../types.js";
import { matchProgram } from "../../programMatch.js";

export interface AltinbasProgramSelection {
  record: Record<string, unknown> | null;
  option: PortalProgramOption | null;
  candidates: PortalProgramOption[];
  confidence: number | null;
}

const PROGRAM_NAME_KEYS = [
  "eduhub__Program_Name__c",
  "Name",
  "label",
  "MasterLabel",
] as const;

/**
 * Program Availability rows use an internal `Name` such as `PE-01904`.
 * The human-readable programme is carried by `eduhub__Program_Name__c`.
 */
export function altinbasProgramName(
  record: Record<string, unknown>,
  fallback = "",
): string {
  for (const key of PROGRAM_NAME_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

/**
 * Fail-closed in the safe direction: only an explicit true value is proof that
 * the programme is full. Missing/unknown values are not silently promoted to
 * quota-full because older Salesforce payloads may omit the field entirely.
 */
export function isAltinbasQuotaFull(
  record: Record<string, unknown>,
): boolean {
  const value = record["eduhub__Quota_Full__c"];
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return /^(true|1|yes)$/i.test(value.trim());
}

function isAvailabilityRecord(
  id: string,
  record: Record<string, unknown>,
): boolean {
  return (
    id.startsWith("a0A") ||
    typeof record["eduhub__Program__c"] === "string" ||
    Object.prototype.hasOwnProperty.call(record, "eduhub__Quota_Full__c")
  );
}

/**
 * Select the requested programme from the current Term+Degree availability
 * records. Availability rows take precedence over base Program (`a0B`) rows
 * because only the former carry the live quota flag.
 */
export function selectAltinbasProgram(
  records: ReadonlyArray<readonly [string, Record<string, unknown>]>,
  requestedName: string,
): AltinbasProgramSelection {
  const availability = records.filter(([id, record]) =>
    isAvailabilityRecord(id, record),
  );
  const basePrograms = records.filter(([id]) => id.startsWith("a0B"));
  const source = availability.length > 0 ? availability : basePrograms;

  const byId = new Map(source);
  const candidates: PortalProgramOption[] = source.map(([id, record]) => ({
    value: id,
    name: altinbasProgramName(record, id),
    enabled: !isAltinbasQuotaFull(record),
  }));

  const matched = matchProgram(
    requestedName,
    candidates.map((candidate) => ({
      id: candidate.value,
      name: candidate.name,
    })),
  );
  if (!matched) {
    return {
      record: null,
      option: null,
      candidates,
      confidence: null,
    };
  }

  const option =
    candidates.find((candidate) => candidate.value === matched.match.id) ??
    null;
  const record = byId.get(matched.match.id) ?? null;
  if (!option || !record) {
    return {
      record: null,
      option: null,
      candidates,
      confidence: null,
    };
  }

  return {
    record,
    option,
    candidates,
    confidence: matched.conf,
  };
}
