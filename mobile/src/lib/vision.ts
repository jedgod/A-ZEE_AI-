import { api } from "./api";
import { PickerMissingError } from "./docs";
import type { AiDetectionResult } from "@/components/ai-detection-card";

/**
 * Lets the user choose a photo or screenshot (from the gallery, Files, Google Drive, iCloud Drive and other
 * providers the system picker offers), sends it to the server to check for signs of AI generation, and
 * returns the result with a local preview. Resolves null if the user cancels.
 * Uses the same document-picker module as Docs Analysis, loaded lazily so an older build still starts.
 */
export async function pickAndScanImage(): Promise<AiDetectionResult | null> {
  const missing = () => new PickerMissingError("Picking photos needs the latest version of the app. Rebuild it and try again.");
  let picker: typeof import("expo-document-picker");
  try { picker = require("expo-document-picker"); } catch { throw missing(); }
  if (typeof picker?.getDocumentAsync !== "function") throw missing();

  let result: Awaited<ReturnType<typeof picker.getDocumentAsync>>;
  try { result = await picker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true, multiple: false }); }
  catch (e) { if (/native module|ExpoDocumentPicker/i.test((e as Error).message)) throw missing(); throw e; }
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return null;

  const form = new FormData();
  form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType || "image/jpeg" } as unknown as Blob);
  const scan = await api<AiDetectionResult>("/api/vision/detect-ai", { method: "POST", body: form });
  return { ...scan, previewUrl: asset.uri }; // the server does not keep the image, so the preview is the local copy
}

/** Sends a photo file already on the phone (for example one just taken with the camera) to the checker. */
export async function scanImageFile(uri: string, name = "photo.jpg", mime = "image/jpeg"): Promise<AiDetectionResult> {
  const form = new FormData();
  form.append("file", { uri, name, type: mime } as unknown as Blob);
  const scan = await api<AiDetectionResult>("/api/vision/detect-ai", { method: "POST", body: form });
  return { ...scan, previewUrl: uri };
}
