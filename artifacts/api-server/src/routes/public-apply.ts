import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, usersTable, studentsTable, applicationsTable, programsTable, universitiesTable, commissionsTable, serviceFeesTable, leadsTable, documentsTable, pipelineStagesTable, programDocumentRequirementsTable } from "@workspace/db";
import { eq, and, isNotNull, inArray, isNull, sql } from "drizzle-orm";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import { getDocEquivalenceGroup, getRelevantGroupsForLevel, type DocEquivalenceGroupId } from "@workspace/doc-equivalence";
import rateLimit from "express-rate-limit";
import { generateSecureToken, buildWelcomeEmail, buildExistingAccountEmail, sendEmail } from "../lib/email";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";
import { isAllowedMimeType, isPdf, validateUploadedFile } from "../lib/fileUploadValidation";
import { buildDocNameFromParts } from "../lib/docNaming";
import { PgRateLimitStore } from "../lib/pgRateLimiter";
import { normalizeGpaTo100 } from "../lib/gpaNormalize";
import { getCurrentSeason } from "../lib/season";

const router: IRouter = Router();

const APPLY_WINDOW_MS = 15 * 60 * 1000;

const applyLimiter = rateLimit({
  windowMs: APPLY_WINDOW_MS,
  max: 10,
  message: { error: "Too many applications. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore(APPLY_WINDOW_MS),
});

const aiExtractLimiter = rateLimit({
  windowMs: APPLY_WINDOW_MS,
  max: 5,
  message: { error: "Too many AI extraction requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore(APPLY_WINDOW_MS),
});

/**
 * Read-only validation of a public-apply submission against a program.
 *
 * Runs the eligibility (GPA / language score) and quota checks WITHOUT
 * writing anything. Used at the top of /public/apply so we can reject
 * unfit submissions before creating the user/student records — otherwise
 * a failed apply leaves an orphan user behind that then triggers a 409
 * "your account is already registered" on retry.
 *
 * Returns null when the program is fine to apply to (or when there is no
 * programId / the program does not declare these constraints).
 */
async function precheckProgramEligibility(
  programId: number | null,
  studentGpa: string | null | undefined,
  studentLanguageScore: string | null | undefined,
): Promise<{ eligibilityErrors?: string[]; quotaError?: string } | null> {
  if (!programId) return null;
  const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!prog) return null;

  const eligibilityErrors: string[] = [];
  if (prog.minGpa != null && prog.minGpa > 0) {
    const gpaNum = normalizeGpaTo100(studentGpa);
    if (isNaN(gpaNum)) {
      eligibilityErrors.push(`Program requires minimum GPA of ${prog.minGpa} (out of 100), but no GPA was provided`);
    } else if (gpaNum < prog.minGpa) {
      eligibilityErrors.push(`GPA (${gpaNum.toFixed(2)}/100) is below the minimum required (${prog.minGpa}/100)`);
    }
  }
  if (prog.minLanguageScore != null && prog.minLanguageScore > 0) {
    const langNum = parseFloat(studentLanguageScore || "");
    if (isNaN(langNum)) {
      eligibilityErrors.push(`Program requires minimum language score of ${prog.minLanguageScore}, but no language score was provided`);
    } else if (langNum < prog.minLanguageScore) {
      eligibilityErrors.push(`Language score (${langNum}) is below the minimum required (${prog.minLanguageScore})`);
    }
  }
  if (eligibilityErrors.length > 0) return { eligibilityErrors };

  if (prog.quota != null) {
    const wonStages = await db.select({ key: pipelineStagesTable.key })
      .from(pipelineStagesTable)
      .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
    const wonKeys = wonStages.map(s => s.key);
    if (wonKeys.length > 0) {
      const currentYear = await getCurrentSeason();
      const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(
          eq(applicationsTable.programId, prog.id),
          eq(applicationsTable.season, currentYear),
          inArray(applicationsTable.stage, wonKeys),
          isNull(applicationsTable.deletedAt),
        ));
      if (Number(cnt) >= prog.quota) {
        return { quotaError: `Program quota is full (${prog.quota}/${prog.quota} enrolled)` };
      }
    }
  }
  return null;
}

