import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditedSecrets, createSecretProvider, envProvider, fileProvider, hydrate, redact, registerSecretProvider, SecretError } from "@/lib/secrets";

describe("provider-neutral secrets", () => {
  it("defaults to env in development but refuses an implicit or env provider in production", () => {
    expect(createSecretProvider({}).kind).toBe("env");
    expect(() => createSecretProvider({ NODE_ENV: "production" })).toThrow(/explicitly/);
    expect(() => createSecretProvider({ NODE_ENV: "production", AZEE_SECRET_PROVIDER: "env" })).toThrow(/not allowed/);
  });
  it("never guesses an unregistered store, and accepts one registered once confirmed", async () => {
    expect(() => createSecretProvider({ AZEE_SECRET_PROVIDER: "someplace" })).toThrow(/not registered/);
    registerSecretProvider("fake-store", () => ({ kind: "fake-store", get: async (n) => (n === "A" ? "1" : null) }));
    expect(await createSecretProvider({ AZEE_SECRET_PROVIDER: "fake-store" }).get("A")).toBe("1");
    expect(() => registerSecretProvider("env", () => envProvider({}))).toThrow();
  });
  it("file provider reads mounted secrets, trims the trailing newline and cannot escape its directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sec-")); try {
      writeFileSync(path.join(dir, "K"), "value\n", { mode: 0o600 });
      const p = fileProvider(dir);
      expect(await p.get("K")).toBe("value"); expect(await p.get("missing")).toBeNull();
      await expect(p.get("../K")).rejects.toThrow(SecretError); await expect(p.get("a/b")).rejects.toThrow(SecretError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("audits names and outcomes only, caches briefly so rotation is picked up, and masks provider failures", async () => {
    let value = "v1"; let t = 0; const audit = vi.fn();
    const s = auditedSecrets({ kind: "x", get: async () => value }, audit, 1000, () => t);
    expect(await s.require("K")).toBe("v1"); value = "v2"; expect(await s.require("K")).toBe("v1");   // cached
    t = 2000; expect(await s.require("K")).toBe("v2");                                                // rotated
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/v1|v2/);
    const bad = auditedSecrets({ kind: "x", get: async () => { throw new Error("password=hunter2"); } }, audit);
    await expect(bad.get("K")).rejects.toThrow("secret store unavailable");
    expect(audit.mock.calls.at(-1)![0].outcome).toBe("error");
    await expect(auditedSecrets({ kind: "x", get: async () => null }, audit).require("K")).rejects.toThrow(/missing/);
  });
  it("hydrates a config record so existing loaders keep working", async () => {
    const s = auditedSecrets(envProvider({ A: "1" }), () => {});
    expect(await hydrate(["A", "B"], s, { B: "base" })).toEqual({ B: "base", A: "1" });
  });
  it("redacts private keys, bearer credentials and JWTs", () => {
    const text = "k -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- Bearer abcdefghijk jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig";
    expect(redact(text)).not.toMatch(/abc\n|abcdefghijk|eyJ/);
  });
});
