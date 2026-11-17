import { chatAllowed } from "@/lib/chat/web";
import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { detectImage, MAX_IMAGE_BYTES } from "@/lib/vision/detect";
import { classifyImage, discoverImage, classifierReady, discoveryReady } from "@/lib/vision/providers";
import { reserveProviders, finishProviders } from "@/lib/vision/provider-budget";
import type { ImageConsent } from "@/lib/vision/provider-types";
import { googleObservations, geminiVisionReady } from "@/lib/vision/gemini";
import { saveScan } from "@/lib/vision/scans";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES + 100_000;
const FILE_ERRORS: Record<string, number> = { EMPTY_FILE: 422, FILE_TOO_LARGE: 413, UNSUPPORTED_FORMAT: 415, INVALID_IMAGE: 422 };

/** Image type from the file's first bytes, so a generic upload type from the phone does not matter. */
function sniffMime(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "image/jpeg";
}

/** Multipart image verification. Optional Gemini, Sightengine and Cloud Vision processing each
 * require their own per-image consent and a configured provider. Estimates and web occurrences
 * remain separate from signed provenance. No image is hosted publicly.
 */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    const type = request.headers.get("content-type");
    if (!type || !/^multipart\/form-data\s*;/i.test(type) || !request.body) {
      return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE });
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    let file: FormDataEntryValue | null;
    let googleConsent = false;
    let classifierConsent = false;
    let discoveryConsent = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_UPLOAD_BYTES) {
          void reader.cancel().catch(() => undefined);
          return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
        }
        chunks.push(new Uint8Array(value));
      }
      const form = await new Response(new Blob(chunks), { headers: { "Content-Type": type } }).formData();
      for (const field of ["googleConsent", "classifierConsent", "discoveryConsent"]) {
        const values = form.getAll(field);
        if (values.length > 1 || values.some(value => value !== "true" && value !== "false")) {
          return Response.json({ error: "INVALID_CONSENT" }, { status: 400, headers: NO_STORE });
        }
      }
      googleConsent = form.get("googleConsent") === "true";
      classifierConsent = form.get("classifierConsent") === "true";
      discoveryConsent = form.get("discoveryConsent") === "true";
      if (form.getAll("file").length !== 1) return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE });
      file = form.get("file");
    } catch {
      return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE });
    } finally { reader.releaseLock(); }
    if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400, headers: NO_STORE });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    let providerRequestId: string | undefined;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Validate the actual image before any optional external processing.
      const detection = await detectImage(bytes);
      const consent: ImageConsent = { googleGemini: googleConsent, sightengine: classifierConsent, googleVision: discoveryConsent };
      if ((googleConsent && geminiVisionReady()) || (classifierConsent && classifierReady()) || (discoveryConsent && discoveryReady())) {
        const lease = await reserveProviders(owner, consent);
        if (!lease) return Response.json({ error: "IMAGE_PROVIDER_LIMIT" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "90" } });
        providerRequestId = lease;
      }
      const [google, classification, discovery] = await Promise.all([
        googleConsent ? googleObservations(bytes, sniffMime(bytes), true)
          : Promise.resolve({ status: "skipped" as const, reason: "Not sent to Google: no consent for this image." }),
        classifyImage(bytes, sniffMime(bytes), classifierConsent),
        discoverImage(bytes, discoveryConsent),
      ]);
      Object.assign(detection.verification, { evidenceVersion: 2, consent, providerRequestId, google, classification, discovery });
      const scan = await saveScan(owner, detection);
      if (providerRequestId) await finishProviders(providerRequestId, scan.scanId);
      return Response.json({ data: scan }, { headers: NO_STORE });
    } catch (error) {
      if (providerRequestId) await finishProviders(providerRequestId).catch(() => undefined);
      const status = FILE_ERRORS[(error as Error).message];
      if (status) return Response.json({ error: (error as Error).message }, { status, headers: NO_STORE });
      throw error;
    }
  });
}
