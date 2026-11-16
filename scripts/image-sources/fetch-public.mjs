import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [ip, width] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
]) blocked.addSubnet(ip, width, "ipv4");

export function publicUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Expected a public HTTPS URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname) ||
      !url.hostname.includes(".") || url.hostname.endsWith(".")) throw new Error("Expected a public HTTPS hostname on port 443");
  url.hash = "";
  return url;
}

export async function fetchPublic(value, { hosts, maxBytes, userAgent, accept }) {
  const url = publicUrl(value);
  if (!hosts.has(url.hostname)) throw new Error("Download hostname is outside the configured allowlist");

  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: 4,
      autoSelectFamily: false,
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Encoding": "identity" },
      lookup(hostname, _options, callback) {
        lookup(hostname, { family: 4, all: true }).then(addresses => {
          if (!addresses.length || addresses.some(({ address }) => blocked.check(address, "ipv4"))) {
            callback(new Error("Download host resolved to a non-public IP"));
            return;
          }
          // Use the checked address for the connection while keeping hostname TLS verification.
          callback(null, addresses[0].address, 4);
        }).catch(callback);
      },
    }, response => {
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Download interrupted")));
      const type = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const length = Number(response.headers["content-length"]);
      if (response.statusCode !== 200 || Number.isFinite(length) && length > maxBytes ||
          response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity" ||
          !accept.split(",").includes(type)) {
        reject(new Error(`Download rejected (HTTP ${response.statusCode}, unexpected type or size)`));
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new Error("Download exceeds byte limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks, size)));
    });
    req.on("error", reject);
    req.end();
  });
}
