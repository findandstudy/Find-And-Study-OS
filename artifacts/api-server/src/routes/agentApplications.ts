import { Router, raw as rawBody, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { z } from "zod";
import {
  agentApplicationsTable,
  agentBranchesTable,
  agentsTable,
  branchesTable,
  contractTemplatesTable,
  db,
  emailVerificationCodesTable,
  signedContractsTable,
  signingSessionsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";
import { createSigningToken, hashToken } from "../lib/signingTokens";
import { resolveContractTemplateBranding } from "../lib/contractTemplateBranding";
import { hasContractCompanySignature } from "../lib/contractBranding";
import { toE164 } from "../lib/inbox/phone";
import { isLiveIntegrationsEnabled } from "../lib/inbox/liveMode";
import { PgRateLimitStore } from "../lib/pgRateLimiter";
import { getRateLimitIp, getClientIp } from "../lib/clientIp";
import {
  agentApplicationReference,
  computeAgentApplicationContractHash,
  hashSensitiveEvidence,
  normalizeRegistrationKey,
  pickLatestRegistrationTemplates,
} from "../lib/agentApplicationPolicy";
import { reconcileAgentApplicationSignature } from "../lib/agentApplicationLifecycle";
import { setAgencyStaff } from "../lib/agencyStaff";
import { buildAgencyPortalInvitationEmail, getAppBaseUrl, sendEmail } from "../lib/email";
import { writeAudit } from "../lib/auditLog";
import { ObjectStorageService } from "../lib/objectStorage";
import { validateUploadedFileBuffer } from "../lib/fileUploadValidation";
import {
  agentApplicationUploadPrefix,
  issueAgentApplicationEmailProof,
  issueAgentApplicationUploadTicket,
  readAgentApplicationEmailProof,
  readAgentApplicationUploadTicket,
} from "../lib/agentApplicationTokens";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const PUBLIC_WINDOW_MS = 15 * 60 * 1000;
const AGENCY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const AGENCY_DOCUMENT_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const AGENCY_DOCUMENT_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);
const AGENCY_DOCUMENT_KINDS = ["logo", "representative_id", "business_registration"] as const;
const APPLICATION_ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const applicationTokenExpiry = (from = Date.now()) => new Date(from + APPLICATION_ACCESS_TOKEN_TTL_MS);
const publicLimiter = rateLimit({
  windowMs: PUBLIC_WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  store: new PgRateLimitStore(PUBLIC_WINDOW_MS, "agent-applications"),
  keyGenerator: getRateLimitIp,
  skip: () => process.env.NODE_ENV === "test",
});

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const websiteSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.union([
  z.string().trim().url().max(1000).refine((value) => /^https?:\/\//i.test(value), "Website must use HTTP or HTTPS"),
  z.literal(""),
]).optional().nullable());
const documentSchema = z.object({
  fileKey: z.string().trim().startsWith("/objects/").max(1000),
  name: text(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size: z.number().int().positive().max(AGENCY_DOCUMENT_MAX_BYTES),
});
const applicationBodySchema = z.object({
  firstName: text(100),
  lastName: text(100),
  email: z.string().trim().email().max(320),
  phone: optionalText(80),
  entityType: text(80),
  preferredLanguage: text(30),
  companyName: optionalText(240),
  businessName: optionalText(240),
  taxNumber: optionalText(120),
  country: optionalText(120),
  state: optionalText(120),
  city: optionalText(120),
  address: optionalText(1000),
  website: websiteSchema,
  estimatedStudents: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  operatingCountries: z.array(text(120)).max(100).optional().default([]),
  recruitmentMarkets: z.array(text(120)).max(100).optional().default([]),
  emailVerificationToken: text(4000),
  documents: z.object({
    logo: documentSchema.optional().nullable(),
    representativeId: documentSchema,
    businessRegistration: documentSchema.optional().nullable(),
  }),
  consentAccepted: z.literal(true),
}).superRefine((value, context) => {
  if (normalizeRegistrationKey(value.entityType) === "company" && !value.companyName?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["companyName"], message: "Legal company name is required for company applications" });
  }
  if (normalizeRegistrationKey(value.entityType) === "company" && !value.documents.businessRegistration) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["documents", "businessRegistration"], message: "Business registration certificate is required for company applications" });
  }
});

type ApplicationBody = z.infer<typeof applicationBodySchema>;
type Template = typeof contractTemplatesTable.$inferSelect;

const PASSWORD_SETUP_TTL_MS = 48 * 60 * 60 * 1000;
const CONTRACT_SIGNING_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function createPasswordSetupToken() {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + PASSWORD_SETUP_TTL_MS),
  };
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function contractFields(body: ApplicationBody, templateId: number) {
  return {
    templateId,
    entityType: normalizeRegistrationKey(body.entityType),
    preferredLanguage: normalizeRegistrationKey(body.preferredLanguage),
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    email: body.email.trim().toLowerCase(),
    phone: clean(body.phone),
    companyName: clean(body.companyName),
    businessName: clean(body.businessName),
    taxNumber: clean(body.taxNumber),
    country: clean(body.country),
    state: clean(body.state),
    city: clean(body.city),
    address: clean(body.address),
    website: clean(body.website),
  };
}

function intakeData(body: ApplicationBody) {
  const fullName = `${body.firstName.trim()} ${body.lastName.trim()}`.trim();
  const company = clean(body.companyName) || clean(body.businessName) || fullName;
  return {
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    fullName,
    contactName: fullName,
    email: body.email.trim().toLowerCase(),
    agencyEmail: body.email.trim().toLowerCase(),
    agency_email: body.email.trim().toLowerCase(),
    phone: clean(body.phone) || "",
    agencyPhone: clean(body.phone) || "",
    agency_phone: clean(body.phone) || "",
    entityType: normalizeRegistrationKey(body.entityType),
    language: normalizeRegistrationKey(body.preferredLanguage),
    companyName: company,
    businessName: company,
    agencyName: company,
    taxNumber: clean(body.taxNumber) || "",
    country: clean(body.country) || "",
    state: clean(body.state) || "",
    city: clean(body.city) || "",
    address: clean(body.address) || "",
    website: clean(body.website) || "",
    estimatedStudents: body.estimatedStudents ?? "",
    operatingCountries: body.operatingCountries.join(", "),
    recruitmentMarkets: body.recruitmentMarkets.join(", "),
  };
}

async function usableTemplates(): Promise<Template[]> {
  const rows = await db.select().from(contractTemplatesTable).where(and(
    eq(contractTemplatesTable.isActive, true),
    eq(contractTemplatesTable.publicationStatus, "published"),
    isNull(contractTemplatesTable.deletedAt),
  ));
  const latest = pickLatestRegistrationTemplates(rows);
  const resolved = await Promise.all(latest.map(async (template) => ({
    template,
    branding: await resolveContractTemplateBranding(template),
  })));
  return resolved
    .filter(({ branding }) => hasContractCompanySignature(branding))
    .map(({ template }) => template);
}

async function resolveTemplate(entityType: string, language: string): Promise<Template | null> {
  const e = normalizeRegistrationKey(entityType);
  const l = normalizeRegistrationKey(language);
  const rows = await usableTemplates();
  return rows.find((row) => normalizeRegistrationKey(row.entityType) === e
    && normalizeRegistrationKey(row.language) === l) || null;
}

