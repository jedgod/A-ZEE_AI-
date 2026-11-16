import "server-only";
import { Context, Reader } from "@contentauth/c2pa-node";
import { fingerprint } from "./fingerprint";
import { lookupMatches } from "./matches";

export { MAX_IMAGE_BYTES } from "./fingerprint";

// Keep the existing result shape for installed clients.
export type Verdict = "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };
type Credential = "trusted_ai_creation" | "trusted_other" | "untrusted" | "invalid" | "absent" | "unavailable";
export type Verification = {
  credential: Credential;
  publicIndex: Awaited<ReturnType<typeof lookupMatches>>;
};
export type Detection = {
  verdict: Verdict;
  confidence: number;
  pixelScores: PixelScores | null;
  likelySource: string;
  signals: string[];
  verification: Verification;
};

const AI_CREATION = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export function assessManifest(state: unknown, assertions: readonly { label: string; data: unknown }[]): Credential {
  if (state === "Invalid") return "invalid";
  if (state !== "Trusted") return "untrusted";
  const ai = assertions.some(({ label, data }) => {
    if (!/^c2pa\.actions(?:\.v2)?$/.test(label) || !data || typeof data !== "object") return false;
    const actions = (data as { actions?: unknown }).actions;
    return Array.isArray(actions) && actions.some(a => a?.action === "c2pa.created" && a?.digitalSourceType === AI_CREATION);
  });
  return ai ? "trusted_ai_creation" : "trusted_other";
}

async function verifyCredentials(bytes: Uint8Array, mimeType: string): Promise<Credential> {
  try {
    const context = new Context({ verify: {
      verifyAfterReading: true, verifyTrust: true, verifyTimestampTrust: true,
      remoteManifestFetch: false, ocspFetch: false,
    } });
    const reader = await Reader.fromAsset({ buffer: Buffer.from(bytes), mimeType }, context);
    if (!reader) return "absent";
    const active = reader.getActive();
    if (!reader.isEmbedded() || !active) return "untrusted";
    return assessManifest(reader.json().validation_state, active.assertions ?? []);
  } catch {
    return "unavailable";
  }
}

const CREDENTIAL_NOTES: Record<Credential, string> = {
  trusted_ai_creation: "A trusted, signed credential for this image declares AI generation.",
  trusted_other: "A trusted credential was verified. Its active claim does not declare full AI generation.",
  untrusted: "Credentials were found, but their trust could not be established.",
  invalid: "The embedded credentials failed validation.",
  absent: "No embedded Content Credentials were found. Sharing or editing can remove them.",
  unavailable: "The embedded credential check could not be completed.",
};

export function buildDetection(verification: Verification, metadataHint: boolean): Detection {
  const declaredAI = verification.credential === "trusted_ai_creation";
  const signals = [CREDENTIAL_NOTES[verification.credential]];
  if (metadataHint) signals.push("Unsigned metadata mentions AI-related processing. This is a clue only.");
  signals.push("No pixel classifier was used.");
  return {
    verdict: declaredAI ? "AI_GENERATED" : "INCONCLUSIVE",
    // Compatibility with existing database and API clients. Neither number is a probability.
    confidence: declaredAI ? 100 : 0,
    pixelScores: null,
    likelySource: declaredAI ? "Signed AI creation claim" : "Unknown",
    signals,
    verification,
  };
}

/** Validate the actual image bytes, then check original provenance and public copies independently. */
export async function detectImage(bytes: Uint8Array): Promise<Detection> {
  const query = await fingerprint(bytes, process.env.AZ_IMAGE_CROP_MATCH === "1" && !!process.env.AZ_IMAGE_INDEX_FILE);
  const [credential, publicIndex, metadataHint] = await Promise.all([
    verifyCredentials(bytes, query.mime),
    lookupMatches(query),
    (async () => {
      try {
        const meta = await (await import("exifr")).default.parse(Buffer.from(bytes), { xmp: true, iptc: true });
        return [meta?.DigitalSourceType, meta?.Software, meta?.CreatorTool].some(value =>
          typeof value === "string" && /trainedAlgorithmicMedia|midjourney|stable diffusion|dall[- ]?e|firefly|comfyui/i.test(value));
      } catch { return false; }
    })(),
  ]);
  return buildDetection({ credential, publicIndex }, metadataHint);
}
