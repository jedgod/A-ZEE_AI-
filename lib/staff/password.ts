import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt via node:crypto (no native dependency). Stored format:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// Parameters live in the hash, so they can be raised later without breaking old hashes.
const N = 2 ** 15, R = 8, P = 1, KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 12;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every(Number.isInteger) || n > 2 ** 20 || r > 16 || p > 4) return false;
  const expected = Buffer.from(parts[5], "base64");
  const actual = await scrypt(password, Buffer.from(parts[4], "base64"), n, r, p);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Server-side password rules (the UI shows the same message). */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (new Set(password).size < 5) return "Use a less repetitive password.";
  return null;
}

/** A random first-time password for new staff (they must change it on first sign-in). */
export function temporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

// A real hash of a random value, so unknown-email sign-ins take as long as wrong passwords.
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}