async function createApplicationSession(params: {
  application: typeof agentApplicationsTable.$inferSelect;
  body: ApplicationBody;
  template: Template;
}, writer: Pick<typeof db, "insert" | "update"> = db) {
  const branding = await resolveContractTemplateBranding(params.template);
  if (!hasContractCompanySignature(branding)) throw new Error("CONTRACT_SIGNATURE_MISSING");
  const { rawToken, tokenHash } = createSigningToken();
  const expiresAt = params.application.contractDeadlineAt || new Date(Date.now() + CONTRACT_SIGNING_TTL_MS);
  const [session] = await writer.insert(signingSessionsTable).values({
    templateId: params.template.id,
    templateVersionSnapshot: params.template.version,
    templateNameSnapshot: params.template.name,
    templateLanguageSnapshot: params.template.language,
    templateEntityTypeSnapshot: params.template.entityType,
    templateBodyHtmlSnapshot: params.template.bodyHtml,
    templateIntakeSchemaSnapshot: params.template.intakeSchema,
    templateSigningPageConfigSnapshot: branding,
    agentId: params.application.provisionalAgentId,
    tokenHash,
    mode: "self_fill",
    status: "review_pending",
    intakeData: {
      ...intakeData(params.body),
      agentApplicationContractHash: params.application.contractDataHash,
    },
    signerEmail: params.application.email,
    expectedEmail: params.application.email,
    // The agency application already proved ownership of this address before
    // it could reach the signing stage. Carry that evidence into the signing
    // session so the applicant is not challenged for the same email twice.
    verifiedEmail: params.application.emailVerifiedAt ? params.application.email : null,
    emailVerificationMethod: params.application.emailVerifiedAt ? "verified_agent_application" : null,
    emailVerifiedAt: params.application.emailVerifiedAt,
    signerName: `${params.application.firstName} ${params.application.lastName}`.trim(),
    subjectType: "agent_application",
    subjectId: params.application.id,
    subjectLabel: params.application.referenceCode,
    expiresAt,
    createdByUserId: null,
    isPrimaryOnboarding: true,
  }).returning();
  await writer.update(agentApplicationsTable).set({
    signingSessionId: session.id,
    status: "awaiting_signature",
    portalAccessStatus: "contract_pending",
    contractDeadlineAt: expiresAt,
    accessRestrictedAt: null,
    accessRestrictionReason: null,
    updatedAt: new Date(),
  }).where(eq(agentApplicationsTable.id, params.application.id));
  return { session, rawToken, signPath: `/sign/${rawToken}` };
}

function applicationBodyFromRow(application: typeof agentApplicationsTable.$inferSelect): ApplicationBody {
  const metadata = application.documentMetadata && typeof application.documentMetadata === "object"
    ? application.documentMetadata as Record<string, any>
    : {};
  return {
    firstName: application.firstName,
    lastName: application.lastName,
    email: application.email,
    phone: application.phone,
    entityType: application.entityType,
    preferredLanguage: application.preferredLanguage,
    companyName: application.companyName,
    businessName: application.businessName,
    taxNumber: application.taxNumber,
    country: application.country,
    state: application.state,
    city: application.city,
    address: application.address,
    website: application.website,
    estimatedStudents: application.estimatedStudents,
    operatingCountries: Array.isArray(application.operatingCountries) ? application.operatingCountries as string[] : [],
    recruitmentMarkets: Array.isArray(application.recruitmentMarkets) ? application.recruitmentMarkets as string[] : [],
    emailVerificationToken: "stored-verification",
    documents: {
      logo: metadata.logo || undefined,
      representativeId: metadata.representativeId,
      businessRegistration: metadata.businessRegistration || undefined,
    },
    consentAccepted: true,
  };
}

function validateDocumentMetadata(name: string, contentType: string, size: number): string | null {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (!AGENCY_DOCUMENT_MIMES.has(contentType) || !AGENCY_DOCUMENT_EXTENSIONS.has(extension)) {
    return "Only PDF, JPG, JPEG and PNG documents are accepted";
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > AGENCY_DOCUMENT_MAX_BYTES) {
    return "Each document must be 10 MB or smaller";
  }
  if (contentType === "application/pdf" && extension !== "pdf") return "The file extension does not match its content type";
  if (contentType === "image/png" && extension !== "png") return "The file extension does not match its content type";
  if (contentType === "image/jpeg" && !["jpg", "jpeg"].includes(extension)) return "The file extension does not match its content type";
  return null;
}

async function verifyUploadedDocuments(body: ApplicationBody): Promise<void> {
  const prefix = `/objects/${agentApplicationUploadPrefix(body.email)}/`;
  const documents = [body.documents.logo, body.documents.representativeId, body.documents.businessRegistration].filter(Boolean) as Array<z.infer<typeof documentSchema>>;
  for (const document of documents) {
    if (!document.fileKey.startsWith(prefix)) throw new Error("DOCUMENT_OWNERSHIP_MISMATCH");
    const metadataError = validateDocumentMetadata(document.name, document.contentType, document.size);
    if (metadataError) throw new Error("DOCUMENT_INVALID");
    const file = await objectStorageService.getObjectEntityFile(document.fileKey);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size || 0);
    if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > AGENCY_DOCUMENT_MAX_BYTES || actualSize !== document.size) {
      throw new Error("DOCUMENT_INVALID");
    }
    const [buffer] = await file.download();
    const signatureError = await validateUploadedFileBuffer(document.name, document.contentType, buffer);
    if (signatureError) throw new Error("DOCUMENT_INVALID");
  }
}

function safeApplication(row: typeof agentApplicationsTable.$inferSelect) {
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    status: row.status,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    entityType: row.entityType,
    preferredLanguage: row.preferredLanguage,
    companyName: row.companyName,
    businessName: row.businessName,
    phone: row.phone,
    taxNumber: row.taxNumber,
    country: row.country,
    state: row.state,
    city: row.city,
    address: row.address,
    website: row.website,
    estimatedStudents: row.estimatedStudents,
    operatingCountries: row.operatingCountries,
    recruitmentMarkets: row.recruitmentMarkets,
    emailVerifiedAt: row.emailVerifiedAt,
    documents: row.documentMetadata && typeof row.documentMetadata === "object" ? row.documentMetadata : {},
    contractTemplateSelection: row.contractTemplateSelection,
    contractPreparedAt: row.contractPreparedAt,
    contractSentAt: row.contractSentAt,
    portalAccessStatus: row.portalAccessStatus,
    contractDeadlineAt: row.contractDeadlineAt,
    passwordSetupSentAt: row.passwordSetupSentAt,
    approvedCommissionRate: row.approvedCommissionRate,
    commercialActivatedAt: row.commercialActivatedAt,
    accessRestrictedAt: row.accessRestrictedAt,
    accessRestrictionReason: row.accessRestrictionReason,
    canStartSigning: row.status === "awaiting_signature" && Boolean(row.contractSentAt),
    changeRequestMessage: row.changeRequestMessage,
    signedAt: row.signedAt,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
  };
}

function applicationDocument(row: typeof agentApplicationsTable.$inferSelect, kind: string) {
  const metadata = row.documentMetadata && typeof row.documentMetadata === "object"
    ? row.documentMetadata as Record<string, any>
    : {};
  if (kind === "logo") return { key: row.logoFileKey, metadata: metadata.logo };
  if (kind === "representative-id") return { key: row.representativeIdFileKey, metadata: metadata.representativeId };
  if (kind === "business-registration") return { key: row.businessRegistrationFileKey, metadata: metadata.businessRegistration };
  return null;
}

function safeDownloadName(value: unknown): string {
  return String(value || "document").replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "document";
}

