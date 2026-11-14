import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";

// AI-image check. Layer 1 reads the file's own metadata (EXIF, XMP/IPTC, C2PA content credentials) on this
// server; nothing leaves it. Layer 2 is an optional outside pixel classifier (Sightengine), used only when its
// keys are set and AZ_PROVIDER_MODE is not "ollama-only". Metadata can be stripped or faked, so the result is
// evidence, never proof: with no signals the verdict is INCONCLUSIVE, not "real".

export type Verdict = "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };
export type Detection = { verdict: Verdict; confidence: number; pixelScores: PixelScores | null; likelySource: string; signals: string[] };

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const GENERATORS: [RegExp, string][] = [
  [/midjourney/i, "Midjourney"], [/dall[-· ]?e|openai/i, "DALL·E / OpenAI"], [/stable[ -]?diffusion|stability\.ai|automatic1111|comfyui|invokeai/i, "Stable Diffusion"],
  [/firefly/i, "Adobe Firefly"], [/\bflux\b|black forest labs/i, "Flux"], [/leonardo\.?ai/i, "Leonardo.Ai"], [/ideogram/i, "Ideogram"],
  [/imagen|gemini|google ai/i, "Google Imagen / Gemini"], [/grok|xai\b/i, "Grok Imagine"], [/bing image creator|designer/i, "Microsoft Designer"],
];
const AI_SOURCE_TYPE = /(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia)/i;

export type Meta = Record<string, unknown> | null;

const text = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(text).join(" ") : v == null ? "" : typeof v === "object" ? "" : String(v));

/** Evidence from metadata and embedded content credentials. `raw` is a text view of the file's header bytes. */
export function analyzeMetadata(meta: Meta, raw = ""): Detection {
  const signals: string[] = [];
  let ai = 0, source = "";
  const m = meta ?? {};
  const software = [text(m.Software), text(m.CreatorTool), text(m.ProcessingSoftware), text(m.Description), text(m.UserComment), text(m.ImageDescription), text(m.Credit), text(m.Source)].join(" ");

  if (AI_SOURCE_TYPE.test(text(m.DigitalSourceType) + " " + raw)) { ai = Math.max(ai, 95); signals.push("The file declares it was made by generative AI (IPTC digital source type \"trained algorithmic media\")."); }
  for (const [re, name] of GENERATORS) if (re.test(software)) { ai = Math.max(ai, 90); source = source || name; signals.push(`The metadata names an AI tool: ${name}.`); break; }
  const c2pa = /c2pa|jumbf|contentcredentials/i.test(raw);
  if (c2pa) signals.push("The file carries C2PA content credentials, which record how it was made or edited.");
  if (c2pa && ai) ai = Math.max(ai, 95);

  const camera = [text(m.Make), text(m.Model)].filter(Boolean).join(" ").trim();
  const exposure = [m.ExposureTime, m.FNumber, m.ISO, m.FocalLength].filter(v => v != null).length;
  if (!ai && camera && exposure >= 2) {
    signals.push(`Camera details are present (${camera}) with exposure settings, which is typical of a real photo.`);
    signals.push("Metadata can be copied or edited, so this is supporting evidence only.");
    return { verdict: "LIKELY_REAL", confidence: 70, pixelScores: null, likelySource: camera, signals };
  }
  if (ai) return { verdict: "AI_GENERATED", confidence: ai, pixelScores: null, likelySource: source || "AI image generator (unnamed)", signals };
  signals.push(meta ? "No camera or AI-tool details were found in the metadata." : "The file has no metadata. AI images and photos re-shared on social apps are both often stripped like this.");
  return { verdict: "INCONCLUSIVE", confidence: 50, pixelScores: null, likelySource: "Unknown", signals };
}

/** Outside pixel classifier. Returns null when not configured, disabled by privacy mode, or it fails. */
export async function pixelClassifier(bytes: Uint8Array, fileName: string, mimeType: string, fetchImpl: typeof fetch = fetch): Promise<PixelScores | null> {
  const user = process.env.SIGHTENGINE_API_USER, secret = process.env.SIGHTENGINE_API_SECRET;
  if (!user || !secret || ollamaOnly()) return null;
  try {
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(bytes)], { type: mimeType || "image/jpeg" }), fileName);
    form.append("models", "genai,deepfake");
    form.append("api_user", user);
    form.append("api_secret", secret);
    const res = await fetchImpl("https://api.sightengine.com/1.0/check.json", { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = await res.json() as { type?: { ai_generated?: number; deepfake?: number } };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v * 100))) : 0);
    return { aiGeneratedScore: n(data.type?.ai_generated), deepfakeScore: n(data.type?.deepfake) };
  } catch { return null; }
}

/** Merges metadata evidence with pixel scores: strong AI metadata stands; otherwise the pixel scores decide. */
export function combine(base: Detection, pixels: PixelScores | null): Detection {
  if (!pixels) return base;
  const top = Math.max(pixels.aiGeneratedScore, pixels.deepfakeScore);
  const signals = [...base.signals, `Pixel-level classifier: ${pixels.aiGeneratedScore}% generated by AI, ${pixels.deepfakeScore}% face deepfake.`];
  if (base.verdict === "AI_GENERATED") return { ...base, confidence: Math.max(base.confidence, top), pixelScores: pixels, signals };
  if (top >= 70) return { ...base, verdict: "AI_GENERATED", confidence: top, pixelScores: pixels, likelySource: base.likelySource === "Unknown" ? "AI image generator (unnamed)" : base.likelySource, signals };
  if (top <= 20) return { ...base, verdict: "LIKELY_REAL", confidence: 100 - top, pixelScores: pixels, signals };
  return { ...base, verdict: "INCONCLUSIVE", confidence: Math.max(40, 100 - Math.abs(50 - top) * 2), pixelScores: pixels, signals };
}

/** Full check on an uploaded image. */
export async function detectImage(bytes: Uint8Array, fileName: string, mimeType: string, fetchImpl?: typeof fetch): Promise<Detection> {
  if (!bytes.byteLength) throw new Error("EMPTY_FILE");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("FILE_TOO_LARGE");
  if (!/^image\//.test(mimeType) && !/\.(jpe?g|png|webp|heic|heif|avif|gif|tiff?)$/i.test(fileName)) throw new Error("UNSUPPORTED_FORMAT");
  let meta: Meta = null;
  try { meta = (await (await import("exifr")).default.parse(Buffer.from(bytes), { xmp: true, iptc: true, exif: true, tiff: true, mergeOutput: true })) ?? null; } catch { /* no readable metadata */ }
  // Content credentials and some XMP live in the header region; a latin1 view of it is enough to spot the markers.
  const raw = Buffer.from(bytes.subarray(0, 262_144)).toString("latin1");
  return combine(analyzeMetadata(meta, raw), await pixelClassifier(bytes, fileName, mimeType, fetchImpl));
}
