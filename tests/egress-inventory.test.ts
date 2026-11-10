import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Inventory of every external HOST named in server-side source. A new outbound destination fails this test until it is reviewed and classified here, so an
// external AI provider (or any other data egress) cannot be added silently to a deployment that promises AZ_PROVIDER_MODE=ollama-only.
//   ai-cloud   : sends prompt content to a third-party model/service; MUST be unreachable in ollama-only mode
//   data       : reads/sends user data to a third-party service; MUST be unreachable in ollama-only mode
//   non-ai     : billing / mail / OAuth / links; not an AI path, but still needs a host-level egress allowlist in staging
//   reference  : a URL that is only text (links, schema names), never fetched by the server
const APPROVED: Record<string, { kind: "ai-cloud" | "data" | "non-ai" | "reference"; note: string }> = {
  "api.anthropic.com": { kind: "ai-cloud", note: "registry provider" }, "api.groq.com": { kind: "ai-cloud", note: "registry provider" }, "api.mistral.ai": { kind: "ai-cloud", note: "registry provider" },
  "api.together.xyz": { kind: "ai-cloud", note: "registry provider" }, "openrouter.ai": { kind: "ai-cloud", note: "registry provider" }, "api.x.ai": { kind: "ai-cloud", note: "grok adapter" },
  "api.openai.com": { kind: "ai-cloud", note: "moderation (gated inline in validation.ts) and the openai adapter" },
  "api.tavily.com": { kind: "data", note: "web search (searchConfigured/ollamaOnly)" }, "tavily.com": { kind: "reference", note: "link text" },
  "accounts.google.com": { kind: "data", note: "Drive connector OAuth (assertConnectorsAllowed)" }, "oauth2.googleapis.com": { kind: "data", note: "Drive connector OAuth" },
  "openidconnect.googleapis.com": { kind: "data", note: "Drive connector OAuth" }, "www.googleapis.com": { kind: "data", note: "Drive/Gmail connectors" }, "gmail.googleapis.com": { kind: "data", note: "Gmail connector" },
  "api.github.com": { kind: "data", note: "GitHub connector" }, "github.com": { kind: "data", note: "GitHub connector / links" }, "drive.google.com": { kind: "reference", note: "link text" },
  "api.stripe.com": { kind: "non-ai", note: "billing (only when Stripe is configured)" }, "api.resend.com": { kind: "non-ai", note: "transactional email" },
  "aztrade.internal": { kind: "reference", note: "private AZTrade bridge placeholder host" },
};
const ROOTS = ["app", "lib", "05_MODEL_LAYER", "07_TOOLS", "15_EXTENSIONS", "15_ADMIN"];
const skip = (f: string) => /\.(test|spec)\./.test(f) || /[\\/](node_modules|\.next|components)[\\/]/.test(f);
function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) { const p = path.join(dir, e); const s = statSync(p); if (s.isDirectory()) { if (e !== "node_modules" && e !== ".next") yield* walk(p); } else if (/\.(ts|tsx)$/.test(e) && !skip(p)) yield p; }
}
const root = path.resolve(__dirname, "..");
function hosts(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of ROOTS) { const d = path.join(root, r); try { statSync(d); } catch { continue; }
    for (const f of walk(d)) for (const m of readFileSync(f, "utf8").matchAll(/https?:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g)) {
      const h = m[1].toLowerCase(); if (/^(example\.|www\.w3\.org|json-schema|schema\.org|localhost|127\.0\.0\.1)/.test(h) || /\.example\.|\.test$|^docs\./.test(h)) continue;
      (out.get(h) ?? out.set(h, []).get(h)!).push(path.relative(root, f).replace(/\\/g, "/")); } }
  return out;
}

describe("outbound host inventory", () => {
  const found = hosts();
  it("every external host named in server code is reviewed and classified", () => {
    const unknown = [...found.keys()].filter((h) => !APPROVED[h]);
    expect(unknown, `new outbound host(s) ${unknown.join(", ")} need review: classify them in tests/egress-inventory.test.ts and gate ai-cloud/data hosts on ollama-only`).toEqual([]);
  });
  it("every ai-cloud or data destination lives in a file that checks the ollama-only policy", () => {
    const GATE = /ollamaOnly|requireCloudInferenceAllowed|AZ_PROVIDER_MODE|assertConnectorsAllowed|searchConfigured|EXTERNAL_DATA_DISABLED/;
    // Reviewed: these files only BUILD display links for citations (no fetch in the file), so the host there is text, not egress.
    const LINK_TEXT_ONLY = new Set(["lib/search-index/service.ts"]);
    const ungated: string[] = [];
    for (const [h, files] of found) { const kind = APPROVED[h]?.kind; if (kind !== "ai-cloud" && kind !== "data") continue;
      for (const f of new Set(files)) if (!LINK_TEXT_ONLY.has(f) && !GATE.test(readFileSync(path.join(root, f), "utf8")) && !/registry\.ts$|connectors[\\/]|connectors\//.test(f)) ungated.push(`${h} in ${f}`); }
    expect(ungated).toEqual([]);
  });
  it("the provider registry builds no external provider in ollama-only mode even when every key is present", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { AZ_PROVIDER_MODE: "ollama-only", OLLAMA_ENABLED: "true", OLLAMA_MODEL: "qwen2.5:1.5b", OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      OPENAI_API_KEY: "k", GEMINI_API_KEY: "k", GROQ_API_KEY: "k", MISTRALAI_API_KEY: "k", OPENROUTERAI_API_KEY: "k", TOGETHERAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", XAI_API_KEY: "k", GOOGLE_API_KEY: "k" });
    try {
      const reg = await import("@/lib/pipeline/registry") as Record<string, any>;
      expect((reg.configuredProviders() as { id: string }[]).map((p) => p.id)).toEqual(["ollama"]);
    } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  });
});