router.post("/public/agent-applications/email-verification/request", publicLimiter, async (req, res): Promise<void> => {
  const parsed = z.object({ email: z.string().trim().email().max(320), firstName: z.string().trim().max(100).optional() }).safeParse(req.body || {});
  if (!parsed.success) { res.status(400).json({ error: "A valid business email is required" }); return; }
  const email = parsed.data.email.toLowerCase();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  try {
    await db.update(emailVerificationCodesTable).set({ used: true }).where(and(
      eq(emailVerificationCodesTable.email, email),
      eq(emailVerificationCodesTable.used, false),
    ));
    await db.insert(emailVerificationCodesTable).values({
      email,
      code,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    let dispatched = false;
    if (isLiveIntegrationsEnabled()) {
      dispatched = await sendEmail(email, {
        subject: "Verify your Find And Study agency application",
        text: `Your verification code is ${code}. It expires in 15 minutes.`,
        html: `<p>Hello ${parsed.data.firstName || "there"},</p><p>Your agency application verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 15 minutes.</p>`,
      });
      if (!dispatched) {
        res.status(503).json({ error: "Verification email could not be delivered. Please try again shortly." });
        return;
      }
    }
    res.json({ data: {
      dispatched,
      expiresInSeconds: 900,
      ...(process.env.NODE_ENV !== "production" && !dispatched ? { developmentCode: code } : {}),
    } });
  } catch (error) {
    console.error("[agent-applications] request email verification", error);
    res.status(500).json({ error: "Verification code could not be sent" });
  }
});

router.post("/public/agent-applications/email-verification/confirm", publicLimiter, async (req, res): Promise<void> => {
  const parsed = z.object({ email: z.string().trim().email().max(320), code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body || {});
  if (!parsed.success) { res.status(400).json({ error: "A valid email and six-digit code are required" }); return; }
  const email = parsed.data.email.toLowerCase();
  const [record] = await db.select().from(emailVerificationCodesTable).where(and(
    eq(emailVerificationCodesTable.email, email),
    eq(emailVerificationCodesTable.code, parsed.data.code),
    eq(emailVerificationCodesTable.used, false),
    gt(emailVerificationCodesTable.expiresAt, new Date()),
  ));
  if (!record) { res.status(400).json({ error: "The verification code is invalid or expired" }); return; }
  await db.update(emailVerificationCodesTable).set({ used: true }).where(eq(emailVerificationCodesTable.id, record.id));
  res.json({ data: { email, verificationToken: issueAgentApplicationEmailProof(email), verifiedAt: new Date().toISOString() } });
});

router.post("/public/agent-applications/uploads/request-url", publicLimiter, async (req, res): Promise<void> => {
  const parsed = z.object({
    email: z.string().trim().email().max(320),
    emailVerificationToken: text(4000),
    documentKind: z.enum(AGENCY_DOCUMENT_KINDS),
    name: text(255),
    size: z.number().int().positive().max(AGENCY_DOCUMENT_MAX_BYTES),
    contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  }).safeParse(req.body || {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid document upload request" }); return; }
  const email = parsed.data.email.toLowerCase();
  const proof = readAgentApplicationEmailProof(parsed.data.emailVerificationToken);
  if (!proof || proof.email !== email) { res.status(403).json({ error: "Verify the business email before uploading documents" }); return; }
  const validationError = validateDocumentMetadata(parsed.data.name, parsed.data.contentType, parsed.data.size);
  if (validationError) { res.status(400).json({ error: validationError }); return; }
  try {
    const generatedUploadUrl = await objectStorageService.getObjectEntityUploadURL(`${agentApplicationUploadPrefix(email)}/${parsed.data.documentKind}`);
    const objectPath = objectStorageService.normalizeObjectEntityPath(generatedUploadUrl);
    const uploadTicket = issueAgentApplicationUploadTicket({ email, objectPath, documentKind: parsed.data.documentKind });
    const uploadURL = generatedUploadUrl.startsWith("/api/storage/local-upload/")
      ? generatedUploadUrl.replace("/api/storage/local-upload/", "/api/public/agent-applications/uploads/local/")
      : generatedUploadUrl;
    res.json({ data: { uploadURL, objectPath, uploadTicket } });
  } catch (error) {
    console.error("[agent-applications] request upload", error);
    res.status(500).json({ error: "Document upload could not be prepared" });
  }
});

router.put(
  "/public/agent-applications/uploads/local/:encoded",
  publicLimiter,
  rawBody({ type: ["application/pdf", "image/jpeg", "image/png", "application/octet-stream"], limit: AGENCY_DOCUMENT_MAX_BYTES }),
  async (req, res): Promise<void> => {
    if ((process.env.STORAGE_DRIVER ?? "replit") !== "local") { res.status(404).json({ error: "Not found" }); return; }
    const ticket = readAgentApplicationUploadTicket(String(req.headers["x-upload-ticket"] || ""));
    if (!ticket?.objectPath || !ticket.documentKind) { res.status(403).json({ error: "Upload authorization is invalid or expired" }); return; }
    const encoded = String(req.params.encoded || "");
    const localUploadPath = `/api/storage/local-upload/${encoded}`;
    const objectPath = objectStorageService.normalizeObjectEntityPath(localUploadPath);
    if (objectPath !== ticket.objectPath || !objectPath.startsWith(`/objects/${agentApplicationUploadPrefix(ticket.email)}/`)) {
      res.status(403).json({ error: "Upload authorization does not match this document" });
      return;
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
    const fileName = String(req.headers["x-file-name"] || "document");
    const validationError = validateDocumentMetadata(fileName, contentType, buffer.length);
    if (validationError) { res.status(400).json({ error: validationError }); return; }
    const signatureError = await validateUploadedFileBuffer(fileName, contentType, buffer);
    if (signatureError) { res.status(400).json({ error: signatureError.message }); return; }
    await objectStorageService.overwriteObjectBuffer(objectPath, buffer, contentType);
    res.status(204).end();
  },
);

router.get("/public/agent-applications/options", publicLimiter, async (_req, res): Promise<void> => {
  try {
    const templates = await usableTemplates();
    const matrix = templates.map((template) => ({
      templateId: template.id,
      entityType: template.entityType,
      language: template.language,
      title: template.title || template.name,
      version: template.version,
    }));
    const entityTypes = [...new Set(matrix.map((item) => item.entityType))];
    const languages = [...new Set(matrix.map((item) => item.language))];
    res.json({ data: { entityTypes, languages, matrix } });
  } catch (error) {
    console.error("[agent-applications] options", error);
    res.status(500).json({ error: "Contract options could not be loaded" });
  }
});

router.post("/public/agent-applications", publicLimiter, async (req, res): Promise<void> => {
  try {
    const parsed = applicationBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: "Application details are invalid", details: parsed.error.flatten() });
      return;
    }
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();
    const verification = readAgentApplicationEmailProof(body.emailVerificationToken);
    if (!verification || verification.email !== email) {
      res.status(403).json({ error: "Verify the business email before submitting the application" });
      return;
    }
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    const idempotencyKeyHash = idempotencyKey ? hashSensitiveEvidence(idempotencyKey, "idempotency") : null;
    if (idempotencyKeyHash) {
      const [existing] = await db.select().from(agentApplicationsTable)
        .where(eq(agentApplicationsTable.idempotencyKeyHash, idempotencyKeyHash));
      if (existing) {
        const submittedFields = contractFields(body, existing.contractTemplateId);
        if (computeAgentApplicationContractHash(submittedFields) !== existing.contractDataHash) {
          res.status(409).json({ error: "This idempotency key belongs to a different application payload" });
          return;
        }
        const rawAccessToken = crypto.randomBytes(32).toString("base64url");
        const accessTokenHash = hashToken(rawAccessToken);
        let repeatedApplication = existing;
        const [rotated] = await db.update(agentApplicationsTable).set({
          accessTokenHash,
          accessTokenExpiresAt: applicationTokenExpiry(),
          updatedAt: new Date(),
        })
          .where(eq(agentApplicationsTable.id, existing.id)).returning();
        repeatedApplication = rotated || existing;
        res.status(200).json({ data: {
          application: safeApplication(repeatedApplication),
          accessToken: rawAccessToken,
          signPath: null,
          repeated: true,
        } });
        return;
      }
    }
    await verifyUploadedDocuments(body);
    const template = await resolveTemplate(body.entityType, body.preferredLanguage);
    if (!template) {
      res.status(409).json({ error: "No published contract is available for the selected type and language" });
      return;
    }
    const activeStatuses = ["awaiting_signature", "signed", "submitted", "under_review", "changes_requested", "approved"];
    const [duplicate] = await db.select({ referenceCode: agentApplicationsTable.referenceCode })
      .from(agentApplicationsTable)
      .where(and(ilike(agentApplicationsTable.email, email), inArray(agentApplicationsTable.status, activeStatuses)));
    if (duplicate) {
      res.status(409).json({ error: "An active application already exists for this email", referenceCode: duplicate.referenceCode });
      return;
    }
    const rawAccessToken = crypto.randomBytes(32).toString("base64url");
    const accessTokenHash = hashToken(rawAccessToken);
    const passwordSetup = createPasswordSetupToken();
    const now = new Date();
    const fields = contractFields(body, template.id);
    const created = await db.transaction(async (tx) => {
      const [existingUser] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(ilike(usersTable.email, email));
      if (existingUser) throw Object.assign(new Error("EMAIL_EXISTS"), { status: 409 });

      const [application] = await tx.insert(agentApplicationsTable).values({
        referenceCode: agentApplicationReference(),
        accessTokenHash,
        accessTokenExpiresAt: applicationTokenExpiry(now.getTime()),
        idempotencyKeyHash,
        status: "submitted",
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email,
        phone: clean(body.phone),
        phoneE164: toE164(clean(body.phone)),
        entityType: fields.entityType,
        preferredLanguage: fields.preferredLanguage,
        companyName: clean(body.companyName),
        businessName: clean(body.businessName),
        taxNumber: clean(body.taxNumber),
        country: clean(body.country),
        state: clean(body.state),
        city: clean(body.city),
        address: clean(body.address),
        website: clean(body.website),
        estimatedStudents: body.estimatedStudents ?? null,
        operatingCountries: body.operatingCountries,
        recruitmentMarkets: body.recruitmentMarkets,
        emailVerifiedAt: now,
        logoFileKey: body.documents.logo?.fileKey || null,
        representativeIdFileKey: body.documents.representativeId.fileKey,
        businessRegistrationFileKey: body.documents.businessRegistration?.fileKey || null,
        documentMetadata: body.documents,
        contractTemplateId: template.id,
        contractTemplateSelection: "automatic",
        contractDataHash: computeAgentApplicationContractHash(fields),
        consentedAt: now,
        submittedAt: now,
        consentIpHash: hashSensitiveEvidence(getClientIp(req) || "unknown", "consent-ip"),
      }).returning();

      const [user] = await tx.insert(usersTable).values({
        email,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        role: "agent",
        phone: clean(body.phone),
        phoneE164: toE164(clean(body.phone)),
        language: fields.preferredLanguage,
        emailVerified: true,
        isActive: true,
        passwordResetToken: passwordSetup.tokenHash,
        passwordResetExpires: passwordSetup.expiresAt,
        createdFromSource: "agency_application",
      }).returning();

      const [agent] = await tx.insert(agentsTable).values({
        userId: user.id,
        agencyCode: null,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email,
        phone: clean(body.phone),
        phoneE164: toE164(clean(body.phone)),
        entityType: fields.entityType,
        preferredContractLanguage: fields.preferredLanguage,
        assignedContractTemplateId: template.id,
        companyName: clean(body.companyName),
        businessName: clean(body.businessName),
        taxNumber: clean(body.taxNumber),
        country: clean(body.country),
        state: clean(body.state),
        city: clean(body.city),
        address: clean(body.address),
        logoUrl: body.documents.logo?.fileKey || null,
        agentIdProofUrl: body.documents.representativeId.fileKey,
        businessCertUrl: body.documents.businessRegistration?.fileKey || null,
        status: "provisional",
        accessTier: "provisional",
        canManageStaff: false,
        embedToken: crypto.randomUUID(),
      }).returning();

      const [linkedApplication] = await tx.update(agentApplicationsTable).set({
        provisionalUserId: user.id,
        provisionalAgentId: agent.id,
        portalAccessStatus: "provisional",
        passwordSetupSentAt: now,
        updatedAt: now,
      }).where(eq(agentApplicationsTable.id, application.id)).returning();
      return { application: linkedApplication || application, user, agent };
    });
    const application = created.application;
    const language = fields.preferredLanguage || "en";
    // Fragment tokens never reach access logs, reverse proxies, referrers or
    // analytics. The SPA exchanges the fragment for the public API calls.
    const portalPath = `/${language}/agency/apply#application=${encodeURIComponent(rawAccessToken)}`;
    const passwordSetupPath = `/${language}/login?token=${encodeURIComponent(passwordSetup.rawToken)}`;
    let invitationDispatched = false;
    if (isLiveIntegrationsEnabled()) {
      try {
        const content = await buildAgencyPortalInvitationEmail({
          firstName: application.firstName,
          referenceCode: application.referenceCode,
          passwordSetupUrl: `${getAppBaseUrl()}${passwordSetupPath}`,
          trackingUrl: `${getAppBaseUrl()}${portalPath}`,
        });
        invitationDispatched = await sendEmail(email, content);
      } catch (error) {
        console.error("[agent-applications] portal invitation email", error);
      }
    }
    res.status(201).json({ data: {
      application: safeApplication(application),
      accessToken: rawAccessToken,
      signPath: null,
      invitationDispatched,
      ...(process.env.NODE_ENV !== "production" && !invitationDispatched ? { passwordSetupPath } : {}),
    } });
  } catch (error: any) {
    if (error?.message === "EMAIL_EXISTS") {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    if (error?.code === "23505") {
      res.status(409).json({ error: "This application was already received" });
      return;
    }
    if (["DOCUMENT_INVALID", "DOCUMENT_OWNERSHIP_MISMATCH"].includes(error?.message)) {
      res.status(400).json({ error: "One or more uploaded documents are invalid" });
      return;
    }
    console.error("[agent-applications] create", error);
    res.status(500).json({ error: "Application could not be created" });
  }
});

router.get("/public/agent-applications/:token", publicLimiter, async (req, res): Promise<void> => {
  const tokenHash = hashToken(String(req.params.token || ""));
  const [application] = await db.select().from(agentApplicationsTable)
    .where(and(
      eq(agentApplicationsTable.accessTokenHash, tokenHash),
      gt(agentApplicationsTable.accessTokenExpiresAt, new Date()),
    ));
  if (!application) { res.status(404).json({ error: "Application not found" }); return; }
  await reconcileAgentApplicationSignature(application.id);
  const [fresh] = await db.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, application.id));
  res.json({ data: { application: safeApplication(fresh || application) } });
});

router.post("/public/agent-applications/:token/sign", publicLimiter, async (req, res): Promise<void> => {
  try {
    const tokenHash = hashToken(String(req.params.token || ""));
    const [application] = await db.select().from(agentApplicationsTable)
      .where(and(
        eq(agentApplicationsTable.accessTokenHash, tokenHash),
        gt(agentApplicationsTable.accessTokenExpiresAt, new Date()),
      ));
    if (!application) { res.status(404).json({ error: "Application not found" }); return; }
    if (application.status !== "awaiting_signature" || !application.contractSentAt) {
      res.status(409).json({ error: "The contract is not ready for signing" });
      return;
    }
    if (!application.emailVerifiedAt) { res.status(409).json({ error: "The business email must be verified" }); return; }
    const [template] = await db.select().from(contractTemplatesTable)
      .where(eq(contractTemplatesTable.id, application.contractTemplateId));
    if (!template || !template.isActive || template.publicationStatus !== "published" || template.deletedAt) {
      res.status(409).json({ error: "The selected contract template is no longer available" });
      return;
    }
    const body = applicationBodyFromRow(application);
    if (!body.documents.representativeId || (application.entityType === "company" && !body.documents.businessRegistration)) {
      res.status(409).json({ error: "Required application documents are missing" });
      return;
    }
    const created = await db.transaction(async (tx) => {
      if (application.signingSessionId) {
        await tx.update(signingSessionsTable).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(signingSessionsTable.id, application.signingSessionId), ne(signingSessionsTable.status, "signed")));
      }
      return createApplicationSession(
        { application: { ...application, signingSessionId: null }, body, template },
        tx as unknown as Pick<typeof db, "insert" | "update">,
      );
    });
    res.json({ data: { signPath: created.signPath } });
  } catch (error: any) {
    if (error?.message === "CONTRACT_SIGNATURE_MISSING") {
      res.status(409).json({ error: "The selected contract template is missing the company signature" });
      return;
    }
    console.error("[agent-applications] start signing", error);
    res.status(500).json({ error: "The signing session could not be started" });
  }
});

