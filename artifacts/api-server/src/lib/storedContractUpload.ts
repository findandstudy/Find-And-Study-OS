import { ObjectStorageService } from "./objectStorage";
import { callerOwnsObject, canonicalizeKey } from "./objectAuthz";
import { validateUploadedFileBuffer } from "./fileUploadValidation";

const storage = new ObjectStorageService();
const MIME_TO_NAME: Record<string, string> = {
  "application/pdf": "contract.pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "contract.docx",
  "application/msword": "contract.doc",
};

export type PreparedStoredContract = {
  objectPath: string;
  bytes: Buffer;
  contentType: string;
};

export async function prepareOwnedStoredContract(
  actorUserId: number,
  objectPath: string,
): Promise<PreparedStoredContract> {
  const objectKey = canonicalizeKey(objectPath);
  if (!objectKey) throw new Error("CONTRACT_UPLOAD_INVALID_PATH");
  if (!(await callerOwnsObject(actorUserId, objectPath))) {
    throw new Error("CONTRACT_UPLOAD_NOT_OWNED");
  }
  const file = await storage.getObjectEntityFile(`/objects/${objectKey}`);
  const [metadata] = await file.getMetadata();
  const contentType = String(metadata.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  const fileName = MIME_TO_NAME[contentType];
  if (!fileName) throw new Error("CONTRACT_UPLOAD_UNSUPPORTED_TYPE");
  const [bytes] = await file.download();
  if (bytes.length <= 0 || bytes.length > 25 * 1024 * 1024) {
    throw new Error("CONTRACT_UPLOAD_INVALID_SIZE");
  }
  if (await validateUploadedFileBuffer(fileName, contentType, bytes)) {
    throw new Error("CONTRACT_UPLOAD_SIGNATURE_MISMATCH");
  }
  return { objectPath, bytes, contentType };
}