async function createApplicationForStudent(studentId: number, programId: number | null, programName: string | null, universityName: string | null, studentGpa?: string | null, studentLanguageScore?: string | null): Promise<{ appId: number | null; eligibilityErrors?: string[]; quotaError?: string }> {
  try {
    let snapshotTuitionFee: number | null = null;
    let snapshotDiscountedFee: number | null = null;
    let snapshotScholarship: number | null = null;
    let snapshotCommissionRate: number | null = null;
    let snapshotServiceFeeAmount: number | null = null;
    let snapshotApplicationFee: number | null = null;
    let snapshotDepositFee: number | null = null;
    let snapshotAdvancedFee: number | null = null;
    let snapshotLanguageFee: number | null = null;
    let snapshotCurrency = "USD";
    let snapshotProgramName = programName || null;
    let snapshotUniversityName = universityName || null;
    let snapshotCountry: string | null = null;
    let snapshotLevel: string | null = null;
    let snapshotLanguage: string | null = null;
    let snapshotUniversityId: number | null = null;
    let isStateUniversity = false;

    if (programId) {
      const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
      if (prog) {
        const eligibilityErrors: string[] = [];
        if (prog.minGpa != null && prog.minGpa > 0) {
          const gpaNum = normalizeGpaTo100(studentGpa);
          if (isNaN(gpaNum)) {
            eligibilityErrors.push(`Program requires minimum GPA of ${prog.minGpa} (out of 100), but no GPA was provided`);
          } else if (gpaNum < prog.minGpa) {
            eligibilityErrors.push(`GPA (${gpaNum.toFixed(2)}/100) is below the minimum required (${prog.minGpa}/100)`);
          }
        }
        if (prog.minLanguageScore != null && prog.minLanguageScore > 0) {
          const langNum = parseFloat(studentLanguageScore || "");
          if (isNaN(langNum)) {
            eligibilityErrors.push(`Program requires minimum language score of ${prog.minLanguageScore}, but no language score was provided`);
          } else if (langNum < prog.minLanguageScore) {
            eligibilityErrors.push(`Language score (${langNum}) is below the minimum required (${prog.minLanguageScore})`);
          }
        }
        if (eligibilityErrors.length > 0) {
          return { appId: null, eligibilityErrors };
        }

        if (prog.quota != null) {
          const wonStages = await db.select({ key: pipelineStagesTable.key })
            .from(pipelineStagesTable)
            .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
          const wonKeys = wonStages.map(s => s.key);
          if (wonKeys.length > 0) {
            const currentYear = await getCurrentSeason();
            const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)` })
              .from(applicationsTable)
              .where(and(
                eq(applicationsTable.programId, prog.id),
                eq(applicationsTable.season, currentYear),
                inArray(applicationsTable.stage, wonKeys),
                isNull(applicationsTable.deletedAt),
              ));
            if (Number(cnt) >= prog.quota) {
              return { appId: null, quotaError: `Program quota is full (${prog.quota}/${prog.quota} enrolled)` };
            }
          }
        }

        snapshotTuitionFee = prog.tuitionFee ?? null;
        snapshotDiscountedFee = (prog.discountedFee != null && !isNaN(Number(prog.discountedFee))) ? Number(prog.discountedFee) : null;
        snapshotScholarship = prog.scholarship ?? null;
        snapshotCommissionRate = prog.commissionRate ?? null;
        snapshotServiceFeeAmount = prog.serviceFeeAmount ?? null;
        snapshotApplicationFee = prog.applicationFee ?? null;
        snapshotDepositFee = prog.depositFee ?? null;
        snapshotAdvancedFee = prog.advancedFee ?? null;
        snapshotLanguageFee = prog.languageFee ?? null;
        snapshotCurrency = prog.currency || "USD";
        snapshotProgramName = snapshotProgramName || prog.name;
        snapshotLevel = prog.degree || null;
        snapshotLanguage = prog.language || null;
        snapshotUniversityId = prog.universityId;

        if (prog.universityId) {
          const [uni] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, prog.universityId));
          if (uni) {
            snapshotUniversityName = snapshotUniversityName || uni.name;
            snapshotCountry = uni.country || null;
            isStateUniversity = uni.universityType === "state";
          }
        }
      }
    }

    const currentYear = await getCurrentSeason();
    const stage = "inquiry";

    const [studentRec] = await db.select({ firstName: studentsTable.firstName, lastName: studentsTable.lastName }).from(studentsTable).where(eq(studentsTable.id, studentId));
    const studentFullName = studentRec ? `${studentRec.firstName || ""} ${studentRec.lastName || ""}`.trim() : null;

    const [app] = await db.insert(applicationsTable).values({
      studentId,
      stage,
      season: currentYear,
      universityId: snapshotUniversityId,
      programId: programId || null,
      agentId: null,
      universityName: snapshotUniversityName,
      country: snapshotCountry,
      programName: snapshotProgramName,
      level: snapshotLevel,
      instructionLanguage: snapshotLanguage,
      tuitionFee: snapshotTuitionFee,
      discountedFee: snapshotDiscountedFee,
      scholarship: snapshotScholarship,
      commissionRate: snapshotCommissionRate,
      serviceFeeAmount: snapshotServiceFeeAmount,
      applicationFee: snapshotApplicationFee,
      depositFee: snapshotDepositFee,
      advancedFee: snapshotAdvancedFee,
      languageFee: snapshotLanguageFee,
      currency: snapshotCurrency,
    }).returning();

    const commissionBaseFee = (snapshotDiscountedFee != null && !isNaN(snapshotDiscountedFee))
      ? snapshotDiscountedFee
      : snapshotTuitionFee;

    // Commission, service fee, and student status are independent — run in parallel.
    await Promise.all([
      // Chain 1: commission record
      (async () => {
        const commFinStatus = await getCommissionFinanceStatus(stage);
        if (commFinStatus === "excluded") return;
        const uCommAmount = commissionBaseFee && snapshotCommissionRate
          ? (commissionBaseFee * snapshotCommissionRate) / 100 : 0;
        const agentComm = await resolveAgentCommission(null, uCommAmount);
        await db.insert(commissionsTable).values({
          applicationId: app.id,
          studentId,
          agentId: null,
          studentName: studentFullName,
          universityName: snapshotUniversityName,
          programName: snapshotProgramName,
          isStateUniversity,
          season: currentYear,
          currency: snapshotCurrency,
          status: commFinStatus,
          programFee: commissionBaseFee ? String(commissionBaseFee) : null,
          universityCommissionRate: snapshotCommissionRate ? String(snapshotCommissionRate) : null,
          universityCommissionAmount: uCommAmount > 0 ? String(uCommAmount) : null,
          agentCommissionRate: agentComm.agentCommissionRate,
          agentCommissionAmount: agentComm.agentCommissionAmount,
          subAgentId: agentComm.subAgentId,
          subAgentCommissionRate: agentComm.subAgentCommissionRate,
          subAgentCommissionAmount: agentComm.subAgentCommissionAmount,
        });
      })(),

      // Chain 2: service fee record
      (async () => {
        const sfFinStatus = await getServiceFeeFinanceStatus(stage);
        if (sfFinStatus === "excluded") return;
        const sfTotal = snapshotServiceFeeAmount ? String(snapshotServiceFeeAmount) : "0";
        const sfHalf = snapshotServiceFeeAmount ? String(snapshotServiceFeeAmount / 2) : null;
        await db.insert(serviceFeesTable).values({
          applicationId: app.id,
          studentId,
          agentId: null,
          studentName: studentFullName,
          universityName: snapshotUniversityName,
          isStateUniversity,
          season: currentYear,
          currency: snapshotCurrency,
          totalAmount: sfTotal,
          firstInstallmentAmount: sfHalf,
          secondInstallmentAmount: sfHalf,
          financeStatus: sfFinStatus,
          status: "pending",
        });
      })(),

      // Chain 3: student status update (best-effort — never throws)
      (async () => {
        try {
          const appMadeStages = await db.select({ key: pipelineStagesTable.key, label: pipelineStagesTable.label })
            .from(pipelineStagesTable)
            .where(eq(pipelineStagesTable.entityType, "student"));
          const appMadeStage = appMadeStages.find(s => s.key === "done") || appMadeStages.find(s => s.label?.toLowerCase().includes("application made"));
          if (appMadeStage) {
            await db.update(studentsTable).set({ status: appMadeStage.key }).where(eq(studentsTable.id, studentId));
          }
        } catch {}
      })(),
    ]);

    console.log(`[AUTO-APPLICATION] Created application #${app.id} for student #${studentId}, program: ${snapshotProgramName}`);
    return { appId: app.id };
  } catch (err) {
    console.error("[AUTO-APPLICATION] Error creating application:", err);
    return { appId: null };
  }
}

router.post("/public/apply", applyLimiter, async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, phone, phoneCode, nationality, programId, programName, universityName, notes, motherName, fatherName, passportNumber, passportIssueDate, passportExpiry, dateOfBirth, gender, address, highSchool, graduationYear, gpa, languageScore, leadId, documents, reuseDocumentIds } = req.body;

  if (!firstName || !lastName || !email || !phone || !motherName || !fatherName || !nationality || !gender) {
    res.status(400).json({ error: "firstName, lastName, email, phone, motherName, fatherName, nationality, and gender are required" });
    return;
  }

  const normalizedGender = String(gender).toLowerCase();
  if (normalizedGender !== "female" && normalizedGender !== "male") {
    res.status(400).json({ error: "gender must be 'female' or 'male'" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  const s = (v: any, max: number) => v ? String(v).slice(0, max) : null;

  const normalizedEmail = email.toLowerCase().trim();

  const { getAppBaseUrl } = await import("../lib/email.js");
  const baseUrl = getAppBaseUrl();
  const loginUrl = `${baseUrl}/login`;

  const trimmedPassport = passportNumber ? String(passportNumber).trim() : "";

  try {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    // Staff email conflict — block immediately. We never want a public
    // submission to silently attach itself to an internal staff account.
    if (existingUser && existingUser.role !== "student") {
      res.status(409).json({ error: "This email is already in use by a staff account. Please use a different email.", code: "EMAIL_STAFF_CONFLICT" });
      return;
    }

    if (trimmedPassport) {
      const [dupPassportStudent] = await db.select({ id: studentsTable.id, userId: studentsTable.userId })
        .from(studentsTable)
        .where(and(eq(studentsTable.passportNumber, trimmedPassport), isNull(studentsTable.deletedAt)));
      // Passport mismatch with an existing student that belongs to a
      // different user/email is suspicious — block and direct to login.
      if (dupPassportStudent && (!existingUser || dupPassportStudent.userId !== existingUser.id)) {
        res.status(409).json({
          error: `This passport number has already been used in our system. Please log in to your existing account to continue your application: ${loginUrl}`,
          code: "PASSPORT_IN_USE",
          loginUrl,
        });
        return;
      }
    }

    // Validate program eligibility/quota BEFORE creating any user/student
    // record. If we created the user first and then 422'd here, a retried
    // submission would hit the email-already-exists path and be blocked
    // forever ("hesabınız kayıtlıdır" loop).
    const programIdNum = programId ? parseInt(String(programId), 10) : null;
    const precheck = await precheckProgramEligibility(programIdNum, gpa || null, languageScore || null);
    if (precheck?.eligibilityErrors) {
      res.status(422).json({ error: "Student does not meet program eligibility requirements", eligibilityErrors: precheck.eligibilityErrors, code: "ELIGIBILITY_FAILED" });
      return;
    }
    if (precheck?.quotaError) {
      res.status(422).json({ error: precheck.quotaError, code: "QUOTA_FULL" });
      return;
    }

    let resultStudentId: number | null = null;
    let resultAppId: number | null = null;

    if (existingUser) {
      // Existing student account — reuse it. We do not want to block the
      // applicant with a 409 just because they (or someone with the same
      // email) previously applied to a different program. Lead-only
      // entries never reach this branch (leads do not create users).
      const [existingStudent] = await db.select().from(studentsTable)
        .where(and(eq(studentsTable.userId, existingUser.id), isNull(studentsTable.deletedAt)));
      if (!existingStudent) {
        // Edge case: the user row exists but the matching student row was
        // hard-deleted. Fall through to the new-account path so we
        // re-create a clean student record for them below.
        console.warn(`[PUBLIC-APPLY] User #${existingUser.id} (${normalizedEmail}) has no live student record — recreating.`);
      } else {
        resultStudentId = existingStudent.id;
        const reuseAppResult = await createApplicationForStudent(existingStudent.id, programIdNum, programName, universityName, existingStudent.gpa || gpa || null, existingStudent.languageScore || languageScore || null);
        if (reuseAppResult.eligibilityErrors) {
          res.status(422).json({ error: "Student does not meet program eligibility requirements", eligibilityErrors: reuseAppResult.eligibilityErrors, code: "ELIGIBILITY_FAILED" });
          return;
        }
        if (reuseAppResult.quotaError) {
          res.status(422).json({ error: reuseAppResult.quotaError, code: "QUOTA_FULL" });
          return;
        }
        resultAppId = reuseAppResult.appId;

        // Notify the existing account holder that a new application was
        // received and remind them how to log in.
        try {
          const existingEmailContent = await buildExistingAccountEmail({
            firstName: existingUser.firstName || existingStudent.firstName || "Student",
            loginUrl,
            programName: programName || undefined,
            universityName: universityName || undefined,
          });
          await sendEmail(normalizedEmail, existingEmailContent);
        } catch (e) {
          console.error("[PUBLIC-APPLY] Failed to send existing-account notification:", e);
        }

        console.log(`[PUBLIC-APPLY] Reused existing student #${existingStudent.id} (${normalizedEmail}) — created application #${resultAppId}`);
      }
    }

    if (!existingUser || resultStudentId === null) {
      const [archivedByEmail] = await db.select().from(studentsTable).where(and(eq(studentsTable.email, normalizedEmail), isNotNull(studentsTable.deletedAt)));

      const passwordToken = generateSecureToken();
      const verificationToken = generateSecureToken();

      const [newUser] = await db.insert(usersTable).values({
        email: normalizedEmail,
        firstName: s(firstName, 100)!,
        lastName: s(lastName, 100)!,
        phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
        role: "student",
        isActive: false,
        emailVerified: false,
        language: "en",
        passwordResetToken: crypto.createHash("sha256").update(passwordToken).digest("hex"),
        passwordResetExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
        emailVerificationToken: verificationToken,
        createdFromSource: "public_apply",
      }).returning();

      let newStudent: any;
      if (archivedByEmail) {
        await db.update(studentsTable).set({ deletedAt: null, userId: newUser.id }).where(eq(studentsTable.id, archivedByEmail.id));
        newStudent = { ...archivedByEmail, deletedAt: null, userId: newUser.id };
        console.log(`[PUBLIC-APPLY] Restored archived student #${archivedByEmail.id} for new user ${normalizedEmail}`);
      } else {
        [newStudent] = await db.insert(studentsTable).values({
          userId: newUser.id,
          firstName: s(firstName, 100)!,
          lastName: s(lastName, 100)!,
          email: normalizedEmail,
          phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
          nationality: nationality || null,
          dateOfBirth: s(dateOfBirth, 20),
          gender: normalizedGender,
          motherName: s(motherName, 100),
          fatherName: s(fatherName, 100),
          passportNumber: s(passportNumber, 50),
          passportIssueDate: s(passportIssueDate, 20),
          passportExpiry: s(passportExpiry, 20),
          address: s(address, 300),
          highSchool: s(highSchool, 200),
          graduationYear: graduationYear ? parseInt(String(graduationYear), 10) || null : null,
          gpa: s(gpa, 20),
          languageScore: s(languageScore, 20),
        }).returning();
      }

      resultStudentId = newStudent.id;
      const newAppResult = await createApplicationForStudent(newStudent.id, programId ? parseInt(String(programId), 10) : null, programName, universityName, gpa || null, languageScore || null);
      if (newAppResult.eligibilityErrors) {
        res.status(422).json({ error: "Student does not meet program eligibility requirements", eligibilityErrors: newAppResult.eligibilityErrors, code: "ELIGIBILITY_FAILED" });
        return;
      }
      if (newAppResult.quotaError) {
        res.status(422).json({ error: newAppResult.quotaError, code: "QUOTA_FULL" });
        return;
      }
      resultAppId = newAppResult.appId;

      const setPasswordUrl = `${baseUrl}/login?token=${passwordToken}`;
      const verifyEmailUrl = `${baseUrl}/api/auth/verify-email-token/${verificationToken}`;

      const emailContent = await buildWelcomeEmail({
        firstName: s(firstName, 100) || "Student",
        email: normalizedEmail,
        setPasswordUrl,
        verifyEmailUrl,
        loginUrl,
        programName: programName || undefined,
        universityName: universityName || undefined,
      });
      await sendEmail(normalizedEmail, emailContent);

      console.log(`[PUBLIC-APPLY] Created student account for ${normalizedEmail} (user #${newUser.id}, student #${newStudent.id})`);
    }

    if (leadId) {
      try {
        await db.update(leadsTable).set({ status: "converted" }).where(eq(leadsTable.id, parseInt(String(leadId), 10)));
      } catch (e) {
        console.error("[PUBLIC-APPLY] Failed to update lead status:", e);
      }
    }

    if (Array.isArray(documents) && documents.length > 0 && resultStudentId && resultAppId) {
      const MAX_DOCS = 10;
      const MAX_DOC_SIZE = 5 * 1024 * 1024;
      const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
      try {
        const validDocs = documents.slice(0, MAX_DOCS);
        let savedCount = 0;
        let photoSet = false;
        for (const doc of validDocs) {
          if (!doc.base64 || !doc.name) continue;
          const mime = String(doc.mediaType || "").toLowerCase();
          if (!ALLOWED_MIME.includes(mime)) continue;
          const rawSize = doc.sizeBytes ? parseInt(String(doc.sizeBytes), 10) : 0;
          if (rawSize > MAX_DOC_SIZE) continue;
          const base64Len = typeof doc.base64 === "string" ? doc.base64.length : 0;
          if (base64Len > MAX_DOC_SIZE * 1.4) continue;
          const docType = String(doc.key || doc.label || "other").slice(0, 100);
          const descriptiveName = buildDocNameFromParts(firstName, lastName, docType, mime);
          await db.insert(documentsTable).values({
            studentId: resultStudentId,
            applicationId: resultAppId,
            name: descriptiveName,
            type: docType,
            status: "pending",
            fileData: doc.base64,
            mimeType: mime,
            sizeBytes: rawSize || null,
          });
          if (!photoSet && (docType === "photo" || docType === "photograph") && resultStudentId) {
            try {
              const photoUrl = `data:${mime};base64,${doc.base64}`;
              await db.update(studentsTable).set({ photoUrl }).where(eq(studentsTable.id, resultStudentId));
              photoSet = true;
            } catch (e) {
              console.error("[PUBLIC-APPLY] Failed to set student photo:", e);
            }
          }
          savedCount++;
        }
        if (savedCount > 0) {
          console.log(`[PUBLIC-APPLY] Saved ${savedCount} document(s) for student #${resultStudentId}, app #${resultAppId}`);
        }
      } catch (docErr) {
        console.error("[PUBLIC-APPLY] Failed to save documents:", docErr);
      }
    }

    // Reuse existing student documents on the new application.
    //
    // We use the doc-type equivalence map so that, for example, a passport
    // that the student previously uploaded under canonical type "passport"
    // satisfies the apply form's "passport" key, and a high-school diploma
    // uploaded under "class_12th_hsc_certificate" satisfies the apply form's
    // "hs_diploma" key — and vice versa.
    //
    // Even when the client did not send any reuseDocumentIds (e.g. the
    // student is logged in and the docs step was skipped because everything
    // was already on file), we auto-link the student's existing valid docs
    // to the new application as long as they cover types the new program
    // could need.
    if (resultStudentId && resultAppId) {
      try {
        const requestedReuseIds = Array.isArray(reuseDocumentIds)
          ? reuseDocumentIds
              .map((id: any) => parseInt(String(id), 10))
              .filter((n: number) => Number.isFinite(n) && n > 0)
              .slice(0, 50)
          : [];

        // Compute the equivalence groups already covered by docs the
        // client uploaded fresh in this submission.
        const alreadyHaveGroups = new Set<DocEquivalenceGroupId>();
        if (Array.isArray(documents)) {
          for (const d of documents) {
            const t = String(d?.key || d?.label || "").trim();
            const g = getDocEquivalenceGroup(t);
            if (g) alreadyHaveGroups.add(g);
          }
        }

        // Look up the program's required document types so we can pick the
        // existing student docs that are actually relevant for this new
        // application. We combine the apply-form's per-level expectations
        // (passport/photo/hs/bachelor/master docs etc.) with any extra
        // canonical types attached to the program via
        // programDocumentRequirementsTable so any custom requirement an
        // admin added on the program editor is also honored.
        let allowedGroups: Set<DocEquivalenceGroupId> | null = null;
        try {
          const [appRow] = await db.select({
            programId: applicationsTable.programId,
            level: applicationsTable.level,
          }).from(applicationsTable).where(eq(applicationsTable.id, resultAppId));
          // Coarse level used only to pick the apply-form's per-level
          // baseline groups (passport / photo / HS / bachelor / master).
          const normalizeLevel = (level: string | null | undefined): string | null => {
            if (!level) return null;
            const l = level.toLowerCase().replace(/[\s.-]/g, "_");
            if (["pre_bachelors", "associate", "foundation", "pre_bachelor"].some(k => l.includes(k))) return "pre_bachelors";
            if (["bachelor"].some(k => l.includes(k)) && !l.includes("pre")) return "bachelors";
            if (["master"].some(k => l.includes(k)) && !l.includes("pre")) return "masters";
            if (["phd", "ph_d", "doctorate", "doctoral"].some(k => l.includes(k))) return "phd";
            if (["language", "pathway", "other"].some(k => l.includes(k))) return "others";
            return null;
          };
          const normalizedLevel = normalizeLevel(appRow?.level);
          let extraTypes: string[] = [];
          if (appRow?.programId) {
            const reqs = await db.select({ documentType: programDocumentRequirementsTable.documentType })
              .from(programDocumentRequirementsTable)
              .where(eq(programDocumentRequirementsTable.programId, appRow.programId));
            extraTypes = reqs.map(r => r.documentType);
          }
          allowedGroups = getRelevantGroupsForLevel(normalizedLevel, extraTypes);
          // When the application has no level at all (allowedGroups === null)
          // but the program does declare its own document requirements, build
          // the allow-list purely from those program-level requirements so we
          // do not silently fall back to fully permissive linking.
          if (allowedGroups === null && extraTypes.length > 0) {
            const fromProgram = new Set<DocEquivalenceGroupId>();
            for (const t of extraTypes) {
              const g = getDocEquivalenceGroup(t);
              if (g) fromProgram.add(g);
            }
            if (fromProgram.size > 0) allowedGroups = fromProgram;
          }
        } catch (lvlErr) {
          console.error("[PUBLIC-APPLY] Failed to load program requirements for reuse:", lvlErr);
        }

        // Candidate source docs: explicitly-requested reuseIds first, then
        // (always) the rest of the student's library so we cover the
        // "auto-link when reuseDocumentIds is empty" case as well.
        const reuseIdSet = new Set(requestedReuseIds);
        const allStudentDocs = await db.select().from(documentsTable).where(and(
          eq(documentsTable.studentId, resultStudentId),
          isNull(documentsTable.deletedAt),
        ));
        const sourceDocs = allStudentDocs
          .filter(d => d.id != null && d.applicationId !== resultAppId && d.status !== "rejected")
          .sort((a, b) => {
            // Explicitly-requested reuse IDs win, then most recent.
            const aReq = reuseIdSet.has(a.id) ? 1 : 0;
            const bReq = reuseIdSet.has(b.id) ? 1 : 0;
            if (aReq !== bReq) return bReq - aReq;
            const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bt - at;
          });

        let copied = 0;
        let photoSet = false;
        const seenGroups = new Set<DocEquivalenceGroupId>();
        const seenRawTypes = new Set<string>();
        for (const src of sourceDocs) {
          const srcType = String(src.type || "").trim();
          if (!srcType) continue;
          const srcGroup = getDocEquivalenceGroup(srcType);

          // Skip if a fresh upload in this submission already covers this
          // logical document, or if we already linked an equivalent one
          // for this application.
          if (srcGroup) {
            if (alreadyHaveGroups.has(srcGroup)) continue;
            if (seenGroups.has(srcGroup)) continue;
          } else {
            // Doc type not in the equivalence map — fall back to raw-type
            // dedup so we never link two copies of the same canonical type.
            const k = srcType.toLowerCase();
            if (seenRawTypes.has(k)) continue;
          }

          // When we know the program's level, restrict auto-linked docs to
          // groups that level's apply form / staff portal could need. If
          // the level is unknown (allowedGroups === null), fall back to
          // permissive linking so partial setups still benefit.
          //
          // Docs explicitly named in reuseDocumentIds are always honored —
          // the client opted into them.
          const isExplicitlyRequested = reuseIdSet.has(src.id);
          if (!isExplicitlyRequested && srcGroup && allowedGroups && !allowedGroups.has(srcGroup)) {
            continue;
          }

          if (srcGroup) seenGroups.add(srcGroup);
          else seenRawTypes.add(srcType.toLowerCase());

          await db.insert(documentsTable).values({
            studentId: resultStudentId,
            applicationId: resultAppId,
            name: src.name,
            type: srcType,
            status: src.status === "rejected" ? "pending" : (src.status || "pending"),
            fileData: src.fileData ?? null,
            fileUrl: src.fileUrl ?? null,
            fileKey: src.fileKey ?? null,
            mimeType: src.mimeType ?? null,
            sizeBytes: src.sizeBytes ?? null,
            notes: src.notes ?? null,
          });
          copied++;
          if (!photoSet && srcGroup === "photo" && src.fileData && src.mimeType) {
            try {
              const photoUrl = `data:${src.mimeType};base64,${src.fileData}`;
              await db.update(studentsTable).set({ photoUrl }).where(eq(studentsTable.id, resultStudentId));
              photoSet = true;
            } catch (e) {
              console.error("[PUBLIC-APPLY] Failed to set student photo from reused doc:", e);
            }
          }
        }
        if (copied > 0) {
          console.log(`[PUBLIC-APPLY] Reused ${copied} existing document(s) for student #${resultStudentId}, app #${resultAppId} (requested=${requestedReuseIds.length})`);
        }
      } catch (reuseErr) {
        console.error("[PUBLIC-APPLY] Failed to reuse existing documents:", reuseErr);
      }
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("[PUBLIC-APPLY] Error during student/application creation:", err);
    res.status(500).json({ error: "An error occurred while processing your application. Please try again." });
  }
});

const EXTRACT_PROMPT = `You are an expert document analysis system for an education consultancy. 
Analyze the provided document image(s) and extract student information.

Extract ALL of the following fields if visible in the document. Return a JSON object with these exact keys:
{
  "firstName": "string or null - EXACTLY as printed on the document, preserving original spelling",
  "lastName": "string or null - EXACTLY as printed on the document, preserving original spelling",
  "dateOfBirth": "YYYY-MM-DD format or null",
  "nationality": "full country name string (e.g. 'Afghanistan' not 'Afghan', 'Turkey' not 'Turkish') or null",
  "passportNumber": "string or null",
  "passportIssueDate": "YYYY-MM-DD format or null",
  "passportExpiry": "YYYY-MM-DD format or null",
  "passportExpired": "boolean - true if passport expiry date has passed, false otherwise, null if no expiry date found",
  "motherName": "string or null - EXACTLY as printed on the document",
  "fatherName": "string or null - EXACTLY as printed on the document",
  "email": "string or null",
  "phone": "string or null",
  "address": "string or null",
  "highSchool": "string or null",
  "graduationYear": "number or null",
  "gpa": "string or null",
  "languageScore": "string or null",
  "confidence": "high|medium|low"
}

Rules:
- CRITICAL - Names: Extract names EXACTLY as they appear on the passport or official document. The passport is the authoritative source for the person's legal name. Do NOT modify, translate, or reformat names. Copy them character by character as printed.
- CRITICAL - Date format awareness: Different countries use different date formats on passports:
  * Most countries (Europe, Asia, Middle East, Africa): DD/MM/YYYY or DD.MM.YYYY (day first)
  * USA, Philippines, some others: MM/DD/YYYY (month first)
  * East Asian countries (Japan, China, Korea): YYYY/MM/DD (year first)
  * Look at the passport's issuing country to determine the likely date format
  * When a date is ambiguous (e.g. 03/04/2025 could be March 4 or April 3), use the issuing country's convention
  * Always output dates in YYYY-MM-DD format after correctly interpreting the source format
- CRITICAL - Passport expiry: Check if the passport expiry date has passed relative to today's date. Set passportExpired to true if expired, false if still valid.
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates, mother name, father name (often listed on passport identity pages)
- For diplomas: extract school name, graduation year, GPA, student name, parent names if visible
- For transcripts: extract school name, GPA, graduation year, student name
- For photographs: note that a photo document was received
- For nationality: always return the full official country name. Convert any nationality adjective or demonym to the country name.
- Always normalize dates to YYYY-MM-DD format
- Return ONLY the JSON object, no other text
- Set null for fields you cannot find or are not sure about`;

router.post("/public/ai/extract-document", aiExtractLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { documents } = req.body as {
      documents: Array<{
        type: "image" | "pdf";
        data: string;
        mediaType: string;
        label: string;
      }>;
    };

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: "No documents provided" });
      return;
    }

    if (documents.length > 4) {
      res.status(400).json({ error: "Maximum 4 documents allowed" });
      return;
    }

    for (const doc of documents) {
      const mime = doc.mediaType || "";
      if (!mime || !isAllowedMimeType(mime)) {
        res.status(400).json({ error: "Sadece PDF, JPG, JPEG ve PNG dosyalar\u0131 y\u00fckleyebilirsiniz." });
        return;
      }
      const syntheticExt = isPdf(mime) ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
      const syntheticFileName = `document${syntheticExt}`;
      const estimatedSize = doc.data ? Math.ceil((doc.data.length * 3) / 4) : 0;
      const validationError = validateUploadedFile(syntheticFileName, mime, estimatedSize);
      if (validationError) {
        const statusCode = validationError.type === "size_exceeded" ? 413 : 400;
        res.status(statusCode).json({ error: validationError.message });
        return;
      }
    }

    const totalSize = documents.reduce((sum, d) => sum + (d.data?.length || 0), 0);
    if (totalSize > 10_000_000) {
      res.status(413).json({ error: "Documents too large. Please use smaller files." });
      return;
    }

    let anthropic;
    let claudeConfig;
    try {
      anthropic = await getAnthropicClient();
      claudeConfig = await getClaudeConfig();
    } catch (err: any) {
      res.status(503).json({ error: err.message || "AI integration not configured" });
      return;
    }

    const contentBlocks: any[] = [
      { type: "text", text: EXTRACT_PROMPT },
    ];

    for (const doc of documents) {
      contentBlocks.push({
        type: "text",
        text: `\n--- Document: ${doc.label} ---`,
      });

      if (doc.type === "image") {
        const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
        const mediaType = validMediaTypes.includes(doc.mediaType) ? doc.mediaType : "image/jpeg";
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: doc.data,
          },
        });
      } else {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: doc.data,
          },
        });
      }
    }

    const model = claudeConfig.model || "claude-sonnet-4-6";
    const message = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: contentBlocks }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    let extracted: Record<string, any> = {};
    try {
      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      }
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    // Normalize AI-extracted GPA to a 0-100 percent so the public form,
    // widget, and panel all show the same percentage no matter which
    // grading scale (4.0 / 5.0 / 10 / 20 / 100) the diploma uses.
    if (extracted.gpa != null && extracted.gpa !== "") {
      const raw = String(extracted.gpa);
      const pct = normalizeGpaTo100(raw);
      if (!isNaN(pct)) {
        extracted.gpaRaw = raw;
        extracted.gpa = (Math.round(pct * 10) / 10).toString();
        extracted.gpaScale = 100;
      }
    }

    const warnings: string[] = [];

    if (extracted.passportExpiry) {
      const parts = String(extracted.passportExpiry).split("-").map(Number);
      const expiryDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(NaN);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(expiryDate.getTime()) && expiryDate < today) {
        extracted.passportExpired = true;
        warnings.push(`Passport has expired on ${extracted.passportExpiry}. This passport cannot be used for applications.`);
      } else if (!isNaN(expiryDate.getTime())) {
        extracted.passportExpired = false;
      }
    }

    res.json({ extracted, warnings });
  } catch (err: any) {
    console.error("Public AI extraction error:", err);
    res.status(500).json({ error: "AI extraction failed. Please try again." });
  }
});

export default router;
