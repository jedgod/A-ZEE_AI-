// Share links carry the project in the URL fragment (never sent to a server):
// #share=<base64url(deflate-raw(JSON))>. Anyone who opens the link on a reachable
// AZ_AI instance sees the conversation, its attached files, and shared prompts.

export type SharedMessage = { role: "user" | "assistant"; content: string; display?: string };
export type SharedPrompt = { title: string; mode: "chat" | "code" | "research"; prompt: string };
export type SharedUpload = { name: string; content: string };
export type SharedProject = { v: 1; title: string; mode: "chat" | "code" | "research"; messages: SharedMessage[]; prompts: SharedPrompt[]; uploads?: SharedUpload[] };

const MODES = ["chat", "code", "research"];
export const SHARE_PREFIX = "#share=";

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function encodeShare(project: SharedProject): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(project));
  return SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShare(hash: string): Promise<SharedProject | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream("deflate-raw")));
    const data = JSON.parse(json);
    if (data?.v !== 1 || typeof data.title !== "string" || !MODES.includes(data.mode)) return null;
    if (!Array.isArray(data.messages) || !data.messages.every((m: SharedMessage) => m &&
      ["user", "assistant"].includes(m.role) && typeof m.content === "string" &&
      (m.display === undefined || typeof m.display === "string"))) return null;
    const prompts = Array.isArray(data.prompts) ? data.prompts.filter((p: SharedPrompt) => p &&
      typeof p.title === "string" && typeof p.prompt === "string" && MODES.includes(p.mode)) : [];
    const uploads = Array.isArray(data.uploads) ? data.uploads.filter((u: SharedUpload) => u &&
      typeof u.name === "string" && typeof u.content === "string").map((u: SharedUpload) => ({ name: u.name.slice(0, 120), content: u.content })) : [];
    return { v: 1, title: data.title.slice(0, 120), mode: data.mode, messages: data.messages.slice(0, 200), prompts: prompts.slice(0, 20), uploads: uploads.slice(0, 8) };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Project share links (sidebar → project ⋯ → Share): the project's name, description,
// instructions, default mode and chats, in the URL fragment like chat links (never sent to a
// server). The recipient chooses whether to add it to their workspace.
// ------------------------------------------------------------
type Mode = "chat" | "code" | "research";
export type SharedChat = { title: string; mode: Mode; messages: SharedMessage[] };
export type SharedProjectBundle = {
  v: 2; kind: "project"; name: string; description: string; instructions: string; defaultMode: Mode; chats: SharedChat[];
};
export const PROJECT_SHARE_PREFIX = "#share-project=";
export const MAX_SHARED_CHATS = 20;
/** Longest link we create; past this browsers and chat apps start truncating. */
export const MAX_PROJECT_LINK = 120_000;

export class ShareTooLargeError extends Error {
  constructor() { super("This project is too large to share as a link. Share fewer or shorter chats."); }
}

const validMessages = (list: unknown): list is SharedMessage[] => Array.isArray(list) && list.every((m: SharedMessage) =>
  m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && (m.display === undefined || typeof m.display === "string"));

export async function encodeProjectShare(bundle: SharedProjectBundle): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ ...bundle, chats: bundle.chats.slice(0, MAX_SHARED_CHATS) }));
  const link = PROJECT_SHARE_PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
  if (link.length > MAX_PROJECT_LINK) throw new ShareTooLargeError();
  return link;
}

export async function decodeProjectShare(hash: string): Promise<SharedProjectBundle | null> {
  if (!hash.startsWith(PROJECT_SHARE_PREFIX) || hash.length > MAX_PROJECT_LINK) return null;
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(hash.slice(PROJECT_SHARE_PREFIX.length)), new DecompressionStream("deflate-raw")));
    const data = JSON.parse(json);
    if (data?.v !== 2 || data.kind !== "project" || typeof data.name !== "string" || !data.name.trim()) return null;
    const chats = Array.isArray(data.chats) ? data.chats.filter((c: SharedChat) =>
      c && typeof c.title === "string" && MODES.includes(c.mode) && validMessages(c.messages) && c.messages.length > 0) : [];
    return {
      v: 2, kind: "project",
      name: data.name.trim().slice(0, 40),
      description: typeof data.description === "string" ? data.description.slice(0, 500) : "",
      instructions: typeof data.instructions === "string" ? data.instructions.slice(0, 4000) : "",
      defaultMode: MODES.includes(data.defaultMode) ? data.defaultMode : "chat",
      chats: chats.slice(0, MAX_SHARED_CHATS).map((c: SharedChat) => ({ title: c.title.slice(0, 120), mode: c.mode, messages: c.messages.slice(0, 200) })),
    };
  } catch {
    return null;
  }
}

export function toMarkdown(title: string, messages: SharedMessage[]): string {
  return `# ${title}\n\n` + messages.map(m => `**${m.role === "user" ? "You" : "AZ_AI"}:**\n\n${m.display || m.content}`).join("\n\n---\n\n") + "\n";
}
