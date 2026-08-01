import {
  evaluatePortalPreflight,
  type PortalPreflightResult,
} from "@workspace/portal-adapters";
import { buildApplicationPreflightSnapshot } from "@workspace/portal-runner";
import { runEducationExtraction } from "./educationAutoExtract.js";
import { autoFillMissingAddressCity } from "./portalAddressAutoExtract.js";
import {
  autoFillMissingProfileFromPassport,
  autoRepairInvalidProfileDatesFromPassport,
  verifyStudentIdentityAgainstPassport,
} from "./portalProfileAutoExtract.js";
import { logAudit } from "./auth.js";

export interface PreparedPortalPreflight extends PortalPreflightResult {
  applicationId: number;
  studentId: number;
  autoFilledFields: string[];
  enrichmentWarnings: string[];
}

const ACADEMIC_FIELDS = new Set([
  "schoolName",
  "gpa",
  "graduationYear",
]);

export async function prepareApplicationPortalPreflight(opts: {
  applicationId: number;
  adapterKey: string;
  actorUserId: number | null;
  ip?: string;
  autoEnrich?: boolean;
}): Promise<PreparedPortalPreflight> {
  let snapshot = await buildApplicationPreflightSnapshot(
    opts.applicationId,
    { adapterKey: opts.adapterKey },
  );
  let result = evaluatePortalPreflight({
    adapterKey: opts.adapterKey,
    profile: snapshot.profile,
    documentTypes: snapshot.documentTypes,
  });
  const autoFilledFields: string[] = [];
  const enrichmentWarnings: string[] = [];

  if (opts.autoEnrich !== false && result.supported && !result.ready) {
    const identity = await autoFillMissingProfileFromPassport({
      studentId: snapshot.studentId,
      actorUserId: opts.actorUserId,
      ip: opts.ip,
      requiredFields: result.missingFields,
    });
    autoFilledFields.push(...identity.fields);
    if (
      identity.status === "low_confidence" ||
      identity.status === "ai_unavailable"
    ) {
      enrichmentWarnings.push(`identity:${identity.status}`);
    }

    if (result.missingFields.includes("addressCity")) {
      const addressCity = await autoFillMissingAddressCity({
        studentId: snapshot.studentId,
        actorUserId: opts.actorUserId,
        ip: opts.ip,
        requiredFields: result.missingFields,
      });
      autoFilledFields.push(...addressCity.fields);
      if (
        addressCity.status === "low_confidence" ||
        addressCity.status === "unreadable" ||
        addressCity.status === "ai_unavailable"
      ) {
        enrichmentWarnings.push(`addressCity:${addressCity.status}`);
      }
    }

    if (result.missingFields.some((field) => ACADEMIC_FIELDS.has(field))) {
      const education = await runEducationExtraction({
        studentId: snapshot.studentId,
        actorUserId: opts.actorUserId,
        ip: opts.ip,
        skipIfFilled: false,
        mergeMissingOnly: true,
        auditAction: "portal_preflight_auto_fill_education",
      });
      if (education.status === "ok") {
        if (education.upserted > 0) {
          autoFilledFields.push("educationRecords");
        }
        enrichmentWarnings.push(...education.warnings);
      } else if (
        education.status === "ai_failed" ||
        education.status === "ai_unavailable"
      ) {
        enrichmentWarnings.push(`education:${education.status}`);
      }
    }

    if (autoFilledFields.length > 0) {
      snapshot = await buildApplicationPreflightSnapshot(
        opts.applicationId,
        { adapterKey: opts.adapterKey },
      );
      result = evaluatePortalPreflight({
        adapterKey: opts.adapterKey,
        profile: snapshot.profile,
        documentTypes: snapshot.documentTypes,
      });
    }
  }

  const invalidPassportDates = result.incompatibleFields
    .map((issue) => issue.field)
    .filter((field) =>
      field === "dateOfBirth" ||
      field === "passportIssueDate" ||
      field === "passportExpiryDate");
  // Keep the first rollout scoped to SIT: this repair relies on SIT's
  // independently verified passport-identity contract.
  if (result.adapterKey === "sit" && invalidPassportDates.length > 0) {
    const repair = await autoRepairInvalidProfileDatesFromPassport({
      studentId: snapshot.studentId,
      actorUserId: opts.actorUserId,
      ip: opts.ip,
      invalidFields: invalidPassportDates,
    });
    if (repair.status === "updated") {
      autoFilledFields.push(...repair.fields);
      snapshot = await buildApplicationPreflightSnapshot(
        opts.applicationId,
        { adapterKey: opts.adapterKey },
      );
      result = evaluatePortalPreflight({
        adapterKey: opts.adapterKey,
        profile: snapshot.profile,
        documentTypes: snapshot.documentTypes,
      });
    } else if (
      repair.status === "identity_mismatch" ||
      repair.status === "low_confidence" ||
      repair.status === "unreadable" ||
      repair.status === "ai_unavailable"
    ) {
      enrichmentWarnings.push(`passportDateRepair:${repair.status}`);
    }
  }

  // SIT creates/reuses a portal-level student identity before creating the
  // application. Syntax-valid CRM text is not enough: require independent,
  // high-confidence proof from the student's latest passport document on
  // every preflight, including profiles whose fields are already populated.
  if (result.adapterKey === "sit") {
    const identityProof = await verifyStudentIdentityAgainstPassport({
      studentId: snapshot.studentId,
      actorUserId: opts.actorUserId,
      ip: opts.ip,
    });
    if (identityProof.status !== "verified") {
      enrichmentWarnings.push(`passportIdentity:${identityProof.status}`);
      const fields = identityProof.fields.length > 0
        ? identityProof.fields
        : ["passportIdentityProof"];
      const incompatibleFields = [...result.incompatibleFields];
      const existing = new Set(incompatibleFields.map((issue) => issue.field));
      for (const field of fields) {
        if (!existing.has(field)) {
          incompatibleFields.push({ field, reason: "invalid" });
          existing.add(field);
        }
      }
      result = { ...result, ready: false, incompatibleFields };
    }
  }

  const prepared: PreparedPortalPreflight = {
    ...result,
    applicationId: opts.applicationId,
    studentId: snapshot.studentId,
    autoFilledFields: [...new Set(autoFilledFields)],
    enrichmentWarnings: [...new Set(enrichmentWarnings)],
  };

  await logAudit(
    opts.actorUserId,
    "portal_application_preflight",
    "application",
    opts.applicationId,
    {
      adapterKey: opts.adapterKey,
      ready: prepared.ready,
      supported: prepared.supported,
      missingFields: prepared.missingFields,
      incompatibleFields: prepared.incompatibleFields,
      missingDocuments: prepared.missingDocuments,
      autoFilledFields: prepared.autoFilledFields,
      enrichmentWarnings: prepared.enrichmentWarnings,
    },
    opts.ip,
  );
  return prepared;
}
