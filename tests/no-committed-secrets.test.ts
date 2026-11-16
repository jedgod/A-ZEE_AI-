import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Keys, tokens and environment values must never be committed. This scans the files git tracks, so it also catches a secret that was added
// to the index but not yet committed. It looks for private-key blocks, well-known token shapes and tracked env or key files.
const root = path.resolve(__dirname, "..");

function tracked(): string[] | null {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean);
  } catch { return null; }   // not a git checkout (for example a packaged copy): nothing to scan
}

const FORBIDDEN_FILE = [
  /(^|\/)\.env(\..+)?$/,                       // .env, .env.local, .env.production ...
  /\.(key|pem|p12|pfx|jks|keystore)$/i,
  /(^|\/)secrets?[-_a-z]*\//i,                  // secrets/, secrets-staging/
  /(^|\/)(last-token|id_rsa|id_ed25519)(\.[a-z]+)?$/i,
];
const ALLOWED_FILE = [/(^|\/)\.env\.example$/, /(^|\/)\.env\.[a-z]+\.example$/, /^lib\/secrets\//];   // examples hold placeholders; lib/secrets is code

const SECRET_SHAPES: [string, RegExp][] = [
  ["private key block", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\s)*[A-Za-z0-9+\/=]{40,}/],   // a header followed by real key material; a test string with a short placeholder is not a key
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["OpenAI/Anthropic style key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Stripe live key", /\b[sr]k_live_[A-Za-z0-9]{20,}\b/],
];

const SKIP_CONTENT = /(^|\/)(package-lock\.json|.*\.(png|jpe?g|gif|webp|ico|pdf|zip|tap|lock|woff2?|ttf|apk|aab|jar|so|bin))$/i;
const SELF = "tests/no-committed-secrets.test.ts";

describe("no committed secrets", () => {
  const files = tracked();

  it("tracks no env, key or secrets files (examples with placeholders are fine)", () => {
    if (!files) return;
    const bad = files.filter(f => FORBIDDEN_FILE.some(re => re.test(f)) && !ALLOWED_FILE.some(re => re.test(f)));
    expect(bad, `Remove these from git and add them to .gitignore: ${bad.join(", ")}`).toEqual([]);
  });

  it("contains no private keys or well-known token shapes", () => {
    if (!files) return;
    const hits: string[] = [];
    for (const f of files) {
      if (f === SELF || SKIP_CONTENT.test(f)) continue;
      let size = 0;
      try { size = statSync(path.join(root, f)).size; } catch { continue; }
      if (size > 1_500_000) continue;
      let body = "";
      try { body = readFileSync(path.join(root, f), "latin1"); } catch { continue; }
      for (const [name, re] of SECRET_SHAPES) if (re.test(body)) hits.push(`${f}: ${name}`);
    }
    expect(hits, "Rotate any real key that appears here, then remove it from the file and git history.").toEqual([]);
  });

  it("the scanner recognises the shapes it is meant to catch", () => {
    const fake = (n: string) => SECRET_SHAPES.find(([name]) => name === n)![1];
    expect(fake("private key block").test("-----BEGIN " + "OPENSSH PRIVATE KEY-----" + "A".repeat(64))).toBe(true);
    expect(fake("private key block").test("-----BEGIN " + "PRIVATE KEY----- abc -----END PRIVATE KEY-----")).toBe(false);
    expect(fake("GitHub token").test("ghp_" + "a".repeat(36))).toBe(true);
    expect(fake("Google API key").test("AIza" + "b".repeat(35))).toBe(true);
    expect(fake("OpenAI/Anthropic style key").test("sk-" + "c".repeat(40))).toBe(true);
    expect(FORBIDDEN_FILE.some(re => re.test("config/.env.local"))).toBe(true);
    expect(FORBIDDEN_FILE.some(re => re.test("README.md"))).toBe(false);
  });
});
