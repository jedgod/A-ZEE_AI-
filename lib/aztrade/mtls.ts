import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { X509Certificate, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

// mTLS front for the private /introspect service endpoint. It is a standalone listener (Next route handlers cannot see
// the TLS peer), meant to be bound to a PRIVATE interface only. Whether the network is actually isolated is an
// infrastructure fact that must be verified there; this module only guarantees what it can enforce itself:
//   - TLS 1.2+, client certificate REQUIRED and validated against the configured client CA (plus CRL when supplied)
//   - the client certificate must also match an allowlisted subject CN or SHA-256 fingerprint, and not be denylisted
//   - the shared service credential is still required (defence in depth)
//   - certificates/CRL are re-read on an interval (rotation + revocation); if a reload keeps failing the listener
//     answers 503 for everything once the credentials are older than maxStaleMs (fail closed)
//   - tokens and credentials are never logged.

export type MtlsFiles = { keyFile: string; certFile: string; clientCaFile: string; crlFile?: string };
export type MtlsOptions = MtlsFiles & {
  allowedClientCommonNames?: string[];
  allowedClientFingerprints?: string[];          // SHA-256, hex, with or without colons
  deniedClientFingerprints?: string[];
  serviceSecret: string;
  introspect: (token: string) => Promise<unknown>;
  jwks?: () => Promise<unknown>;                  // public signing keys, served to authenticated services at GET /jwks
  reloadMs?: number;                              // default 60s
  maxStaleMs?: number;                            // default 15 min
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
};

const norm = (fp: string) => fp.replace(/:/g, "").toLowerCase();
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function loadContext(f: MtlsFiles) {
  const [key, cert, ca, crl] = await Promise.all([readFile(f.keyFile), readFile(f.certFile), readFile(f.clientCaFile), f.crlFile ? readFile(f.crlFile) : Promise.resolve(undefined)]);
  const x = new X509Certificate(cert);
  if (Date.now() > Date.parse(x.validTo)) throw new Error("server certificate expired");
  const trust = createHash("sha256").update(ca).update(crl ?? "").digest("hex");   // what decides which CLIENTS are acceptable
  return { trust, key, cert, ca, ...(crl ? { crl } : {}), requestCert: true as const, rejectUnauthorized: true as const, minVersion: "TLSv1.2" as const };
}

export async function createMtlsIntrospectServer(opts: MtlsOptions) {
  if (opts.serviceSecret.length < 32) throw new Error("service secret must be at least 32 characters");
  if (!opts.allowedClientCommonNames?.length && !opts.allowedClientFingerprints?.length) throw new Error("an allowlist of client identities is required");
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((e) => console.info(JSON.stringify(e)));
  const denied = new Set((opts.deniedClientFingerprints ?? []).map(norm));
  const allowedFp = new Set((opts.allowedClientFingerprints ?? []).map(norm));
  const allowedCn = new Set(opts.allowedClientCommonNames ?? []);

  let loadedAt = now();
  const first = await loadContext(opts); let trust = first.trust; let trustGen = 0; const gens = new WeakMap<object, number>();
  const server = https.createServer(first, (req, res) => { void handle(req, res); });
  // A client with no valid certificate never reaches the handler; record only the fact, never any payload.
  server.on("secureConnection", (socket) => gens.set(socket, trustGen));
  server.on("tlsClientError", (e) => log({ type: "mtls_rejected", code: (e as NodeJS.ErrnoException).code ?? "TLS_ERROR" }));

  const reload = async () => {
    try {
      const next = await loadContext(opts); server.setSecureContext(next); loadedAt = now();
      // Client trust (CA or CRL) changed: connections authenticated under the OLD rules are no longer honoured (idle ones are closed,
      // busy ones are refused on their next request). Rotating only the server certificate leaves live connections and in-flight requests alone.
      if (next.trust !== trust) { trust = next.trust; trustGen++; server.closeIdleConnections?.(); }
      log({ type: "mtls_reloaded" });
    }
    catch { log({ type: "mtls_reload_failed" }); }
  };
  const timer = setInterval(reload, opts.reloadMs ?? 60_000); timer.unref();

  const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const socket = req.socket as TLSSocket;
    if (now() - loadedAt > (opts.maxStaleMs ?? 15 * 60_000)) return send(res, 503, { active: false, error: "CREDENTIALS_STALE" });
    if (gens.get(socket) !== trustGen) { res.setHeader("connection", "close"); return send(res, 401, { active: false }); }
    const peer = socket.getPeerCertificate();
    if (!socket.authorized || !peer?.raw) return send(res, 401, { active: false });
    const fp = norm(peer.fingerprint256 ?? "");
    const cn = typeof peer.subject?.CN === "string" ? peer.subject.CN : "";
    if (!fp || denied.has(fp) || !(allowedFp.has(fp) || allowedCn.has(cn))) { log({ type: "mtls_unauthorized_identity", fp: fp.slice(0, 12) }); return send(res, 403, { active: false }); }
    const isJwks = req.method === "GET" && req.url === "/jwks" && !!opts.jwks;
    if (!isJwks && (req.method !== "POST" || req.url !== "/introspect")) return send(res, 404, { active: false });
    if (!same(String(req.headers.authorization ?? ""), `Bearer ${opts.serviceSecret}`)) return send(res, 401, { active: false });
    if (isJwks) { try { return send(res, 200, await opts.jwks!()); } catch { return send(res, 503, { error: "KEYS_UNAVAILABLE" }); } }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > 16_384) return send(res, 413, { active: false }); chunks.push(c as Buffer); }
      const token = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.token;
      if (typeof token !== "string" || token.length > 8192) return send(res, 400, { active: false });
      send(res, 200, await opts.introspect(token));
    } catch { send(res, 503, { active: false, error: "INTROSPECTION_UNAVAILABLE" }); }   // fail closed; the message never carries input
  }

  return {
    server,
    reload,
    listen: (port: number, host: string) => new Promise<number>((ok, bad) => { server.once("error", bad); server.listen(port, host, () => ok((server.address() as { port: number }).port)); }),
    close: () => { clearInterval(timer); return new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections?.(); }); },
  };
}
