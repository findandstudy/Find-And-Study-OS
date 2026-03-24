import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, leadsTable, usersTable, studentsTable, applicationsTable, programsTable, universitiesTable, commissionsTable, serviceFeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAnthropicClient, getClaudeConfig } from "@workspace/integrations-anthropic-ai";
import rateLimit from "express-rate-limit";
import { generateSecureToken, buildWelcomeEmail, buildExistingAccountEmail, sendEmail } from "../lib/email";
import { getCommissionFinanceStatus, getServiceFeeFinanceStatus } from "../lib/stageFinance";
import { resolveAgentCommission } from "../lib/agentCommission";

const router: IRouter = Router();

const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many applications. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const aiExtractLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many AI extraction requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

async function createApplicationForStudent(studentId: number, programId: number | null, programName: string | null, universityName: string | null) {
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

    const commFinStatus = getCommissionFinanceStatus(stage);
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

    const sfFinStatus = getServiceFeeFinanceStatus(stage);
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

    console.log(`[AUTO-APPLICATION] Created application #${app.id} for student #${studentId}, program: ${snapshotProgramName}`);
    return app.id;
  } catch (err) {
    console.error("[AUTO-APPLICATION] Error creating application:", err);
    return null;
  }
}

router.post("/public/apply", applyLimiter, async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, phone, phoneCode, nationality, programId, programName, universityName, notes, motherName, fatherName } = req.body;

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

  const [lead] = await db.insert(leadsTable).values({
    firstName: s(firstName, 100)!,
    lastName: s(lastName, 100)!,
    email: s(normalizedEmail, 255),
    phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
    nationality: s(nationality, 100),
    source: "website",
    status: "new",
    interestedProgram: s(programName, 255),
    interestedCountry: null,
    notes: [
      universityName ? `University: ${universityName}` : null,
      programId ? `Program ID: ${programId}` : null,
      notes ? notes : null,
    ].filter(Boolean).join("\n") || null,
  }).returning();

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000";
  const loginUrl = `${baseUrl}/login`;

  try {
    const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    if (existingUser) {
      let [existingStudent] = await db.select().from(studentsTable).where(eq(studentsTable.userId, existingUser.id));
      if (!existingStudent) {
        [existingStudent] = await db.insert(studentsTable).values({
          userId: existingUser.id,
          firstName: existingUser.firstName || firstName,
          lastName: existingUser.lastName || lastName,
          email: normalizedEmail,
          phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
          motherName: s(motherName, 100),
          fatherName: s(fatherName, 100),
        }).returning();
      }
      await db.update(leadsTable).set({ convertedStudentId: existingStudent.id }).where(eq(leadsTable.id, lead.id));

      await createApplicationForStudent(existingStudent.id, programId ? parseInt(String(programId), 10) : null, programName, universityName);

      const emailContent = buildExistingAccountEmail({
        firstName: existingUser.firstName || firstName,
        loginUrl,
        programName: programName || undefined,
        universityName: universityName || undefined,
      });
      await sendEmail(normalizedEmail, emailContent);
    } else {
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

      const [newStudent] = await db.insert(studentsTable).values({
        userId: newUser.id,
        firstName: s(firstName, 100)!,
        lastName: s(lastName, 100)!,
        email: normalizedEmail,
        phone: phone ? `${phoneCode || ""}${phone}`.slice(0, 50) : null,
        nationality: nationality || null,
        motherName: s(motherName, 100),
        fatherName: s(fatherName, 100),
      }).returning();

      await db.update(leadsTable).set({ convertedStudentId: newStudent.id }).where(eq(leadsTable.id, lead.id));

      await createApplicationForStudent(newStudent.id, programId ? parseInt(String(programId), 10) : null, programName, universityName);

      const setPasswordUrl = `${baseUrl}/login?token=${passwordToken}`;
      const verifyEmailUrl = `${baseUrl}/api/auth/verify-email-token/${verificationToken}`;

      const emailContent = buildWelcomeEmail({
        firstName: s(firstName, 100) || "Student",
        email: normalizedEmail,
        setPasswordUrl,
        verifyEmailUrl,
        loginUrl,
        programName: programName || undefined,
        universityName: universityName || undefined,
      });
      await sendEmail(normalizedEmail, emailContent);

      console.log(`[AUTO-ACCOUNT] Created student account for ${normalizedEmail} (user #${newUser.id}, student #${newStudent.id}) from public apply`);
    }
    res.status(201).json({ success: true, leadId: lead.id });
  } catch (err) {
    console.error("[AUTO-ACCOUNT] Error during auto account creation:", err);
    res.status(201).json({ success: true, leadId: lead.id, accountSetupPending: true });
  }
});

const EXTRACT_PROMPT = `You are an expert document analysis system for an education consultancy. 
Analyze the provided document image(s) and extract student information.

Extract ALL of the following fields if visible in the document. Return a JSON object with these exact keys:
{
  "firstName": "string or null",
  "lastName": "string or null",
  "dateOfBirth": "YYYY-MM-DD format or null",
  "nationality": "string or null",
  "passportNumber": "string or null",
  "passportIssueDate": "YYYY-MM-DD format or null",
  "passportExpiry": "YYYY-MM-DD format or null",
  "motherName": "string or null",
  "fatherName": "string or null",
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
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates, mother name, father name (often listed on passport identity pages)
- For diplomas: extract school name, graduation year, GPA, student name, parent names if visible
- For transcripts: extract school name, GPA, graduation year, student name
- For photographs: note that a photo document was received
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

    res.json({ extracted });
  } catch (err: any) {
    console.error("Public AI extraction error:", err);
    res.status(500).json({ error: "AI extraction failed. Please try again." });
  }
});

export default router;
