import { api } from "./api";
import { Alert } from "react-native";
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
 * image bytes. Each invocation asks separately about optional Google upload; no consent is remembered.
 */
type Capabilities = { googleAi?: boolean; aiLikelihoodEstimator?: { configured?: boolean }; internetSearch?: { configured?: boolean } };

function askProvider(title: string, message: string): Promise<boolean | null> {
  return new Promise(resolve => Alert.alert(title, message, [
    { text: "Cancel image check", style: "cancel", onPress: () => resolve(null) },
    { text: "Skip this provider", onPress: () => resolve(false) },
    { text: "Allow for this image", onPress: () => resolve(true) },
  ], { cancelable: false }));
}

export async function scanImageFile(file: PickedImage | { uri: string; name?: string; mime?: string }): Promise<AiDetectionResult | null> {
  const proceed = await new Promise<boolean>(resolve => Alert.alert("Check image evidence",
    "Upload the selected image to A-Zee to check signed metadata and local copies? Optional AI classification and public web search require separate provider choices next. Results cannot prove authenticity or the original source.", [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Continue", onPress: () => resolve(true) },
    ], { cancelable: false }));
  if (!proceed) return null;
  // Capability lookup sends no image. Failure disables all optional uploads for this check.
  const capabilities = await api<Capabilities>("/api/vision/capabilities").catch(() => null);
  const choices: Record<string, boolean> = { googleConsent: false, classifierConsent: false, discoveryConsent: false };
  const providers = [
    ["googleConsent", capabilities?.googleAi, "Google Gemini visual clues", "Send this image to Google's Gemini to describe visible text and visual clues? This is not source discovery or proof of AI generation."],
    ["classifierConsent", capabilities?.aiLikelihoodEstimator?.configured, "Sightengine AI classification", "Send this image to Sightengine to estimate AI generation from its pixels? The score is a provider estimate, has not been calibrated on A-Zee's benchmark, and can be wrong."],
    ["discoveryConsent", capabilities?.internetSearch?.configured, "Google Cloud Vision public search", "Send a resized copy of this image to Google Cloud Vision Web Detection to find public indexed image matches and social links? Private messages/profiles are not searched. Matches do not establish the first source."],
  ] as const;
  for (const [field, configured, title, message] of providers) {
    if (!configured) continue;
    const allowed = await askProvider(title, message);
    if (allowed === null) return null;
    choices[field] = allowed;
  }
  const form = new FormData();
  for (const [field, allowed] of Object.entries(choices)) form.append(field, String(allowed));
  await appendFile(form, "file", { uri: file.uri, name: file.name ?? "image.jpg", type: file.mime ?? "image/jpeg" });
  const scan = await api<AiDetectionResult>("/api/vision/detect-ai", { method: "POST", body: form });
  return { ...scan, previewUrl: file.uri };
}
