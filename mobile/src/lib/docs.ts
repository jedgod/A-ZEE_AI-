import { api } from "./api";

export type PickedDoc = { fileName: string; attachment: string; characters: number; truncated: boolean };

const TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
];

/** Thrown when the installed app was built before the document picker was added. */
export class PickerMissingError extends Error {}

/**
 * Opens the phone's file picker, uploads the chosen file to the server for text extraction, and returns the
 * text as an "Attached file:" block to add to the next message. Resolves null if the user cancels.
 * The picker is a native module, loaded here (not at the top of the file) so an app built without it
 * still starts; it only reports PickerMissingError when this is used.
 */
export async function pickDocument(): Promise<PickedDoc | null> {
  let picker: typeof import("expo-document-picker");
  const missing = () => new PickerMissingError("Document upload needs the latest version of the app. Rebuild it and try again.");
  try { picker = require("expo-document-picker"); }
  catch { throw missing(); }
  // In an app built without the module, a failed load can leave an empty module behind.
  if (typeof picker?.getDocumentAsync !== "function") throw missing();

  let result: Awaited<ReturnType<typeof picker.getDocumentAsync>>;
  try { result = await picker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true, multiple: false }); }
  catch (e) {
    if (/native module|ExpoDocumentPicker/i.test((e as Error).message)) throw missing();
    throw e;
  }
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return null;

  const form = new FormData();
  // React Native's FormData reads the file from its uri.
  form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType || "application/octet-stream" } as unknown as Blob);
  const r = await api<{ fileName: string; attachment: string; characters: number; truncated: boolean }>("/api/docs/parse", { method: "POST", body: form });
  return { fileName: r.fileName, attachment: r.attachment, characters: r.characters, truncated: r.truncated };
}

const ATTACHED = /\n\nAttached file: ([^\n]+)\n[\s\S]*$/;

/** Splits a saved message into what the user typed and the name of the file attached to it (if any). */
export function splitAttachment(content: string): { text: string; fileName: string | null } {
  const m = ATTACHED.exec(content);
  return m ? { text: content.slice(0, m.index), fileName: m[1] } : { text: content, fileName: null };
}
