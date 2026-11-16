import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fingerprint(bytes: Uint8Array, includeLocal = false) {
  if (!bytes.length) throw new Error("EMPTY_FILE");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("FILE_TOO_LARGE");
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: "warning" });
    const { format, pages, width, height, orientation } = await image.metadata();
    if (pages && pages > 1) throw new Error("UNSUPPORTED_FORMAT");
    if (format !== "jpeg" && format !== "png" && format !== "webp") throw new Error("UNSUPPORTED_FORMAT");
    if (!width || !height || width * height > 24_000_000) throw new Error("INVALID_IMAGE");
    const ratio = orientation && orientation >= 5 ? height / width : width / height;
    const pixels = await image.clone().autoOrient().flatten({ background: "#fff" })
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
    const local = includeLocal ? await image.clone().autoOrient().flatten({ background: "#fff" })
      .resize(256, 256, { fit: "inside" }).greyscale().raw().toBuffer({ resolveWithObject: true }) : undefined;
    return {
      featuresV1: local && localFeatures(local.data, local.info.width, local.info.height),
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

// A compact signature of textured points at three scales. The bytes are versioned
// separately from the whole-image fingerprint so older snapshots still load.
export const FEATURE_BYTES = 11;
export const MAX_FEATURES = 96;
export const MAX_INDEX_BYTES = 32_000_000;
const RADII = [8, 11, 16] as const;

function comparisonPairs() {
  let state = 148153;
  const coordinate = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 24) % 13 - 6;
  };
  const pairs: number[][] = [];
  while (pairs.length < 64) {
    const pair = [coordinate(), coordinate(), coordinate(), coordinate()];
    if (Math.hypot(pair[0] - pair[2], pair[1] - pair[3]) >= 4) pairs.push(pair);
  }
  return pairs;
}

const PAIRS = comparisonPairs();

export function localFeatures(pixels: Buffer, width: number, height: number): string | undefined {
  if (Math.min(width, height) < 36) return;
  const output = Buffer.alloc(MAX_FEATURES * FEATURE_BYTES);
  let count = 0;
  for (const [scale, radius] of RADII.entries()) {
    const grid: { x: number; y: number; score: number }[][] = Array.from({ length: 16 }, () => []);
    for (let y = radius + 1; y < height - radius - 1; y += 2) {
      for (let x = radius + 1; x < width - radius - 1; x += 2) {
        let xx = 0, yy = 0, xy = 0;
        const stride = scale + 1;
        for (let dy = -stride; dy <= stride; dy += stride) {
          for (let dx = -stride; dx <= stride; dx += stride) {
            const at = (y + dy) * width + x + dx;
            const gx = pixels[at + 1] - pixels[at - 1];
            const gy = pixels[at + width] - pixels[at - width];
            xx += gx * gx; yy += gy * gy; xy += gx * gy;
          }
        }
        const score = (xx * yy - xy * xy) / (xx + yy + 1);
        if (score >= 230) grid[Math.floor(y * 4 / height) * 4 + Math.floor(x * 4 / width)].push({ x, y, score });
      }
    }
    for (const cell of grid) {
      cell.sort((a, b) => b.score - a.score);
      const accepted: typeof cell = [];
      for (const point of cell) {
        const { x, y } = point;
        if (accepted.some(p => Math.hypot(p.x - x, p.y - y) < radius)) continue;
        const offset = count * FEATURE_BYTES;
        let ones = 0, informative = 0;
        output.fill(0, offset, offset + FEATURE_BYTES);
        const stride = radius / 6;
        const sample = (dx: number, dy: number) => {
          const at = (y + Math.round(dy * stride)) * width + x + Math.round(dx * stride);
          return pixels[at] * 2 + pixels[at - 1] + pixels[at + 1] + pixels[at - width] + pixels[at + width];
        };
        for (const [i, [ax, ay, bx, by]] of PAIRS.entries()) {
          const delta = sample(ax, ay) - sample(bx, by);
          if (delta > 0) { output[offset + 3 + (i >>> 3)] |= 1 << (i & 7); ones++; }
          if (Math.abs(delta) >= 60) informative++;
        }
        if (informative < 24 || ones < 12 || ones > 52) continue;
        accepted.push(point);
        output[offset] = x;
        output[offset + 1] = y;
        output[offset + 2] = scale;
        count++;
        if (accepted.length === 2) break;
      }
    }
  }
  if (count >= 6) return output.subarray(0, count * FEATURE_BYTES).toString("base64");
}

export function isLocalFeatures(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_FEATURES * 16 || !/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 6 * FEATURE_BYTES || bytes.length % FEATURE_BYTES || bytes.length > MAX_FEATURES * FEATURE_BYTES) return false;
  for (let i = 2; i < bytes.length; i += FEATURE_BYTES) if (bytes[i] >= RADII.length) return false;
  return bytes.toString("base64") === value;
}