router.patch("/public/agent-applications/:token", publicLimiter, async (req, res): Promise<void> => {
  try {
    const parsed = applicationBodySchema.safeParse(req.body || {});
    if (!parsed.success) { res.status(400).json({ error: "Application details are invalid", details: parsed.error.flatten() }); return; }
    const tokenHash = hashToken(String(req.params.token || ""));
    const [application] = await db.select().from(agentApplicationsTable)
      .where(and(
        eq(agentApplicationsTable.accessTokenHash, tokenHash),
        gt(agentApplicationsTable.accessTokenExpiresAt, new Date()),
      ));
    if (!application) { res.status(404).json({ error: "Application not found" }); return; }
    if (application.status !== "changes_requested") {
      res.status(409).json({ error: "Only an application returned for changes can be edited" });
      return;
    }
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();
    if (email !== application.email.trim().toLowerCase()) {
      const verification = readAgentApplicationEmailProof(body.emailVerificationToken);
      if (!verification || verification.email !== email) {
        res.status(403).json({ error: "Verify the new business email before submitting the revision" });
        return;
      }
    }
    await verifyUploadedDocuments(body);
    const [duplicate] = await db.select({ id: agentApplicationsTable.id }).from(agentApplicationsTable).where(and(
      ne(agentApplicationsTable.id, application.id),
      ilike(agentApplicationsTable.email, email),
      inArray(agentApplicationsTable.status, ["awaiting_signature", "signed", "submitted", "under_review", "changes_requested", "approved"]),
    ));
    if (duplicate) { res.status(409).json({ error: "An active application already exists for this email" }); return; }
    const template = await resolveTemplate(body.entityType, body.preferredLanguage);
    if (!template) { res.status(409).json({ error: "No published contract is available for the selected type and language" }); return; }
    const fields = contractFields(body, template.id);
    const passwordSetup = createPasswordSetupToken();
    const revisedAt = new Date();
    const revision = await db.transaction(async (tx) => {
      const [updated] = await tx.update(agentApplicationsTable).set({
        status: "submitted",
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email,
        phone: clean(body.phone),
        phoneE164: toE164(clean(body.phone)),
        entityType: fields.entityType,
        preferredLanguage: fields.preferredLanguage,
        companyName: clean(body.companyName),
        businessName: clean(body.businessName),
        taxNumber: clean(body.taxNumber),
        country: clean(body.country),
        state: clean(body.state),
        city: clean(body.city),
        address: clean(body.address),
        website: clean(body.website),
        estimatedStudents: body.estimatedStudents ?? null,
        operatingCountries: body.operatingCountries,
        recruitmentMarkets: body.recruitmentMarkets,
        emailVerifiedAt: email === application.email.trim().toLowerCase() ? application.emailVerifiedAt : revisedAt,
        logoFileKey: body.documents.logo?.fileKey || null,
        representativeIdFileKey: body.documents.representativeId.fileKey,
        businessRegistrationFileKey: body.documents.businessRegistration?.fileKey || null,
        documentMetadata: body.documents,
        contractTemplateId: template.id,
        contractTemplateSelection: "automatic",
        contractTemplateOverriddenByUserId: null,
        contractTemplateOverriddenAt: null,
        contractPreparedAt: null,
        contractSentAt: null,
        contractDataHash: computeAgentApplicationContractHash(fields),
        signingSessionId: null,
        signedContractId: null,
        signedAt: null,
        portalAccessStatus: "provisional",
        contractDeadlineAt: null,
        lastContractReminderAt: null,
        passwordSetupSentAt: revisedAt,
        accessRestrictedAt: null,
        accessRestrictionReason: null,
        submittedAt: revisedAt,
        changeRequestMessage: null,
        consentedAt: revisedAt,
        consentIpHash: hashSensitiveEvidence(getClientIp(req) || "unknown", "consent-ip"),
        accessTokenExpiresAt: applicationTokenExpiry(revisedAt.getTime()),
        updatedAt: revisedAt,
      }).where(and(eq(agentApplicationsTable.id, application.id), eq(agentApplicationsTable.status, "changes_requested"))).returning();
      if (!updated) return null;
      if (application.signingSessionId) {
        await tx.update(signingSessionsTable).set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(signingSessionsTable.id, application.signingSessionId), ne(signingSessionsTable.status, "signed")));
      }
      if (application.provisionalUserId) {
        await tx.update(usersTable).set({
          email,
          firstName: body.firstName.trim(),
          lastName: body.lastName.trim(),
          phone: clean(body.phone),
          phoneE164: toE164(clean(body.phone)),
          language: fields.preferredLanguage,
          emailVerified: true,
          isActive: true,
          passwordResetToken: passwordSetup.tokenHash,
          passwordResetExpires: passwordSetup.expiresAt,
          updatedAt: revisedAt,
        }).where(eq(usersTable.id, application.provisionalUserId));
      }
      if (application.provisionalAgentId) {
        await tx.update(agentsTable).set({
          firstName: body.firstName.trim(),
          lastName: body.lastName.trim(),
          email,
          phone: clean(body.phone),
          phoneE164: toE164(clean(body.phone)),
          entityType: fields.entityType,
          preferredContractLanguage: fields.preferredLanguage,
          assignedContractTemplateId: template.id,
          companyName: clean(body.companyName),
          businessName: clean(body.businessName),
          taxNumber: clean(body.taxNumber),
          country: clean(body.country),
          state: clean(body.state),
          city: clean(body.city),
          address: clean(body.address),
          logoUrl: body.documents.logo?.fileKey || null,
          agentIdProofUrl: body.documents.representativeId.fileKey,
          businessCertUrl: body.documents.businessRegistration?.fileKey || null,
          status: "provisional",
          accessTier: "provisional",
          canManageStaff: false,
          updatedAt: revisedAt,
        }).where(eq(agentsTable.id, application.provisionalAgentId));
      }
      return updated;
    });
    if (!revision) { res.status(409).json({ error: "Application state changed" }); return; }
    const passwordSetupPath = `/${fields.preferredLanguage || "en"}/login?token=${encodeURIComponent(passwordSetup.rawToken)}`;
    let invitationDispatched = false;
    if (application.provisionalUserId && isLiveIntegrationsEnabled()) {
      try {
        const content = await buildAgencyPortalInvitationEmail({
          firstName: revision.firstName,
          referenceCode: revision.referenceCode,
          passwordSetupUrl: `${getAppBaseUrl()}${passwordSetupPath}`,
          trackingUrl: `${getAppBaseUrl()}/${fields.preferredLanguage || "en"}/agency/apply#application=${encodeURIComponent(String(req.params.token))}`,
        });
        invitationDispatched = await sendEmail(email, content);
      } catch (error) {
        console.error("[agent-applications] revised portal invitation", error);
      }
    }
    res.json({ data: {
      application: safeApplication(revision),
      accessToken: String(req.params.token),
      signPath: null,
      invitationDispatched,
      ...(process.env.NODE_ENV !== "production" && !invitationDispatched ? { passwordSetupPath } : {}),
    } });
  } catch (error: any) {
    if (error?.code === "23505") { res.status(409).json({ error: "This email or signing session is already in use" }); return; }
    console.error("[agent-applications] resubmit", error);
    res.status(500).json({ error: "Application could not be updated" });
  }
});

