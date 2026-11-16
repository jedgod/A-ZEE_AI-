import "server-only";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { ollamaOnly } from "./privacy";
import type { RetrievedSource } from "./context";

/**
 * Page context: when a message contains a link, "summarise this page", "explain it" or "translate it" are answered from that page's text.
 * The page is fetched by the server, never by the model, and treated as untrusted data (never instructions).
 * Safety: https only, no credentials, standard port, every address the host resolves to (checked at connect time, so DNS rebinding can't
 * swap it) must be a public one, redirects are followed by hand (max 3, each re-checked), text/HTML only, 1 MB cap, 8 s timeout.
 * PAGE_CONTEXT_DISABLED=1 turns it off. Nothing is fetched in ollama-only mode. Only the link the user typed is fetched, one per message.
 */
const MAX_BYTES = 1_000_000, TIMEOUT_MS = 8000, MAX_REDIRECTS = 3, MAX_TEXT = 12_000;

/** The first https link in the message, or null. Trailing punctuation is not part of the link. */
export function firstPageUrl(text: string): string | null {
  const m = /https:\/\/[^\s<>"')\]]+/i.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?]+$/, "");
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && url.length <= 2000 ? u.href : null;
  } catch { return null; }
}

/** True for addresses a public website would never use: loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved, IPv6 equivalents. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    return !(s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("64:ff9b") || s.startsWith("2001:db8"));
  }
  return false;
}

/** DNS lookup that refuses non-public addresses, used at connect time. */
const safeLookup = ((host: string, opts: unknown, cb: (...a: unknown[]) => void) => {
  const callback = (typeof opts === "function" ? opts : cb) as (...a: unknown[]) => void;
  dnsLookup(host, { all: true }, (err, addrs) => {
    if (err) return callback(err);
    const list = addrs as { address: string; family: number }[];
    const ok = list.filter(a => isPublicAddress(a.address));
    if (!ok.length || ok.length !== list.length) return callback(Object.assign(new Error("BLOCKED_ADDRESS"), { code: "BLOCKED_ADDRESS" }));
    const wantAll = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
    return wantAll ? callback(null, ok) : callback(null, ok[0].address, ok[0].family);
  });
}) as unknown as typeof dnsLookup;

type Fetched = { status: number; location?: string; type: string; body: string };
function getOnce(url: URL): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const bare = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(bare) && !isPublicAddress(bare)) return reject(Object.assign(new Error("BLOCKED_ADDRESS"), { code: "BLOCKED_ADDRESS" }));
    const req = httpsRequest(url, {
      method: "GET", lookup: safeLookup, timeout: TIMEOUT_MS,
      headers: { "User-Agent": "A-Zee page reader", Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
    }, res => {
      const type = String(res.headers["content-type"] ?? "").toLowerCase();
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location: String(res.headers.location ?? ""), type, body: "" }); }
      if (status !== 200 || !/^(text\/html|text\/plain|application\/xhtml)/.test(type)) { res.resume(); return resolve({ status, type, body: "" }); }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }); } else chunks.push(c);
      });
      res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

const entities = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

/** Readable text from HTML: title, description and body copy, without scripts, styles, menus, forms or markup. Exported for tests. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = entities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const desc = entities(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? "").trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form|header|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = entities(body).split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return { title, text: [desc, text].filter(Boolean).join("\n\n") };
}

/** The page the user linked, as an untrusted source for the model to cite, or no source plus a short note when it can't be read. */
export async function pageSources(question: string): Promise<{ sources: RetrievedSource[]; note?: string }> {
  if (ollamaOnly() || process.env.PAGE_CONTEXT_DISABLED === "1") return { sources: [] };
  const first = firstPageUrl(question);
  if (!first) return { sources: [] };
  try {
    let url = new URL(first);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await getOnce(url);
      if (r.status >= 300 && r.status < 400 && r.location) {
        const next = new URL(r.location, url);
        if (next.protocol !== "https:" || next.username || next.password || (next.port && next.port !== "443")) return { sources: [], note: "The linked page redirected somewhere that can't be read, so it was not used." };
        url = next;
        continue;
      }
      if (r.status !== 200 || !r.body) return { sources: [], note: `The linked page couldn't be read (${r.status === 200 ? "not a text page" : `status ${r.status || "error"}`}), so the answer isn't based on it.` };
      const { title, text } = /html/.test(r.type) ? htmlToText(r.body) : { title: "", text: r.body.replace(/\s+/g, " ").trim() };
      if (text.length < 40) return { sources: [], note: "The linked page has no readable text (it may need JavaScript or a login), so the answer isn't based on it." };
      const shown = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[page truncated]` : text;
      return { sources: [{ sourceId: "page:1", title: title || url.hostname, url: url.href, trust: "untrusted" as const, text: `Page: ${title || url.hostname} (${url.href})\n${shown}` }] };
    }
    return { sources: [], note: "The linked page redirected too many times, so it was not used." };
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e as Error).message;
    return { sources: [], note: code === "BLOCKED_ADDRESS" ? "That link points to a private or internal address, so it was not opened." : "The linked page couldn't be reached, so the answer isn't based on it." };
  }
}
