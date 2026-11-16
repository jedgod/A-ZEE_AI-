import { api } from "./api";
import { PickerMissingError } from "./docs";
import { appendFile } from "./upload";
import type { AiDetectionResult } from "@/components/ai-detection-card";

export type PickedImage = { uri: string; name: string; mime: string };

/**
 * Lets the user choose a photo or screenshot (from the gallery, Files, Google Drive and other providers the system picker
 * offers). Resolves null if the user cancels. Uses the document-picker module, loaded lazily so an older build still starts.
 */
export async function pickImage(): Promise<PickedImage | null> {
  const missing = () => new PickerMissingError("Picking photos needs the latest version of the app. Rebuild it and try again.");
  let picker: typeof import("expo-document-picker");
  try { picker = require("expo-document-picker"); } catch { throw missing(); }
  if (typeof picker?.getDocumentAsync !== "function") throw missing();

  let result: Awaited<ReturnType<typeof picker.getDocumentAsync>>;
  try { result = await picker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true, multiple: false }); }
  catch (e) { if (/native module|ExpoDocumentPicker/i.test((e as Error).message)) throw missing(); throw e; }
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return null;
  return { uri: asset.uri, name: asset.name || "image.jpg", mime: asset.mimeType || "image/jpeg" };
}

/**
 * Sends an image file on the phone (picked, shared in from another app, or just taken with the camera) to A-Zee. The server checks the
 * image bytes privately, so a generic content type is fine. Nothing is sent to outside services.
 */
export async function scanImageFile(file: PickedImage | { uri: string; name?: string; mime?: string }): Promise<AiDetectionResult> {
  const form = new FormData();
  await appendFile(form, "file", { uri: file.uri, name: file.name ?? "image.jpg", type: file.mime ?? "image/jpeg" });
  const scan = await api<AiDetectionResult>("/api/vision/detect-ai", { method: "POST", body: form });
  return { ...scan, previewUrl: file.uri }; // the server does not keep the image, so the preview is the local copy
}
