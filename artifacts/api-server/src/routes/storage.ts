import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../lib/auth";
import { canAccessGenericObject, recordObjectOwner } from "../lib/objectAuthz";
import { checkAndIncrementRateLimit } from "../lib/pgRateLimiter";
import { validateUploadedFile } from "../lib/fileUploadValidation";
import { processUpload, UploadTooLargeError } from "../lib/uploads/processUpload";

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

// ── Local-driver upload handler ───────────────────────────────────────────────
// Only active when STORAGE_DRIVER=local. The client PUTs file bytes directly
// to this endpoint (same contract as a GCS signed-URL PUT). The :encoded
// segment is the base64url of the relative path inside STORAGE_LOCAL_DIR.

router.put("/storage/local-upload/:encoded", requireAuth, async (req: Request, res: Response) => {
  if ((process.env.STORAGE_DRIVER ?? "replit") !== "local") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const rawEncoded = req.params["encoded"];
  const encoded = Array.isArray(rawEncoded) ? rawEncoded[0] : rawEncoded;
  let relPath: string;
  try {
    relPath = Buffer.from(encoded, "base64url").toString();
  } catch {
    res.status(400).json({ error: "Invalid upload token" });
    return;
  }

  if (relPath.includes("..") || relPath.includes("\\") || relPath.startsWith("/")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const localDir = process.env.STORAGE_LOCAL_DIR ?? "";
  if (!localDir) {
    res.status(500).json({ error: "STORAGE_LOCAL_DIR not configured" });
    return;
  }

  const localPath = nodePath.join(localDir, relPath);

  // Guard against path traversal after join
  if (!localPath.startsWith(localDir + nodePath.sep) && localPath !== localDir) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  try {
    await fsPromises.mkdir(nodePath.dirname(localPath), { recursive: true });

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const rawBody = Buffer.concat(chunks);
    const contentType = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim();

    // Single chokepoint: any file above the portal-ready target is
    // compressed here before it ever touches disk, so everything downstream
    // (portal adapters, /api/documents/:id/file) sees an already-small file.
    let body: Buffer = rawBody;
    let finalContentType = contentType;
    try {
      const processed = await processUpload(rawBody, nodePath.basename(relPath), contentType);
      body = Buffer.from(processed.buffer);
      finalContentType = processed.mime;
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        res.status(413).json({ error: err.message });
        return;
      }
      console.error("[local-upload] processUpload failed, storing original:", err);
    }

    await fsPromises.writeFile(localPath, body);
    await fsPromises.writeFile(`${localPath}.ct`, finalContentType);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[local-upload] write failed:", error);
    res.status(500).json({ error: "Failed to store file" });
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
      const nodeStream = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
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

    // Branding assets (branding/ prefix) are tenant-wide shared objects written
    // only by admins. Any authenticated user may access them without a per-object
    // IDOR check. All other objects still go through the full IDOR guard.
    const isBrandingAsset = wildcardPath.startsWith("branding/") || wildcardPath.startsWith("logo/");
    if (!isBrandingAsset) {
      const allowed = await canAccessGenericObject(
        { id: req.user!.id, role: (req.user as { role?: string }).role ?? "" },
        wildcardPath,
      );
      if (!allowed) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
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
      const nodeStream = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
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
