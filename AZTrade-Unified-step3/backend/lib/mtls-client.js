import https from 'node:https';
import fs from 'node:fs';

// mTLS fetcher for the A-Zee /introspect call. Same response shape as fetch() for the fields identity.js uses.
//   AZEE_INTROSPECTION_MTLS_CERT_FILE / _KEY_FILE   this service's client certificate
//   AZEE_INTROSPECTION_MTLS_CA_FILE                 CA that signed the A-Zee introspection server certificate
//   AZEE_INTROSPECTION_MTLS_SERVER_NAME             optional expected server name (SAN) when the URL host differs
// Files are re-read on every new connection pool creation, so rotated certificates are picked up by a restart-free
// reload (the agent is rebuilt when any file's mtime changes). Production: required (identity.js fails closed without it).
let agent, stamp;
const files = env => ['CERT', 'KEY', 'CA'].map(k => env[`AZEE_INTROSPECTION_MTLS_${k}_FILE`]);
export const mtlsConfigured = (env = process.env) => files(env).every(Boolean);

function currentAgent(env) {
  const [cert, key, ca] = files(env);
  const s = [cert, key, ca].map(f => fs.statSync(f).mtimeMs).join(':');
  if (!agent || s !== stamp) {
    agent?.destroy();
    agent = new https.Agent({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), ca: fs.readFileSync(ca), minVersion: 'TLSv1.2', rejectUnauthorized: true, keepAlive: true, servername: env.AZEE_INTROSPECTION_MTLS_SERVER_NAME || undefined });
    stamp = s;
  }
  return agent;
}

export function mtlsFetcher(env = process.env) {
  return (url, { method = 'POST', headers = {}, body, signal } = {}) => new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('mTLS requires HTTPS'));
    const req = https.request(u, { method, headers: { ...headers, 'content-length': Buffer.byteLength(body ?? '') }, agent: currentAgent(env), signal }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > 65536) req.destroy(new Error('response too large')); else chunks.push(c); });
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text) }); });
    });
    req.on('error', () => reject(new Error('Introspection transport failed')));   // no details: nothing here may echo credentials
    req.end(body);
  });
}
