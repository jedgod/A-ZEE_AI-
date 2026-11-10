import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, truncateSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyModel, smokeTest, manifestPath } from "../scripts/staging/verify-ollama-model.mjs";

// Builds a miniature Ollama store (manifest + content-addressed blobs) and proves the verifier catches the failure that hit the E: card:
// a blob whose bytes changed after download while the model still LOOKS installed.
let dir: string; const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const weights = Buffer.from("w".repeat(4096)), config = Buffer.from('{"model_format":"gguf"}');
const blob = (b: Buffer) => path.join(dir, "blobs", `sha256-${sha(b)}`);
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oll-")); mkdirSync(path.join(dir, "blobs")); writeFileSync(blob(weights), weights); writeFileSync(blob(config), config);
  const mp = manifestPath(dir, "tiny:1b"); mkdirSync(path.dirname(mp), { recursive: true });
  writeFileSync(mp, JSON.stringify({ schemaVersion: 2, config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: `sha256:${sha(config)}`, size: config.length }, layers: [{ mediaType: "application/vnd.ollama.image.model", digest: `sha256:${sha(weights)}`, size: weights.length }] }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("model files on disk", () => {
  it("locates the manifest the way Ollama lays it out", () => {
    const norm = (p: string) => p.split("\\").join("/");
    expect(norm(manifestPath("/m", "qwen2.5:1.5b"))).toBe("/m/manifests/registry.ollama.ai/library/qwen2.5/1.5b");
    expect(norm(manifestPath("/m", "me/model:t"))).toBe("/m/manifests/registry.ollama.ai/me/model/t");
  });
  it("passes an intact store", async () => { expect(await verifyModel(dir, "tiny:1b")).toMatchObject({ ok: true, layers: 2, bad: [] }); });
  it("catches a blob whose bytes changed but whose size did not (the failure seen on the SD card)", async () => {
    const b = readFileSync(blob(weights)); b[100] ^= 0xff; writeFileSync(blob(weights), b);
    const r = await verifyModel(dir, "tiny:1b"); expect(r.ok).toBe(false); expect(r.bad![0]).toMatchObject({ reason: "hash_mismatch" }); expect(r.bad![0].actual).not.toContain(sha(weights));
    b[100] ^= 0xff; writeFileSync(blob(weights), b);                          // restore
  });
  it("catches truncation and a missing blob, and an unknown model", async () => {
    truncateSync(blob(weights), 1000); expect((await verifyModel(dir, "tiny:1b")).bad![0]).toMatchObject({ reason: "size_mismatch" }); writeFileSync(blob(weights), weights);
    rmSync(blob(config)); expect((await verifyModel(dir, "tiny:1b")).bad![0]).toMatchObject({ reason: "missing" }); writeFileSync(blob(config), config);
    expect(await verifyModel(dir, "nope:1")).toMatchObject({ ok: false, error: "manifest_not_found" });
  });
});
describe("smoke test", () => {
  const reply = (content: string) => (async () => new Response(JSON.stringify({ message: { content } }))) as typeof fetch;
  it("passes a coherent answer and fails garbage (what corrupted weights produce)", async () => {
    expect((await smokeTest("http://127.0.0.1:11434", "m", reply("The capital of France is Paris."))).ok).toBe(true);
    expect((await smokeTest("http://127.0.0.1:11434", "m", reply("concern - - - when - imp P - P - 抱怨"))).ok).toBe(false);
  });
  it("only ever talks to a numeric loopback endpoint", async () => { for (const u of ["http://example.com:11434", "http://10.0.0.5:11434", "https://127.0.0.1:11434", "http://localhost:11434"]) expect((await smokeTest(u, "m", reply("Paris"))).ok, u).toBe(false); });
});
