import { createPrivateKey, createPublicKey, createSign, createVerify, type KeyObject } from "node:crypto";

// RS256 JSON Web Tokens for the AZTrade identity bridge, on Node's own crypto (no extra dependency).
// Strictness is the point: only RS256, only known key ids, only the claims this system issues.

export type Keyring = { signingKid: string; signingKey: KeyObject; publicKeys: Map<string, KeyObject> };
export class JwtError extends Error { constructor(public reason: string) { super(reason); } }

const b64u = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const MIN_RSA_BITS = 2048;

function checkRsa(key: KeyObject, what: string) {
  if (key.asymmetricKeyType !== "rsa") throw new Error(`${what} must be an RSA key`);
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_BITS) throw new Error(`${what} must be at least ${MIN_RSA_BITS} bits`);
}

/**
 * Loads the signing key and, during a rotation, the previous public keys.
 *   AZTRADE_JWT_PRIVATE_KEY            PKCS#8 PEM (literal "\n" sequences are accepted for single-line env values)
 *   AZTRADE_JWT_KID                    stable id of that key
 *   AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS   optional JSON: [{"kid":"...","pem":"-----BEGIN PUBLIC KEY-----..."}]
 * Throws when anything is missing or weak: the feature then stays disabled (fail closed).
 */
export function loadKeyring(env: Record<string, string | undefined> = process.env): Keyring {
  const pem = env.AZTRADE_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const kid = env.AZTRADE_JWT_KID;
  if (!pem || !kid || !/^[A-Za-z0-9._-]{1,64}$/.test(kid)) throw new Error("AZTrade signing key is not configured");
  const signingKey = createPrivateKey(pem);
  checkRsa(signingKey, "AZTRADE_JWT_PRIVATE_KEY");
  const publicKeys = new Map<string, KeyObject>([[kid, createPublicKey(signingKey)]]);
  if (env.AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS) {
    const previous = JSON.parse(env.AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS) as { kid: string; pem: string }[];
    for (const p of previous) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(p.kid) || publicKeys.has(p.kid)) throw new Error("invalid or duplicate previous key id");
      const key = createPublicKey(p.pem.replace(/\\n/g, "\n"));
      checkRsa(key, `previous key ${p.kid}`);
      publicKeys.set(p.kid, key);
    }
  }
  return { signingKid: kid, signingKey, publicKeys };
}

/** The public keys, for the JWKS endpoint: the current key and any previous ones still honoured. */
export function publicJwks(ring: Keyring) {
  return { keys: [...ring.publicKeys].map(([kid, key]) => ({ ...key.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" })) };
}

export function signJwt(ring: Keyring, claims: Record<string, unknown>): string {
  const header = b64u(JSON.stringify({ alg: "RS256", kid: ring.signingKid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(ring.signingKey);
  return `${header}.${body}.${b64u(signature)}`;
}

export type VerifyOptions = { issuer: string; audience: string; now?: number; maxAgeSeconds?: number; skewSeconds?: number };

/** Verifies signature and claims. Throws JwtError with a stable reason; never returns an unverified payload. */
export function verifyJwt(ring: Keyring, token: string, opts: VerifyOptions): Record<string, any> {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.skewSeconds ?? 5;
  if (typeof token !== "string" || token.length > 8192) throw new JwtError("malformed");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]*$/.test(p))) throw new JwtError("malformed");
  let header: any, payload: any;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new JwtError("malformed"); }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") throw new JwtError("malformed");
  if (header.alg !== "RS256" || header.typ !== "JWT" || "crit" in header || "jku" in header || "jwk" in header || "x5u" in header) throw new JwtError("bad_header");
  const key = typeof header.kid === "string" ? ring.publicKeys.get(header.kid) : undefined;
  if (!key) throw new JwtError("unknown_key");
  const ok = createVerify("RSA-SHA256").update(`${parts[0]}.${parts[1]}`).verify(key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new JwtError("bad_signature");
  if (payload.iss !== opts.issuer) throw new JwtError("bad_issuer");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.audience)) throw new JwtError("bad_audience");
  for (const k of ["sub", "jti", "sid"]) if (typeof payload[k] !== "string" || !payload[k]) throw new JwtError("incomplete");
  if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) throw new JwtError("incomplete");
  if (payload.exp + skew < now) throw new JwtError("expired");
  if (payload.iat > now + skew) throw new JwtError("issued_in_future");
  if (opts.maxAgeSeconds !== undefined && now - payload.iat > opts.maxAgeSeconds + skew) throw new JwtError("too_old");
  if (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > now + skew)) throw new JwtError("not_yet_valid");
  return payload;
}
