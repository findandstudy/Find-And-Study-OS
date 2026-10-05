import { createHash } from "node:crypto";
import sharp from "sharp";

const MAX_BRANDING_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_BRANDING_SOURCE_PIXELS = 16_000_000;
const MAX_HEADER_LOGO_BYTES = 256 * 1024;

export type HeaderLogoDerivative = {
  bytes: Buffer;
  contentType: "image/webp";
  etag: string;
};

export async function createHeaderLogoDerivative(source: Buffer): Promise<HeaderLogoDerivative> {
  if (source.length <= 0 || source.length > MAX_BRANDING_SOURCE_BYTES) {
    throw new Error("BRANDING_LOGO_SOURCE_SIZE_INVALID");
  }
  const bytes = await sharp(source, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_BRANDING_SOURCE_PIXELS,
  })
    .rotate()
    .resize({
      width: 360,
      height: 80,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4, smartSubsample: true })
    .toBuffer();
  if (bytes.length <= 0 || bytes.length > MAX_HEADER_LOGO_BYTES) {
    throw new Error("BRANDING_LOGO_DERIVATIVE_SIZE_INVALID");
  }
  return {
    bytes,
    contentType: "image/webp",
    etag: `"header-${createHash("sha256").update(bytes).digest("hex")}"`,
  };
}
