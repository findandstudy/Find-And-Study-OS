import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../lib/auth";
import { canAccessGenericObject, recordObjectOwner } from "../lib/objectAuthz";
import { checkAndIncrementRateLimit } from "../lib/pgRateLimiter";
import { validateUploadedFile } from "../lib/fileUploadValidation";

const RequestUploadUrlBody = z.object({
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
  prefix: z.string().regex(/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*\/?$/).max(120).optional(),
});

const RequestUploadUrlResponse = z.object({
  uploadURL: z.string(),
  objectPath: z.string(),
  metadata: z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
});

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const UPLOAD_LIMIT = 30;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const allowed = await checkAndIncrementRateLimit(`upload:${userId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
  if (!allowed) {
    res.status(429).json({ error: "Too many upload requests. Try again later." });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType, prefix } = parsed.data;

    // Staff document uploads use STAFF_DOC_RULES (PDF/DOC/DOCX/JPG/PNG, up
    // to 25MB) — admin-only, gated by prefix `staff-documents/{userId}/`.
    // Generic uploads still go through the global validateUploadedFile policy.
    const isStaffDoc = !!prefix && /^staff-documents\/\d+\/?$/.test(prefix);
    if (isStaffDoc) {
      const role = (req.user as { role?: string } | undefined)?.role;
      if (role !== "super_admin" && role !== "admin") {
        res.status(403).json({ error: "Staff document uploads are admin-only" });
        return;
      }
      const STAFF_DOC_MIMES = new Set([
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/png",
      ]);
      const STAFF_DOC_MAX = 25 * 1024 * 1024;
      if (!STAFF_DOC_MIMES.has(contentType)) {
        res.status(400).json({ error: "Unsupported file type for staff documents" });
        return;
      }
      if (size > STAFF_DOC_MAX) {
        res.status(413).json({ error: "Dosya boyutu 25MB sınırını aşıyor." });
        return;
      }
    } else {
      const validationError = validateUploadedFile(name, contentType, size);
      if (validationError) {
        const httpStatus = validationError.type === "size_exceeded" ? 413 : 400;
        res.status(httpStatus).json({ error: validationError.message });
        return;
      }
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(prefix);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Bind the object to its uploader so the generic download endpoint can
    // authorize access without trusting self-writable reference fields.
    await recordObjectOwner(objectPath, userId);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;

    if (filePath.includes("..") || filePath.includes("\\")) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object:", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

    if (wildcardPath.includes("..") || wildcardPath.includes("\\")) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    // Object-level authorization: `requireAuth` alone allowed any logged-in
    // user to fetch any object by key (IDOR). Reuse the access rules of the
    // record that references this object; deny if none grants access.
    const allowed = await canAccessGenericObject(
      { id: req.user!.id, role: (req.user as { role?: string }).role ?? "" },
      wildcardPath,
    );
    if (!allowed) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    const downloadName = req.query.download as string | undefined;
    if (downloadName) {
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving object:", error);
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
