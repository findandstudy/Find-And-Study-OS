import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import rateLimit from "express-rate-limit";
import { generateSecureToken, buildWelcomeEmail, buildExistingAccountEmail, sendEmail } from "../lib/email";

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

router.post("/public/apply", applyLimiter, async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, phone, phoneCode, nationality, programId, programName, universityName, notes } = req.body;

  if (!firstName || !lastName || !email) {
    res.status(400).json({ error: "firstName, lastName, and email are required" });
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
        passwordResetToken: passwordToken,
        passwordResetExpires: new Date(Date.now() + 48 * 60 * 60 * 1000),
        emailVerificationToken: verificationToken,
        createdFromSource: "public_apply",
      }).returning();


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

      console.log(`[AUTO-ACCOUNT] Created student account for ${normalizedEmail} (user #${newUser.id}) from public apply`);
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
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates
- For diplomas: extract school name, graduation year, GPA, student name
- For transcripts: extract school name, GPA, graduation year, student name
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

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
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