router.get("/agent-applications/contract-options", requireAuth, requireRole(...MANAGER_ROLES), async (_req, res): Promise<void> => {
  try {
    const templates = await usableTemplates();
    res.json({ data: templates.map((template) => ({
      id: template.id,
      name: template.name,
      title: template.title,
      language: template.language,
      entityType: template.entityType,
      version: template.version,
      signingPageConfig: template.signingPageConfig,
    })) });
  } catch (error) {
    console.error("[agent-applications] staff contract options", error);
    res.status(500).json({ error: "Contract options could not be loaded" });
  }
});

router.get("/agent-applications", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const status = String(req.query.status || "all");
  const search = String(req.query.search || "").trim().slice(0, 200);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const conditions = [] as any[];
  if (status !== "all") conditions.push(eq(agentApplicationsTable.status, status));
  if (search) conditions.push(or(
    ilike(agentApplicationsTable.referenceCode, `%${search}%`),
    ilike(agentApplicationsTable.email, `%${search}%`),
    ilike(agentApplicationsTable.firstName, `%${search}%`),
    ilike(agentApplicationsTable.lastName, `%${search}%`),
    ilike(agentApplicationsTable.companyName, `%${search}%`),
    ilike(agentApplicationsTable.businessName, `%${search}%`),
  ));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, countRows] = await Promise.all([
    db.select().from(agentApplicationsTable).where(where).orderBy(desc(agentApplicationsTable.createdAt)).limit(limit).offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)::int` }).from(agentApplicationsTable).where(where),
  ]);
  res.json({ data: rows, pagination: { page, limit, total: countRows[0]?.count || 0 } });
});

router.get("/agent-applications/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid application id" }); return; }
  await reconcileAgentApplicationSignature(id);
  const [row] = await db.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
  if (!row) { res.status(404).json({ error: "Application not found" }); return; }
  const [template] = await db.select({ id: contractTemplatesTable.id, name: contractTemplatesTable.name, title: contractTemplatesTable.title, version: contractTemplatesTable.version })
    .from(contractTemplatesTable).where(eq(contractTemplatesTable.id, row.contractTemplateId));
  res.json({ data: { ...row, template: template || null } });
});

router.get("/agent-applications/:id/documents/:kind", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid application id" }); return; }
  const [application] = await db.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
  if (!application) { res.status(404).json({ error: "Application not found" }); return; }
  const document = applicationDocument(application, String(req.params.kind || ""));
  if (!document?.key) { res.status(404).json({ error: "Document not found" }); return; }
  try {
    const file = await objectStorageService.getObjectEntityFile(document.key);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = String(document.metadata?.contentType || metadata.contentType || "application/octet-stream");
    const name = safeDownloadName(document.metadata?.name);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  } catch (error) {
    console.error("[agent-applications] document download", error);
    res.status(404).json({ error: "Document not found" });
  }
});

router.get("/agents/me/agency-application/documents/:kind", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "agent") { res.status(403).json({ error: "Forbidden" }); return; }
  const [agent] = await db.select({ id: agentsTable.id }).from(agentsTable)
    .where(eq(agentsTable.userId, req.user!.id));
  if (!agent) { res.status(404).json({ error: "Agency application not found" }); return; }
  const [application] = await db.select().from(agentApplicationsTable)
    .where(or(
      eq(agentApplicationsTable.provisionalAgentId, agent.id),
      eq(agentApplicationsTable.approvedAgentId, agent.id),
    ))
    .orderBy(desc(agentApplicationsTable.createdAt))
    .limit(1);
  if (!application) { res.status(404).json({ error: "Agency application not found" }); return; }
  const document = applicationDocument(application, String(req.params.kind || ""));
  if (!document?.key) { res.status(404).json({ error: "Document not found" }); return; }
  try {
    const file = await objectStorageService.getObjectEntityFile(document.key);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = String(document.metadata?.contentType || metadata.contentType || "application/octet-stream");
    const name = safeDownloadName(document.metadata?.name);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="${name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  } catch (error) {
    console.error("[agent-applications] applicant document download", error);
    res.status(404).json({ error: "Document not found" });
  }
});

router.patch("/agent-applications/:id/contract-template", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = z.object({ templateId: z.number().int().positive() }).safeParse(req.body || {});
  if (!Number.isInteger(id) || !parsed.success) { res.status(400).json({ error: "Invalid contract template update" }); return; }
  const [application] = await db.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
  if (!application) { res.status(404).json({ error: "Application not found" }); return; }
  if (!["submitted", "under_review", "changes_requested", "awaiting_signature"].includes(application.status)) {
    res.status(409).json({ error: "A signed or approved application cannot change its contract template" });
    return;
  }
  const template = (await usableTemplates()).find((item) => item.id === parsed.data.templateId);
  if (!template) { res.status(409).json({ error: "The selected contract template is not available" }); return; }
  if (normalizeRegistrationKey(template.entityType) !== application.entityType) {
    res.status(409).json({ error: "The contract type must match the applicant type" });
    return;
  }
  const body = applicationBodyFromRow(application);
  body.preferredLanguage = normalizeRegistrationKey(template.language);
  const contractDataHash = computeAgentApplicationContractHash(contractFields(body, template.id));
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    if (application.signingSessionId) {
      await tx.update(signingSessionsTable).set({ status: "cancelled", updatedAt: now })
        .where(and(eq(signingSessionsTable.id, application.signingSessionId), ne(signingSessionsTable.status, "signed")));
    }
    return tx.update(agentApplicationsTable).set({
      status: application.status === "changes_requested" ? "changes_requested" : "under_review",
      preferredLanguage: normalizeRegistrationKey(template.language),
      contractTemplateId: template.id,
      contractTemplateSelection: "manual",
      contractTemplateOverriddenByUserId: req.user!.id,
      contractTemplateOverriddenAt: now,
      contractPreparedAt: null,
      contractSentAt: null,
      signingSessionId: null,
      signedContractId: null,
      signedAt: null,
      contractDataHash,
      updatedAt: now,
    }).where(eq(agentApplicationsTable.id, id)).returning();
  });
  await writeAudit({ userId: req.user!.id, action: "agent_application.contract_template_changed", resource: "agent_application", resourceId: id, changes: { templateId: template.id }, ipAddress: req.ip });
  res.json({ data: updated });
});

router.patch("/agent-applications/:id/assignment", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = z.object({
    assignedStaffId: z.number().int().positive().nullable(),
    branchId: z.number().int().positive().nullable(),
  }).safeParse(req.body || {});
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: "Invalid assignment update" });
    return;
  }

  const [application] = await db.select({
    id: agentApplicationsTable.id,
    status: agentApplicationsTable.status,
    provisionalAgentId: agentApplicationsTable.provisionalAgentId,
  })
    .from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  if (application.status === "approved") {
    res.status(409).json({ error: "An approved application must be reassigned from the agent record" });
    return;
  }

  if (parsed.data.assignedStaffId !== null) {
    const [staffUser] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
      eq(usersTable.id, parsed.data.assignedStaffId),
      eq(usersTable.isActive, true),
      isNull(usersTable.deletedAt),
      inArray(usersTable.role, STAFF_ROLES),
    ));
    if (!staffUser) {
      res.status(409).json({ error: "The selected staff member is not available" });
      return;
    }
  }

  if (parsed.data.branchId !== null) {
    const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable).where(and(
      eq(branchesTable.id, parsed.data.branchId),
      isNull(branchesTable.archivedAt),
    ));
    if (!branch) {
      res.status(409).json({ error: "The selected branch is not available" });
      return;
    }
  }

  const [updated] = await db.update(agentApplicationsTable).set({
    assignedStaffId: parsed.data.assignedStaffId,
    branchId: parsed.data.branchId,
    updatedAt: new Date(),
  }).where(eq(agentApplicationsTable.id, id)).returning();
  if (application.provisionalAgentId) {
    await setAgencyStaff(
      application.provisionalAgentId,
      parsed.data.assignedStaffId ? [{ userId: parsed.data.assignedStaffId, isPrimary: true }] : [],
    );
  }
  await writeAudit({
    userId: req.user!.id,
    action: "agent_application.assignment_changed",
    resource: "agent_application",
    resourceId: id,
    changes: parsed.data,
    ipAddress: req.ip,
  });
  res.json({ data: updated });
});

router.post("/agent-applications/:id/send-contract", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid application id" }); return; }
  const [application] = await db.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
  if (!application) { res.status(404).json({ error: "Application not found" }); return; }
  if (!["submitted", "under_review", "awaiting_signature"].includes(application.status)) {
    res.status(409).json({ error: "This application is not ready for a contract" });
    return;
  }
  if (!application.emailVerifiedAt || !application.representativeIdFileKey || (application.entityType === "company" && !application.businessRegistrationFileKey)) {
    res.status(409).json({ error: "Verified email and all required documents are required before sending the contract" });
    return;
  }
  const [template] = await db.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, application.contractTemplateId));
  if (!template || !template.isActive || template.publicationStatus !== "published" || template.deletedAt) {
    res.status(409).json({ error: "The selected contract template is not available" });
    return;
  }
  const branding = await resolveContractTemplateBranding(template);
  if (!hasContractCompanySignature(branding)) {
    res.status(409).json({ error: "The selected contract template is missing the company signature" });
    return;
  }
  const rawAccessToken = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const contractDeadlineAt = new Date(now.getTime() + CONTRACT_SIGNING_TTL_MS);
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(agentApplicationsTable).set({
      status: "awaiting_signature",
      accessTokenHash: hashToken(rawAccessToken),
      accessTokenExpiresAt: applicationTokenExpiry(now.getTime()),
      portalAccessStatus: "contract_pending",
      contractPreparedAt: now,
      contractSentAt: now,
      contractDeadlineAt,
      lastContractReminderAt: null,
      accessRestrictedAt: null,
      accessRestrictionReason: null,
      changeRequestMessage: null,
      reviewedAt: now,
      reviewedByUserId: req.user!.id,
      updatedAt: now,
    }).where(eq(agentApplicationsTable.id, id)).returning();
    if (application.provisionalAgentId) {
      await tx.update(agentsTable).set({
        status: "provisional",
        accessTier: "provisional",
        assignedContractTemplateId: application.contractTemplateId,
        updatedAt: now,
      }).where(eq(agentsTable.id, application.provisionalAgentId));
    }
    return rows;
  });
  const portalPath = `/${application.preferredLanguage || "en"}/agency/apply#application=${encodeURIComponent(rawAccessToken)}`;
  let dispatched = false;
  if (isLiveIntegrationsEnabled()) {
    dispatched = await sendEmail(application.email, {
      subject: `Your agency contract is ready · ${application.referenceCode}`,
      text: `Your application was reviewed. Open ${getAppBaseUrl()}${portalPath} to review and sign the contract.`,
      html: `<p>Your agency application <strong>${application.referenceCode}</strong> was reviewed.</p><p><a href="${getAppBaseUrl()}${portalPath}">Review and sign your contract</a></p>`,
    });
  }
  await writeAudit({ userId: req.user!.id, action: "agent_application.contract_sent", resource: "agent_application", resourceId: id, changes: { templateId: application.contractTemplateId, contractDeadlineAt, dispatched }, ipAddress: req.ip });
  res.json({ data: { application: updated, dispatched, portalPath } });
});

