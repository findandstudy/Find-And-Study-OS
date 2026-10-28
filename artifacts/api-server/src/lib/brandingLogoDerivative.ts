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

export async function isEffectivelyBlankBrandingImage(source: Buffer): Promise<boolean> {
  if (source.length <= 0 || source.length > MAX_BRANDING_SOURCE_BYTES) return true;
  const { data, info } = await sharp(source, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_BRANDING_SOURCE_PIXELS,
  })
    .rotate()
    .ensureAlpha()
    .resize({ width: 64, height: 64, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let meaningfulPixels = 0;
  const totalPixels = info.width * info.height;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3] ?? 255;
    if (alpha < 24) continue;
    const distanceFromWhite = (255 - data[offset]) + (255 - data[offset + 1]) + (255 - data[offset + 2]);
    if (distanceFromWhite >= 36) meaningfulPixels += 1;
  }
  return meaningfulPixels < Math.max(8, Math.ceil(totalPixels * 0.005));
}

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
