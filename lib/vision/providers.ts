import "server-only";
import { isIP } from "node:net";
import sharp from "sharp";
import { z } from "zod";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import type { Classification, Discovery, WebMatch } from "./provider-types";

export const classifierReady = () => !ollamaOnly() && !!process.env.SIGHTENGINE_API_USER && !!process.env.SIGHTENGINE_API_SECRET;
export const discoveryReady = () => !ollamaOnly() && !!process.env.GOOGLE_VISION_API_KEY;
type Transport = typeof fetch;
let active = 0;
const LIMIT = 1_000_000;

/** Fixed upstreams only. No redirects, retries, image hosting or fetching returned URLs. */
async function providerJson(url: string, init: RequestInit, transport: Transport): Promise<unknown> {
  if (active >= 12) throw new Error("PROVIDER_BUSY");
  active++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await transport(url, { ...init, signal: controller.signal, redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("PROVIDER_UNAVAILABLE"); }
    if (Number(response.headers.get("content-length")) > LIMIT) { await response.body.cancel(); throw new Error("RESPONSE_TOO_LARGE"); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIMIT) { await reader.cancel(); throw new Error("RESPONSE_TOO_LARGE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timer); active--; }
}

const classificationSchema = z.object({ status: z.literal("success"), type: z.object({ ai_generated: z.number().min(0).max(1) }) });

export async function classifyImage(bytes: Uint8Array, mime: string, consent: boolean, transport: Transport = fetch): Promise<Classification> {
  const provider = "sightengine" as const;
  if (!consent) return { provider, status: "skipped", reason: "No Sightengine consent for this image." };
  if (ollamaOnly()) return { provider, status: "unavailable", reason: "External processing is disabled in private mode." };
  if (!classifierReady()) return { provider, status: "not_configured", reason: "Sightengine credentials are not configured." };
  try {
    const body = new FormData();
    body.set("media", new Blob([new Uint8Array(bytes)], { type: mime }), "image");
    body.set("models", "genai");
    body.set("api_user", process.env.SIGHTENGINE_API_USER!);
    body.set("api_secret", process.env.SIGHTENGINE_API_SECRET!);
    const result = classificationSchema.parse(await providerJson("https://api.sightengine.com/1.0/check.json", { method: "POST", body }, transport));
    const score = result.type.ai_generated;
    return { provider, status: "checked", model: "genai", modelVersion: "provider-managed", score,
      label: score >= 0.9 ? "LIKELY_AI" : score <= 0.1 ? "LOW_AI_SIGNAL" : "INCONCLUSIVE",
      calibrated: false, checkedAt: new Date().toISOString() };
  } catch { return { provider, status: "unavailable", reason: "Classification timed out, failed, or returned an invalid response. Try later." }; }
}

const item = z.object({ url: z.string().max(2048) });
const webSchema = z.object({ responses: z.array(z.object({
  error: z.unknown().optional(),
  webDetection: z.object({ pagesWithMatchingImages: z.array(item).max(100).optional(), fullMatchingImages: z.array(item).max(100).optional(), partialMatchingImages: z.array(item).max(100).optional() }).optional(),
})).length(1) });

export function safePublicUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host.endsWith(".") || host.includes("..") || host.length > 253 || u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || isIP(host) || host.includes(":") || !host.includes(".") ||
      /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) || !/^[a-z0-9.-]+$/.test(host)) return;
    u.hash = "";
    return u.href;
  } catch { return; }
}

export function platformForUrl(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  const platforms: [string, string[]][] = [
    ["TikTok", ["tiktok.com"]], ["Facebook", ["facebook.com", "fb.com"]], ["Instagram", ["instagram.com"]],
    ["X", ["x.com", "twitter.com"]], ["LinkedIn", ["linkedin.com"]], ["YouTube", ["youtube.com", "youtu.be"]],
    ["Telegram", ["t.me", "telegram.me", "telegram.org"]], ["WhatsApp", ["whatsapp.com", "wa.me"]],
    ["Signal", ["signal.org", "signal.me"]], ["Tinder", ["tinder.com"]], ["Bumble", ["bumble.com"]], ["Hinge", ["hinge.co"]],
  ];
  return platforms.find(([, domains]) => domains.some(domain => host === domain || host.endsWith("." + domain)))?.[0] ?? "Public web";
}

export async function discoverImage(bytes: Uint8Array, consent: boolean, transport: Transport = fetch): Promise<Discovery> {
  const provider = "google_vision" as const;
  if (!consent) return { provider, status: "skipped", reason: "No Google Cloud Vision consent for this image." };
  if (ollamaOnly()) return { provider, status: "unavailable", reason: "External processing is disabled in private mode." };
  if (!discoveryReady()) return { provider, status: "not_configured", reason: "Google Cloud Vision key is not configured." };
  try {
    // Strip metadata and bound inline request size. Search matches are provider visual matches, not byte hashes.
    const searchImage = await sharp(bytes, { limitInputPixels: 24_000_000 }).autoOrient()
      .flatten({ background: "#fff" }).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    // Inline bytes avoid publishing a temporary image or granting a provider access to arbitrary URLs.
    const result = webSchema.parse(await providerJson("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_VISION_API_KEY! },
      body: JSON.stringify({ requests: [{ image: { content: searchImage.toString("base64") }, features: [{ type: "WEB_DETECTION", maxResults: 20 }] }] }),
    }, transport));
    const response = result.responses[0];
    if (response.error) throw new Error("PROVIDER_ERROR");
    // A missing annotation is not treated as a successful empty search.
    if (!response.webDetection) throw new Error("MISSING_ANNOTATION");
    const web = response.webDetection;
    const matches: WebMatch[] = [];
    const seen = new Set<string>();
    for (const [kind, entries] of [["matching_page", web.pagesWithMatchingImages], ["full_image", web.fullMatchingImages], ["partial_image", web.partialMatchingImages]] as const) {
      for (const entry of entries ?? []) {
        const url = safePublicUrl(entry.url);
        if (!url || seen.has(url) || matches.length >= 20) continue;
        seen.add(url); matches.push({ url, kind, platform: platformForUrl(url) });
      }
    }
    return { provider, status: "checked", scope: "provider_public_index", checkedAt: new Date().toISOString(), matches };
  } catch { return { provider, status: "unavailable", reason: "Public search timed out, failed, or returned an invalid response. Try later." }; }
}