router.patch("/agent-applications/:id/review", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const schema = z.object({
    status: z.enum(["under_review", "changes_requested", "rejected"]),
    reviewNotes: z.string().trim().max(4000).optional().nullable(),
    changeRequestMessage: z.string().trim().max(4000).optional().nullable(),
    assignedStaffId: z.number().int().positive().optional().nullable(),
    branchId: z.number().int().positive().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body || {});
  if (!Number.isInteger(id) || !parsed.success) { res.status(400).json({ error: "Invalid review update" }); return; }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${id} FOR UPDATE`);
    const [current] = await tx.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
    if (!current || !["submitted", "under_review", "changes_requested"].includes(current.status)) return [];
    const rejected = parsed.data.status === "rejected";
    const rows = await tx.update(agentApplicationsTable).set({
      status: parsed.data.status,
      portalAccessStatus: rejected ? "restricted" : "provisional",
      reviewNotes: clean(parsed.data.reviewNotes),
      changeRequestMessage: parsed.data.status === "changes_requested" ? clean(parsed.data.changeRequestMessage) : null,
      assignedStaffId: parsed.data.assignedStaffId === undefined ? undefined : parsed.data.assignedStaffId,
      branchId: parsed.data.branchId === undefined ? undefined : parsed.data.branchId,
      reviewedByUserId: req.user!.id,
      reviewedAt: now,
      rejectedAt: rejected ? now : null,
      contractDeadlineAt: parsed.data.status === "under_review" ? undefined : null,
      lastContractReminderAt: parsed.data.status === "under_review" ? undefined : null,
      accessRestrictedAt: rejected ? now : null,
      accessRestrictionReason: rejected ? "application_rejected" : null,
      updatedAt: now,
    }).where(eq(agentApplicationsTable.id, id)).returning();
    if (current.signingSessionId && ["changes_requested", "rejected"].includes(parsed.data.status)) {
      await tx.update(signingSessionsTable).set({ status: "cancelled", updatedAt: now })
        .where(and(eq(signingSessionsTable.id, current.signingSessionId), ne(signingSessionsTable.status, "signed")));
    }
    if (current.provisionalAgentId) {
      await tx.update(agentsTable).set({
        status: rejected ? "rejected" : "provisional",
        accessTier: rejected ? "restricted" : "provisional",
        assignedStaffId: parsed.data.assignedStaffId === undefined ? current.assignedStaffId : parsed.data.assignedStaffId,
        canManageStaff: false,
        updatedAt: now,
      }).where(eq(agentsTable.id, current.provisionalAgentId));
    }
    return rows;
  });
  if (!updated) { res.status(409).json({ error: "Application state changed or cannot be reviewed" }); return; }
  if (updated.provisionalAgentId && parsed.data.assignedStaffId !== undefined) {
    await setAgencyStaff(
      updated.provisionalAgentId,
      parsed.data.assignedStaffId ? [{ userId: parsed.data.assignedStaffId, isPrimary: true }] : [],
    );
  }
  await writeAudit({ userId: req.user!.id, action: `agent_application.${parsed.data.status}`, resource: "agent_application", resourceId: id, changes: parsed.data, ipAddress: req.ip });
  res.json({ data: updated });
});

router.post("/agent-applications/:id/approve", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = z.object({
    reviewNotes: z.string().trim().max(4000).optional().nullable(),
    commissionRate: z.coerce.number().min(0).max(100).optional(),
    assignedStaffId: z.coerce.number().int().positive().optional().nullable(),
    branchId: z.coerce.number().int().positive().optional().nullable(),
  }).safeParse(req.body || {});
  if (!Number.isInteger(id) || !parsed.success) { res.status(400).json({ error: "Invalid approval data" }); return; }
  await reconcileAgentApplicationSignature(id);
  const passwordSetup = createPasswordSetupToken();
  let result: {
    agent: typeof agentsTable.$inferSelect;
    application: typeof agentApplicationsTable.$inferSelect;
    alreadyApproved: boolean;
    passwordSetupRequired: boolean;
  } | null = null;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM agent_applications WHERE id = ${id} FOR UPDATE`);
      const [application] = await tx.select().from(agentApplicationsTable).where(eq(agentApplicationsTable.id, id));
      if (!application) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
      if (application.approvedAgentId) {
        const [agent] = await tx.select().from(agentsTable).where(eq(agentsTable.id, application.approvedAgentId));
        if (!agent) throw Object.assign(new Error("APPROVED_AGENT_MISSING"), { status: 409 });
        return { agent, application, alreadyApproved: true, passwordSetupRequired: false };
      }
      if (application.status !== "signed") throw Object.assign(new Error("NOT_READY"), { status: 409 });
      if (!application.emailVerifiedAt) throw Object.assign(new Error("EMAIL_NOT_VERIFIED"), { status: 409 });
      if (!application.representativeIdFileKey || (application.entityType === "company" && !application.businessRegistrationFileKey)) {
        throw Object.assign(new Error("DOCUMENTS_REQUIRED"), { status: 409 });
      }
      if (!application.signingSessionId || !application.signedContractId) throw Object.assign(new Error("SIGNATURE_REQUIRED"), { status: 409 });
      const [[session], [signed], [template]] = await Promise.all([
        tx.select().from(signingSessionsTable).where(eq(signingSessionsTable.id, application.signingSessionId)),
        tx.select().from(signedContractsTable).where(eq(signedContractsTable.id, application.signedContractId)),
        tx.select().from(contractTemplatesTable).where(eq(contractTemplatesTable.id, application.contractTemplateId)),
      ]);
      if (!session || session.status !== "signed" || !signed || !template) throw Object.assign(new Error("SIGNATURE_REQUIRED"), { status: 409 });
      if (session.subjectType !== "agent_application" || session.subjectId !== application.id || signed.signingSessionId !== session.id) throw Object.assign(new Error("SIGNATURE_MISMATCH"), { status: 409 });
      if ((session.verifiedEmail || "").trim().toLowerCase() !== application.email.trim().toLowerCase()) throw Object.assign(new Error("EMAIL_NOT_VERIFIED"), { status: 409 });
      if (normalizeRegistrationKey(template.entityType) !== application.entityType || normalizeRegistrationKey(template.language) !== application.preferredLanguage) throw Object.assign(new Error("CONTRACT_MISMATCH"), { status: 409 });
      const sessionIntake = session.intakeData && typeof session.intakeData === "object" ? session.intakeData as Record<string, unknown> : {};
      if (sessionIntake.agentApplicationContractHash !== application.contractDataHash) throw Object.assign(new Error("SIGNED_DATA_CHANGED"), { status: 409 });
      const currentContractHash = computeAgentApplicationContractHash({
        templateId: application.contractTemplateId,
        entityType: application.entityType,
        preferredLanguage: application.preferredLanguage,
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phone: application.phone,
        companyName: application.companyName,
        businessName: application.businessName,
        taxNumber: application.taxNumber,
        country: application.country,
        state: application.state,
        city: application.city,
        address: application.address,
        website: application.website,
      });
      if (currentContractHash !== application.contractDataHash) throw Object.assign(new Error("SIGNED_DATA_CHANGED"), { status: 409 });
      const assignedStaffId = parsed.data.assignedStaffId === undefined ? application.assignedStaffId : parsed.data.assignedStaffId;
      const branchId = parsed.data.branchId === undefined ? application.branchId : parsed.data.branchId;
      const [existingAgentForRate] = application.provisionalAgentId
        ? await tx.select().from(agentsTable).where(eq(agentsTable.id, application.provisionalAgentId))
        : [];
      const commissionRate = parsed.data.commissionRate ?? application.approvedCommissionRate ?? existingAgentForRate?.commissionRate;
      if (!assignedStaffId) throw Object.assign(new Error("STAFF_REQUIRED"), { status: 409 });
      if (!branchId) throw Object.assign(new Error("BRANCH_REQUIRED"), { status: 409 });
      if (commissionRate == null || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        throw Object.assign(new Error("COMMISSION_REQUIRED"), { status: 409 });
      }
      const [[staffUser], [branch]] = await Promise.all([
        tx.select().from(usersTable).where(eq(usersTable.id, assignedStaffId)),
        tx.select().from(branchesTable).where(and(eq(branchesTable.id, branchId), isNull(branchesTable.archivedAt))),
      ]);
      if (!staffUser || !staffUser.isActive || !new Set<string>(STAFF_ROLES).has(staffUser.role)) {
        throw Object.assign(new Error("STAFF_INVALID"), { status: 409 });
      }
      if (!branch) throw Object.assign(new Error("BRANCH_INVALID"), { status: 409 });

      let [user] = application.provisionalUserId
        ? await tx.select().from(usersTable).where(eq(usersTable.id, application.provisionalUserId))
        : [];
      if (!user) [user] = await tx.select().from(usersTable).where(ilike(usersTable.email, application.email));
      if (user && user.role !== "agent") throw Object.assign(new Error("EMAIL_EXISTS"), { status: 409 });
      if (!user) {
        [user] = await tx.insert(usersTable).values({
          email: application.email,
          firstName: application.firstName,
          lastName: application.lastName,
          role: "agent",
          phone: application.phone,
          phoneE164: application.phoneE164,
          passwordHash: null,
          passwordResetToken: passwordSetup.tokenHash,
          passwordResetExpires: passwordSetup.expiresAt,
          language: application.preferredLanguage,
          emailVerified: true,
          isActive: true,
          createdFromSource: "agency_application",
        }).returning();
      }
      const passwordSetupRequired = !user.passwordHash;
      await tx.update(usersTable).set({
        firstName: application.firstName,
        lastName: application.lastName,
        phone: application.phone,
        phoneE164: application.phoneE164,
        language: application.preferredLanguage,
        emailVerified: true,
        isActive: true,
        ...(passwordSetupRequired ? {
          passwordResetToken: passwordSetup.tokenHash,
          passwordResetExpires: passwordSetup.expiresAt,
        } : {}),
        updatedAt: new Date(),
      }).where(eq(usersTable.id, user.id));

      let [agent] = application.provisionalAgentId
        ? await tx.select().from(agentsTable).where(eq(agentsTable.id, application.provisionalAgentId))
        : [];
      if (!agent) [agent] = await tx.select().from(agentsTable).where(eq(agentsTable.userId, user.id));
      const now = new Date();
      if (!agent) {
        [agent] = await tx.insert(agentsTable).values({
          userId: user.id,
          firstName: application.firstName,
          lastName: application.lastName,
          email: application.email,
          phone: application.phone,
          phoneE164: application.phoneE164,
          entityType: application.entityType,
          preferredContractLanguage: application.preferredLanguage,
          assignedContractTemplateId: application.contractTemplateId,
          companyName: application.companyName,
          businessName: application.businessName,
          taxNumber: application.taxNumber,
          country: application.country,
          state: application.state,
          city: application.city,
          address: application.address,
          logoUrl: application.logoFileKey,
          agentIdProofUrl: application.representativeIdFileKey,
          businessCertUrl: application.businessRegistrationFileKey,
          status: "provisional",
          accessTier: "provisional",
          canManageStaff: false,
          assignedStaffId,
          embedToken: crypto.randomUUID(),
        }).returning();
      }
      const [activatedAgent] = await tx.update(agentsTable).set({
        userId: user.id,
        agencyCode: sql`COALESCE(${agentsTable.agencyCode}, 'FAS-' || TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' || LPAD(nextval('agent_agency_code_seq')::text, 6, '0'))`,
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phone: application.phone,
        phoneE164: application.phoneE164,
        entityType: application.entityType,
        preferredContractLanguage: application.preferredLanguage,
        assignedContractTemplateId: application.contractTemplateId,
        companyName: application.companyName,
        businessName: application.businessName,
        taxNumber: application.taxNumber,
        country: application.country,
        state: application.state,
        city: application.city,
        address: application.address,
        logoUrl: application.logoFileKey,
        agentIdProofUrl: application.representativeIdFileKey,
        businessCertUrl: application.businessRegistrationFileKey,
        commissionRate,
        assignedStaffId,
        status: "active",
        accessTier: "full",
        commercialActivatedAt: now,
        canManageStaff: true,
        updatedAt: now,
      }).where(eq(agentsTable.id, agent.id)).returning();
      agent = activatedAgent;
      await tx.insert(agentBranchesTable).values({ agentId: agent.id, branchId }).onConflictDoNothing();
      await tx.update(signingSessionsTable).set({ agentId: agent.id, updatedAt: now }).where(eq(signingSessionsTable.id, session.id));
      await tx.update(signedContractsTable).set({ agentId: agent.id }).where(eq(signedContractsTable.id, signed.id));
      const [approved] = await tx.update(agentApplicationsTable).set({
        status: "approved",
        provisionalUserId: user.id,
        provisionalAgentId: agent.id,
        approvedAgentId: agent.id,
        assignedStaffId,
        branchId,
        approvedCommissionRate: commissionRate,
        portalAccessStatus: "active",
        commercialActivatedAt: now,
        accessRestrictedAt: null,
        accessRestrictionReason: null,
        ...(passwordSetupRequired ? { passwordSetupSentAt: now } : {}),
        reviewNotes: parsed.data.reviewNotes === undefined ? application.reviewNotes : clean(parsed.data.reviewNotes),
        approvedAt: now,
        reviewedAt: now,
        reviewedByUserId: req.user!.id,
        updatedAt: now,
      }).where(eq(agentApplicationsTable.id, application.id)).returning();
      return { agent, application: approved, alreadyApproved: false, passwordSetupRequired };
    });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.code === "23505" ? 409 : 500);
    const messages: Record<string, string> = {
      NOT_FOUND: "Application not found",
      NOT_READY: "Application must have a verified signed contract before approval",
      SIGNATURE_REQUIRED: "A verified signed contract is required",
      SIGNATURE_MISMATCH: "Signed contract does not belong to this application",
      EMAIL_NOT_VERIFIED: "Signer email has not been verified",
      CONTRACT_MISMATCH: "Signed contract does not match the selected type and language",
      SIGNED_DATA_CHANGED: "Contract-relevant application data changed after signing; a new signature is required",
      EMAIL_EXISTS: "An account with this email already exists",
      DOCUMENTS_REQUIRED: "All required agency documents must be present before approval",
      STAFF_REQUIRED: "Assigned staff is required before commercial activation",
      BRANCH_REQUIRED: "Branch is required before commercial activation",
      COMMISSION_REQUIRED: "Commission rate is required before commercial activation",
      STAFF_INVALID: "Assigned staff must be an active staff or manager user",
      BRANCH_INVALID: "The selected branch is not available",
      APPROVED_AGENT_MISSING: "The previously approved agent record is missing",
    };
    res.status(status).json({ error: messages[error?.message] || "Application could not be approved" });
    return;
  }
  if (!result) { res.status(500).json({ error: "Application could not be approved" }); return; }
  if (!result.alreadyApproved && result.application.assignedStaffId) {
    await setAgencyStaff(result.agent.id, [{ userId: result.application.assignedStaffId, isPrimary: true }]).catch((error) => console.error("[agent-applications] assign staff", error));
  }
  let invitationDispatched = false;
  const passwordSetupPath = `/${result.application.preferredLanguage || "en"}/login?token=${encodeURIComponent(passwordSetup.rawToken)}`;
  if (!result.alreadyApproved && result.passwordSetupRequired && isLiveIntegrationsEnabled()) {
    try {
      const content = await buildAgencyPortalInvitationEmail({
        firstName: result.agent.firstName,
        referenceCode: result.application.referenceCode,
        passwordSetupUrl: `${getAppBaseUrl()}${passwordSetupPath}`,
        trackingUrl: `${getAppBaseUrl()}/agent`,
      });
      invitationDispatched = await sendEmail(result.application.email, content);
    } catch (error) { console.error("[agent-applications] password setup invitation", error); }
  }
  await writeAudit({ userId: req.user!.id, action: "agent_application.approved", resource: "agent_application", resourceId: id, changes: { agentId: result.agent.id, invitationDispatched, commissionRate: result.application.approvedCommissionRate, assignedStaffId: result.application.assignedStaffId, branchId: result.application.branchId }, ipAddress: req.ip });
  res.json({ data: {
    application: result.application,
    agent: result.agent,
    invitationDispatched,
    alreadyApproved: result.alreadyApproved,
    ...(process.env.NODE_ENV !== "production" && result.passwordSetupRequired && !invitationDispatched ? { passwordSetupPath } : {}),
  } });
});

export default router;
