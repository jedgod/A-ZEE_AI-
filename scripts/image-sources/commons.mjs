import { fetchPublic, publicUrl } from "./fetch-public.mjs";

const apiHosts = new Set(["commons.wikimedia.org"]);
export const commonsImageHosts = new Set(["upload.wikimedia.org"]);
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function commonsSources({ category, limit, userAgent, maxBytes, fetchBytes = fetchPublic }) {
  if (typeof category !== "string" || !category.startsWith("Category:") || category.length > 240 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Commons needs a Category: title and a limit of 1–100");
  if (typeof userAgent !== "string" || !/\([^)]{4,}\)/.test(userAgent)) throw new Error("Set a Wikimedia User-Agent with operator contact details");

  const entries = [];
  const seen = new Set();
  let continuation;
  // A category can contain many non-image files; cap listing requests per run.
  for (let request = 0; request < 5 && entries.length < limit; request++) {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query", generator: "categorymembers", gcmtitle: category, gcmtype: "file",
      gcmlimit: "25", prop: "imageinfo", iiprop: "url|mime|size", iilimit: "1",
      format: "json", formatversion: "2", maxlag: "5",
      ...(continuation ? { continue: continuation.continue, gcmcontinue: continuation.gcmcontinue } : {}),
    }).toString();
    const bytes = await fetchBytes(url.href, { hosts: apiHosts, maxBytes: 512_000, userAgent, accept: "application/json" });
    const data = JSON.parse(bytes.toString("utf8"));
    if (data.error || data.query?.pages !== undefined && !Array.isArray(data.query.pages)) {
      throw new Error("Wikimedia Commons listing failed");
    }
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info || !mimeTypes.has(info.mime) || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > maxBytes ||
          !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 ||
          info.width * info.height > 24_000_000) continue;
      const pageUrl = publicUrl(info.descriptionurl);
      const imageUrl = publicUrl(info.url);
      if (!apiHosts.has(pageUrl.hostname) || !commonsImageHosts.has(imageUrl.hostname) || seen.has(pageUrl.href)) continue;
      entries.push({ pageUrl: pageUrl.href, imageUrl: imageUrl.href, provider: "Wikimedia Commons" });
      seen.add(pageUrl.href);
      if (entries.length === limit) break;
    }
    continuation = data.continue;
    if (!continuation) break;
    if (typeof continuation.continue !== "string" || typeof continuation.gcmcontinue !== "string") {
      throw new Error("Unexpected Wikimedia Commons continuation");
    }
  }
  return entries;
}
