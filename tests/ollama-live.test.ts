// Opt-in real inference. Uses synthetic data only; never loads .env.local.
// QORLLA_OLLAMA_LIVE=1 node node_modules/vitest/vitest.mjs run tests/ollama-live.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { ollamaBranch } from "@/05_MODEL_LAYER/ollama_branch/ollama_branch";
import { answerChat } from "@/lib/pipeline";
import { webActor } from "@/lib/pipeline/actor";
import { health } from "@/lib/pipeline/registry";

const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11435";
const model = process.env.OLLAMA_MODEL || "qwen3:4b";
const rows: any[] = [];
const report: any = { startedAt: new Date().toISOString(), processId: process.pid, model, base,
  hardware: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), freeBytesAtStart: os.freemem() },
  limitations: ["Development host, not certified production hardware", "Synthetic prompts only", "No database/session authority in live pipeline harness", "No packet capture or enforced egress firewall", "Raw Ollama streaming is not native Qorlla token streaming"], rows };
const save = () => { mkdirSync("docs/evidence", { recursive: true }); writeFileSync("docs/evidence/ollama-live.json", JSON.stringify(report, null, 2) + "\n"); };
const prompt = "Qorlla Workspace is an AI workspace with chat, projects, code assistance, and document search. Based only on those facts, explain what Qorlla Workspace does in two sentences.";
const request = (text = prompt) => ({ prompt: text, modelId: model, maxOutputTokens: 160 });
async function measure(name: string, work: () => Promise<unknown>) {
  const start = performance.now();
  try { const result = await work(); rows.push({ name, ok: true, ms: performance.now() - start, result }); save(); return result; }
  catch (e) { rows.push({ name, ok: false, ms: performance.now() - start, error: (e as Error).message }); save(); throw e; }
}

describe.skipIf(process.env.QORLLA_OLLAMA_LIVE !== "1")("real Ollama certification evidence", () => {
  beforeAll(async () => {
    for (const [key, value] of Object.entries({ AZ_PROVIDER_MODE: "ollama-only", OLLAMA_ENABLED: "true",
      OLLAMA_BASE_URL: base, OLLAMA_MODEL: model, OLLAMA_CONTEXT_TOKENS: "4096", OLLAMA_MAX_OUTPUT_TOKENS: "2048",
      OLLAMA_TIMEOUT_MS: "120000", AZ_DISPATCH_DEADLINE_MS: "120000", DATABASE_URL: "", CHAT_DEMO_MODE: "false",
      OPENAI_API_KEY: "certification-non-secret-canary", TAVILY_API_KEY: "certification-canary",
      PIPELINE_API_URL: "http://127.0.0.1:1", PIPELINE_API_TOKEN: "certification-canary", AZ_TOOL_LOOP: "off" })) vi.stubEnv(key, value);
    const response = await fetch(`${base}/api/tags`);
    const catalog = await response.json();
    report.catalog = catalog;
    const installed = catalog.models.find((m: any) => m.name === model);
    if (!installed) { save(); throw new Error("Candidate model not installed"); }
    report.digest = installed.digest;
    vi.stubEnv("OLLAMA_MODEL_DIGEST", installed.digest);
    report.ollamaVersion = await (await fetch(`${base}/api/version`)).json();
    save();
  }, 15000);
  afterAll(() => { report.finishedAt = new Date().toISOString(); save(); vi.unstubAllEnvs(); health.reset(); });

  it("native non-streaming inference", async () => {
    const result = await measure("native-non-streaming", () => ollamaBranch.run(request()));
    expect((result as any).text.length).toBeGreaterThan(0);
  }, 150000);

  it("real pipeline answer with cloud and context canaries configured", async () => {
    const actor = webActor(new Request("http://localhost:3000/api/chat", { headers: { host: "localhost:3000" } }),
      { id: "certification-user", name: "Certification", email: "certification@example.invalid", verified: true }).actor;
    const result: any = await measure("native-pipeline", () => answerChat({ mode: "chat", model: "auto",
      messages: [{ role: "user", content: prompt }] }, actor));
    expect(result.meta.provider).toBe("Ollama");
  }, 150000);

  it("missing model and changed digest fail closed", async () => {
    await measure("missing-model", async () => {
      await expect(ollamaBranch.run({ ...request(), modelId: "qorlla-certification-missing:never" })).rejects.toThrow("Ollama inference unavailable");
      return "controlled rejection";
    });
    const digest = process.env.OLLAMA_MODEL_DIGEST!;
    vi.stubEnv("OLLAMA_MODEL_DIGEST", "incorrect-digest");
    try { await measure("digest-mismatch", async () => {
      await expect(ollamaBranch.run(request())).rejects.toThrow("Ollama inference unavailable"); return "controlled rejection";
    }); } finally { vi.stubEnv("OLLAMA_MODEL_DIGEST", digest); }
  });

  it("in-flight cancellation and timeout", async () => {
    await measure("native-cancel", async () => {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 500);
      try { await expect(ollamaBranch.run({ ...request("Write a long essay about trees."), maxOutputTokens: 2048, signal: ctrl.signal })).rejects.toThrow(); }
      finally { clearTimeout(timer); }
      return "aborted by caller; server resource release needs separate verification";
    });
    vi.stubEnv("OLLAMA_TIMEOUT_MS", "50");
    try { await measure("native-timeout", async () => {
      await expect(ollamaBranch.run(request())).rejects.toThrow(); return "timeout rejected";
    }); } finally { vi.stubEnv("OLLAMA_TIMEOUT_MS", "120000"); }
  }, 10000);

  it("two simultaneous native requests", async () => {
    await measure("native-concurrency-2", async () => {
      const result = await Promise.all([ollamaBranch.run(request("Reply with the word READY.")), ollamaBranch.run(request("Reply with the word HEALTHY."))]);
      return result.map(r => r.text);
    });
  }, 150000);

  it("raw Ollama streaming latency and throughput samples", async () => {
    const samples: any[] = [];
    for (let i = 0; i < 5; i++) {
      await measure(`raw-stream-${i + 1}`, async () => {
        const start = performance.now(); let first: number | null = null; let text = ""; let final: any;
        const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Describe three uses of a local AI assistant in short sentences." }],
            stream: true, think: false, options: { num_ctx: 4096, num_predict: 80, temperature: 0, seed: 42 } }), signal: AbortSignal.timeout(120000) });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) {
          const { value, done } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop()!;
          for (const line of lines.filter(Boolean)) {
            const chunk = JSON.parse(line); if (chunk.error) throw new Error(chunk.error);
            if (chunk.message?.content) { first ??= performance.now() - start; text += chunk.message.content; }
            if (chunk.done) final = chunk;
          }
          if (done) break;
        }
        expect(final?.done).toBe(true); expect(first).not.toBeNull();
        const sample = { ttftMs: first, elapsedMs: performance.now() - start, outputTokens: final.eval_count,
          tokensPerSecond: final.eval_count / (final.eval_duration / 1e9), loadMs: final.load_duration / 1e6, text };
        samples.push(sample); return sample;
      });
    }
    const percentile = (key: string, p: number) => samples.map(x => x[key]).sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
    report.benchmark = { samples: samples.length, ttftP50Ms: percentile("ttftMs", .5), ttftP95Ms: percentile("ttftMs", .95),
      outputTokensPerSecondP50: percentile("tokensPerSecond", .5), sustainableCapacity: "not established", queueP95: "not instrumented" }; save();
  }, 660000);
});
