import { api } from "./api";
import { PickerMissingError } from "./docs";

export type SourceClip = { videoUrl: string; fileName: string };

const TYPES = ["video/mp4", "video/quicktime", "video/webm"];

/**
 * Lets the user choose a video clip (MP4, MOV or WebM, up to 50 MB) from the gallery, Files, Google Drive or iCloud
 * Drive, and uploads it to the server as the source for Edit Video. Resolves null if the user cancels.
 * The server deletes the clip when the edit finishes. Uses the document picker, loaded lazily so an older build still starts.
 */
export async function pickAndUploadVideo(): Promise<SourceClip | null> {
  const missing = () => new PickerMissingError("Picking videos needs the latest version of the app. Rebuild it and try again.");
  let picker: typeof import("expo-document-picker");
  try { picker = require("expo-document-picker"); } catch { throw missing(); }
  if (typeof picker?.getDocumentAsync !== "function") throw missing();

  let result: Awaited<ReturnType<typeof picker.getDocumentAsync>>;
  try { result = await picker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true, multiple: false }); }
  catch (e) { if (/native module|ExpoDocumentPicker/i.test((e as Error).message)) throw missing(); throw e; }
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return null;
  if (asset.size && asset.size > 50 * 1024 * 1024) throw new Error("That video is larger than 50 MB. Choose a shorter clip.");

  const form = new FormData();
  form.append("file", { uri: asset.uri, name: asset.name || `clip-${Date.now()}.mp4`, type: asset.mimeType || "video/mp4" } as unknown as Blob);
  return api<SourceClip>("/api/vision/upload-video", { method: "POST", body: form });
}
