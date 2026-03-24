import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../lib/auth";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

const aiRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function aiRateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `ai:${(req as any).user?.id || req.ip}`;
    const now = Date.now();
    const entry = aiRateLimitMap.get(key);
    if (!entry || now > entry.resetAt) {
      aiRateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
    entry.count++;
    next();
  };
}

const EXTRACT_PROMPT = `You are an expert document analysis system for an education consultancy. 
Analyze the provided document image(s) and extract student information.

Extract ALL of the following fields if visible in the document. Return a JSON object with these exact keys:
{
  "firstName": "string or null",
  "lastName": "string or null",
  "dateOfBirth": "YYYY-MM-DD format or null",
  "nationality": "full country name string (e.g. 'Afghanistan' not 'Afghan', 'Turkey' not 'Turkish') or null",
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
  "documentType": "passport|diploma|transcript|photo|other",
  "confidence": "high|medium|low",
  "extractedNotes": "any additional relevant notes found in the document"
}

Rules:
- For passport documents: extract all passport fields, name, DOB, nationality, issue/expiry dates, mother name, father name (often listed on passport identity pages)
- For diplomas: extract school name, graduation year, GPA, student name, parent names if visible
- For transcripts: extract school name, GPA, graduation year, student name, courses if relevant
- For photos: only set confidence to "low", documentType to "photo", everything else null
- For nationality: always return the full official country name (e.g. "Afghanistan" not "Afghan", "Turkey" not "Turkish", "Iran" not "Iranian", "Pakistan" not "Pakistani", "India" not "Indian"). Convert any nationality adjective or demonym to the country name.
- Always normalize dates to YYYY-MM-DD format
- Return ONLY the JSON object, no other text
- Set null for fields you cannot find or are not sure about`;

router.post("/ai/extract-document", requireAuth, aiRateLimit(10, 15 * 60 * 1000), async (req, res): Promise<void> => {
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
      max_tokens: 8192,
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
    console.error("AI extraction error:", err);
    res.status(500).json({ error: "AI extraction failed" });
  }
});

router.post("/ai/extract-bulk-csv", requireAuth, aiRateLimit(5, 15 * 60 * 1000), async (req, res): Promise<void> => {
  try {
    const { csvData } = req.body as { csvData: string };
    if (!csvData) {
      res.status(400).json({ error: "No CSV data provided" });
      return;
    }

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `Parse this CSV data and extract student records. Return a JSON array of student objects with keys: firstName, lastName, email, phone, nationality, dateOfBirth, passportNumber, highSchool, graduationYear, gpa, languageScore, motherName, fatherName, passportExpiry, passportIssueDate, address, notes.
        
Map any reasonable column name variations (e.g. "first name", "First Name", "firstname" all map to firstName).
Return ONLY the JSON array, no explanation.
Set null for missing values.

CSV:
${csvData.slice(0, 10000)}`,
      }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    let students: any[] = [];
    try {
      const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        students = JSON.parse(jsonMatch[0]);
      }
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    res.json({ students });
  } catch (err: any) {
    console.error("CSV parse error:", err);
    res.status(500).json({ error: "CSV parsing failed" });
  }
});

export default router;
