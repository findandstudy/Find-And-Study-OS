import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, usersTable, studentsTable, applicationsTable, programsTable, universitiesTable, commissionsTable, serviceFeesTable, leadsTable, documentsTable, pipelineStagesTable } from "@workspace/db";
import { eq, and, isNotNull, inArray, isNull, sql } from "drizzle-orm";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import rateLimit from "express-rate-limit";
import { generateSecureToken, buildWelcomeEmail, buildExistingAccountEmail, sendEmail } from "../lib/email";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";
import { isAllowedMimeType, isPdf, validateUploadedFile } from "../lib/fileUploadValidation";
import { PgRateLimitStore } from "../lib/pgRateLimiter";

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
        if (prog.minGpa != null) {
          const gpaNum = parseFloat(studentGpa || "");
          if (isNaN(gpaNum)) {
            eligibilityErrors.push(`Program requires minimum GPA of ${prog.minGpa}, but no GPA was provided`);
          } else if (gpaNum < prog.minGpa) {
            eligibilityErrors.push(`GPA (${gpaNum}) is below the minimum required (${prog.minGpa})`);
          }
        }
        if (prog.minLanguageScore != null) {
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
            const currentYear = String(new Date().getFullYear());
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

    const currentYear = String(new Date().getFullYear());
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

    const commFinStatus = await getCommissionFinanceStatus(stage);
    if (commFinStatus !== "excluded") {
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
    }

    const sfFinStatus = await getServiceFeeFinanceStatus(stage);
    if (sfFinStatus !== "excluded") {
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
    }

    try {
      const appMadeStages = await db.select({ key: pipelineStagesTable.key, label: pipelineStagesTable.label })
        .from(pipelineStagesTable)
        .where(eq(pipelineStagesTable.entityType, "student"));
      const appMadeStage = appMadeStages.find(s => s.key === "done") || appMadeStages.find(s => s.label?.toLowerCase().includes("application made"));
      if (appMadeStage) {
        await db.update(studentsTable).set({ status: appMadeStage.key }).where(eq(studentsTable.id, studentId));
      }
    } catch {}

    console.log(`[AUTO-APPLICATION] Created application #${app.id} for student #${studentId}, program: ${snapshotProgramName}`);
    return { appId: app.id };
  } catch (err) {
    console.error("[AUTO-APPLICATION] Error creating application:", err);
    return { appId: null };
  }
}

router.post("/public/apply", applyLimiter, async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, phone, phoneCode, nationality, programId, programName, universityName, notes, motherName, fatherName, passportNumber, passportIssueDate, passportExpiry, dateOfBirth, address, highSchool, graduationYear, gpa, languageScore, leadId, documents } = req.body;

  if (!firstName || !lastName || !email || !phone || !motherName || !fatherName || !nationality) {
    res.status(400).json({ error: "firstName, lastName, email, phone, motherName, fatherName, and nationality are required" });
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

  try {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    let resultStudentId: number | null = null;
    let resultAppId: number | null = null;

    if (existingUser) {
      if (existingUser.role !== "student") {
        res.status(409).json({ error: "This email is already in use by a staff account. Please use a different email." });
        return;
      }

      let [existingStudent] = await db.select().from(studentsTable).where(eq(studentsTable.userId, existingUser.id));

      if (existingStudent && existingStudent.deletedAt) {
        await db.update(studentsTable).set({ deletedAt: null }).where(eq(studentsTable.id, existingStudent.id));
        await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, existingUser.id));
        console.log(`[PUBLIC-APPLY] Restored archived student #${existingStudent.id} for user ${normalizedEmail}`);
      }

      if (!existingStudent) {
        const [archivedByEmail] = await db.select().from(studentsTable).where(and(eq(studentsTable.email, normalizedEmail), isNotNull(studentsTable.deletedAt)));
        if (archivedByEmail) {
          await db.update(studentsTable).set({ deletedAt: null, userId: existingUser.id }).where(eq(studentsTable.id, archivedByEmail.id));
          existingStudent = { ...archivedByEmail, deletedAt: null, userId: existingUser.id } as any;
          console.log(`[PUBLIC-APPLY] Restored archived student #${archivedByEmail.id} by email match`);
        }
      }

      if (!existingStudent) {
        [existingStudent] = await db.insert(studentsTable).values({
          userId: existingUser.id,
          firstName: existingUser.firstName || firstName,
          lastName: existingUser.lastName || lastName,
          email: normalizedEmail,
          phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
          nationality: nationality || null,
          dateOfBirth: s(dateOfBirth, 20),
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

      const fillableFields: Record<string, any> = {};
      if (!existingStudent.nationality && nationality) fillableFields.nationality = nationality;
      if (!existingStudent.dateOfBirth && dateOfBirth) fillableFields.dateOfBirth = s(dateOfBirth, 20);
      if (!existingStudent.motherName && motherName) fillableFields.motherName = s(motherName, 100);
      if (!existingStudent.fatherName && fatherName) fillableFields.fatherName = s(fatherName, 100);
      if (!existingStudent.passportNumber && passportNumber) fillableFields.passportNumber = s(passportNumber, 50);
      if (!existingStudent.passportIssueDate && passportIssueDate) fillableFields.passportIssueDate = s(passportIssueDate, 20);
      if (!existingStudent.passportExpiry && passportExpiry) fillableFields.passportExpiry = s(passportExpiry, 20);
      if (!existingStudent.address && address) fillableFields.address = s(address, 300);
      if (!existingStudent.highSchool && highSchool) fillableFields.highSchool = s(highSchool, 200);
      if (!existingStudent.graduationYear && graduationYear) fillableFields.graduationYear = parseInt(String(graduationYear), 10) || null;
      if (!existingStudent.gpa && gpa) fillableFields.gpa = s(gpa, 20);
      if (!existingStudent.languageScore && languageScore) fillableFields.languageScore = s(languageScore, 20);
      if (Object.keys(fillableFields).length > 0) {
        await db.update(studentsTable).set(fillableFields).where(eq(studentsTable.id, existingStudent.id));
      }

      resultStudentId = existingStudent.id;
      const studentGpaVal = existingStudent.gpa || gpa || null;
      const studentLangVal = existingStudent.languageScore || languageScore || null;
      const appResult = await createApplicationForStudent(existingStudent.id, programId ? parseInt(String(programId), 10) : null, programName, universityName, studentGpaVal, studentLangVal);
      if (appResult.eligibilityErrors) {
        res.status(422).json({ error: "Student does not meet program eligibility requirements", eligibilityErrors: appResult.eligibilityErrors, code: "ELIGIBILITY_FAILED" });
        return;
      }
      if (appResult.quotaError) {
        res.status(422).json({ error: appResult.quotaError, code: "QUOTA_FULL" });
        return;
      }
      resultAppId = appResult.appId;

      const emailContent = await buildExistingAccountEmail({
        firstName: existingUser.firstName || firstName,
        loginUrl,
        programName: programName || undefined,
        universityName: universityName || undefined,
      });
      await sendEmail(normalizedEmail, emailContent);

      console.log(`[PUBLIC-APPLY] Existing user ${normalizedEmail}, created application for student #${existingStudent.id}`);
    } else {
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
          await db.insert(documentsTable).values({
            studentId: resultStudentId,
            applicationId: resultAppId,
            name: String(doc.name).replace(/[<>"'&]/g, "_").slice(0, 255),
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
