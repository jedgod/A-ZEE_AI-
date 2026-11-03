import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Token encryption at rest: AES-256-GCM with a 32-byte key from CONNECTOR_TOKEN_KEY (base64).
// Format: v1.<iv>.<tag>.<ciphertext> (base64url). Tampering fails authentication.

export class ConnectorKeyMissingError extends Error {
  constructor() { super("CONNECTOR_KEY_MISSING"); }
}

function key(): Buffer {
  const raw = process.env.CONNECTOR_TOKEN_KEY?.trim();
  if (!raw) throw new ConnectorKeyMissingError();
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new ConnectorKeyMissingError();
  return buf;
}

export const tokenKeyConfigured = () => { try { key(); return true; } catch { return false; } };

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Invalid sealed token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** PKCE S256 challenge for a verifier. */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
