import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fingerprint(bytes: Uint8Array) {
  if (!bytes.length) throw new Error("EMPTY_FILE");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("FILE_TOO_LARGE");
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning" });
    const { format, pages, width, height, orientation } = await image.metadata();
    if (pages && pages > 1) throw new Error("UNSUPPORTED_FORMAT");
    if (format !== "jpeg" && format !== "png" && format !== "webp") throw new Error("UNSUPPORTED_FORMAT");
    if (!width || !height || width * height > 24_000_000) throw new Error("INVALID_IMAGE");
    const ratio = orientation && orientation >= 5 ? height / width : width / height;
    const pixels = await image.autoOrient().flatten({ background: "#fff" })
      .resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
    let hash = 0n;
    let edges = 0;
    for (let row = 0; row < 8; row++) {
      for (let x = 0; x < 8; x++) {
        const i = row * 9 + x;
        hash = (hash << 1n) | BigInt(pixels[i] > pixels[i + 1]);
        if (Math.abs(pixels[i] - pixels[i + 1]) >= 8) edges++;
      }
    }
    return {
      ratio,
      mime: `image/${format}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      // Low-detail images often share the same perceptual fingerprint.
      dhash: edges >= 12 ? hash.toString(16).padStart(16, "0") : null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "UNSUPPORTED_FORMAT") throw error;
    throw new Error("INVALID_IMAGE");
  }
}

export function distance(a: string, b: string) {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  return count;
}
