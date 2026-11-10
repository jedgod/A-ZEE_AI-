#!/usr/bin/env node
// Verifies that an installed Ollama model's files on disk are intact, independently of what the Ollama API reports.
// Why: the A-Zee provider pins the digest that Ollama REPORTS, which identifies the model but cannot detect weights that were later corrupted or
// altered on disk (a failing or fake-capacity card, a bad copy, tampering). Corrupted weights keep a "valid" digest and still answer, with garbage.
//   node scripts/staging/verify-ollama-model.mjs --models E:\ollama\models --model qwen2.5:1.5b [--smoke http://127.0.0.1:11434]
//   Exit codes: 0 intact (and smoke passed if requested), 1 a blob is missing/short/mismatching or the smoke answer is wrong, 2 usage/manifest error.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Locates the manifest the way Ollama lays it out: manifests/<registry>/<namespace>/<name>/<tag> (default registry.ollama.ai, namespace library). */
export function manifestPath(modelsDir, ref) {
  const [name, tag = "latest"] = ref.split(":");
  const parts = name.split("/"); const [registry, ns, repo] = parts.length === 3 ? parts : parts.length === 2 ? ["registry.ollama.ai", parts[0], parts[1]] : ["registry.ollama.ai", "library", parts[0]];
  return path.join(modelsDir, "manifests", registry, ns, repo, tag);
}
const sha256File = (file) => new Promise((ok, bad) => { const h = createHash("sha256"); createReadStream(file).on("data", (d) => h.update(d)).on("error", bad).on("end", () => ok(h.digest("hex"))); });

export async function verifyModel(modelsDir, ref) {
  const mp = manifestPath(modelsDir, ref); if (!existsSync(mp)) return { ok: false, error: "manifest_not_found", manifest: mp };
  let manifest; try { manifest = JSON.parse(readFileSync(mp, "utf8")); } catch { return { ok: false, error: "manifest_unreadable" }; }
  const layers = [manifest.config, ...(manifest.layers ?? [])].filter(Boolean); const results = [];
  for (const l of layers) {
    const m = /^sha256:([a-f0-9]{64})$/.exec(l.digest ?? ""); if (!m) { results.push({ digest: l.digest, ok: false, reason: "bad_digest_in_manifest" }); continue; }
    const file = path.join(modelsDir, "blobs", `sha256-${m[1]}`);
    if (!existsSync(file)) { results.push({ digest: l.digest, ok: false, reason: "missing", mediaType: l.mediaType }); continue; }
    const size = statSync(file).size; if (typeof l.size === "number" && size !== l.size) { results.push({ digest: l.digest, ok: false, reason: "size_mismatch", expected: l.size, actual: size, mediaType: l.mediaType }); continue; }
    const actual = await sha256File(file); results.push(actual === m[1] ? { digest: l.digest, ok: true, size, mediaType: l.mediaType } : { digest: l.digest, ok: false, reason: "hash_mismatch", actual: `sha256:${actual}`, size, mediaType: l.mediaType });
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), layers: results.length, bad: results.filter((r) => !r.ok), results };
}

/** A trivial factual question at temperature 0 on a LOOPBACK endpoint; garbage output (bad weights) fails it. */
export async function smokeTest(baseUrl, model, fetchImpl = fetch) {
  const u = new URL(baseUrl); if (!["127.0.0.1", "[::1]"].includes(u.hostname) || u.protocol !== "http:") return { ok: false, error: "endpoint_must_be_numeric_loopback_http" };
  try {
    const r = await fetchImpl(`${u.origin}/api/chat`, { method: "POST", signal: AbortSignal.timeout(120_000), redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false, think: false, options: { temperature: 0, num_predict: 40, num_ctx: 2048 }, messages: [{ role: "user", content: "What is the capital of France? Answer in one short sentence." }] }) });
    if (!r.ok) return { ok: false, error: `status_${r.status}` };
    const text = String((await r.json())?.message?.content ?? ""); return { ok: /\bParis\b/i.test(text), answerLooksValid: /\bParis\b/i.test(text), sample: text.replace(/\s+/g, " ").slice(0, 80) };
  } catch { return { ok: false, error: "unreachable_or_timeout" }; }
}

if (process.argv[1]?.endsWith("verify-ollama-model.mjs")) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const models = arg("models"), model = arg("model"); if (!models || !model) { console.error("usage: --models <dir> --model name:tag [--smoke http://127.0.0.1:11434]"); process.exit(2); }
  const v = await verifyModel(models, model); console.log(JSON.stringify({ type: "ollama_model_verify", model, ...v, results: undefined }));
  for (const r of v.results ?? []) console.log(`  ${r.ok ? "OK      " : "CORRUPT "} ${r.digest?.slice(0, 19)}…  ${r.mediaType?.split(".").pop() ?? ""}${r.reason ? "  (" + r.reason + (r.actual ? ", on-disk hash " + r.actual.slice(0, 19) + "…" : "") + ")" : ""}`);
  let smoke = null; if (arg("smoke")) { smoke = await smokeTest(arg("smoke"), model); console.log(JSON.stringify({ type: "ollama_smoke", ...smoke })); }
  process.exit(v.error ? 2 : v.ok && (!smoke || smoke.ok) ? 0 : 1);
}
