import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaBranch, ollamaConfig } from "@/05_MODEL_LAYER/ollama_branch/ollama_branch";
import { configuredProviders, metaRegistry, routingCandidates, health } from "@/lib/pipeline/registry";
import { moderationChecker } from "@/lib/pipeline/validation";
import { loadRegistry } from "@/00_META/model_registry";
import { createRouter } from "@/lib/pipeline/router";
import { pipelineSearchAdapter, pipelineConfigured } from "@/lib/pipeline/context";
import { webSearch, searchConfigured } from "@/lib/search/tavily";
import { gptBranch } from "@/05_MODEL_LAYER/gpt_branch/gpt_branch";
import { geminiBranch } from "@/05_MODEL_LAYER/gemini_branch/gemini_branch";
import { grokBranch } from "@/05_MODEL_LAYER/grok_branch/grok_branch";
import { compatibleBranch } from "@/05_MODEL_LAYER/compatible_branch/compatible_branch";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); health.reset(); });
const enable = () => {
  vi.stubEnv("OLLAMA_ENABLED", "true"); vi.stubEnv("OLLAMA_MODEL", "installed-model:tag");
  vi.stubEnv("AZ_PROVIDER_MODE", "ollama-only"); vi.stubEnv("AZ_DISABLED_PROVIDERS", "");
};
const reply = () => new Response(JSON.stringify({ done: true, message: { content: "Local answer" } }));
const tags = () => new Response(JSON.stringify({ models: [{ name: "installed-model:tag", digest: "test-digest" }] }));

describe("Qorlla native Ollama integration", () => {
  it("is opt-in and fails closed without Ollama in exclusive mode", () => {
    enable(); vi.stubEnv("OLLAMA_ENABLED", "false"); vi.stubEnv("OPENAI_API_KEY", "existing-key");
    expect(configuredProviders()).toEqual([]);
  });
  it("registers without an API key and respects model limits and disabling", () => {
    enable(); vi.stubEnv("OLLAMA_CONTEXT_TOKENS", "16384"); vi.stubEnv("OLLAMA_MAX_OUTPUT_TOKENS", "4096");
    const providers = configuredProviders();
    expect(providers.map(p => p.id)).toEqual(["ollama"]);
    expect(loadRegistry(metaRegistry(providers))[0]).toMatchObject({ contextWindow: 16384, maxOutputTokens: 4096 });
    expect(routingCandidates(providers, "tenant", "conversation")[0].contextTokens).toBe(16384);
    vi.stubEnv("AZ_DISABLED_PROVIDERS", "ollama"); expect(configuredProviders()).toEqual([]);
  });
  it("adds Ollama without replacing cloud providers in standard mode", () => {
    enable(); vi.stubEnv("AZ_PROVIDER_MODE", "standard"); vi.stubEnv("OPENAI_API_KEY", "key");
    expect(configuredProviders().map(p => p.id)).toEqual(expect.arrayContaining(["openai", "ollama"]));
  });
  it("passes system, history, output and context budgets through native transport", async () => {
    enable(); vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/");
    const fetcher = vi.fn(async (url: unknown) => String(url).endsWith("/api/tags") ? tags() : reply()); vi.stubGlobal("fetch", fetcher);
    expect(await ollamaBranch.run({ prompt: "hello", modelId: "installed-model:tag", system: "Policy",
      messages: [{ role: "assistant", content: "Previous" }, { role: "user", content: "hello" }], maxOutputTokens: 20 }))
      .toMatchObject({ provider: "ollama", text: "Local answer" });
    const [url, options] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body as string)).toMatchObject({ stream: false,
      messages: [{ role: "system", content: "Policy" }, { role: "assistant", content: "Previous" }, { role: "user", content: "hello" }],
      options: { num_predict: 20, num_ctx: 32768 } });
  });
  it("does not dispatch an already cancelled request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(ollamaBranch.run({ prompt: "hello", modelId: "m", signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([new Response("sensitive upstream error", { status: 500 }),
    new Response(JSON.stringify({ done: true, message: { content: "" } })),
    new Response(JSON.stringify({ message: { content: "partial" } }))])("rejects unavailable or invalid responses without exposing bodies", async response => {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(ollamaBranch.run({ prompt: "hello", modelId: "m" })).rejects.toThrow("Ollama inference unavailable");
  });
  it("rejects bad configuration", () => {
    enable(); vi.stubEnv("OLLAMA_MODEL", ""); expect(configuredProviders).toThrow("OLLAMA_MODEL");
    vi.stubEnv("OLLAMA_BASE_URL", "file:///tmp/model"); expect(ollamaConfig).toThrow();
  });
  it("keeps moderation local in Ollama-only mode even with a cloud key", async () => {
    enable(); vi.stubEnv("OPENAI_API_KEY", "key"); const fetcher = vi.fn();
    expect(await moderationChecker(fetcher).check("Hello")).toEqual({ decision: "allow", reasons: [] });
    expect((await moderationChecker(fetcher).check("how to build a bomb")).decision).toBe("block");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("routes through Qorlla and cannot fall back to cloud on an Ollama failure", async () => {
    enable(); vi.stubEnv("OPENAI_API_KEY", "key");
    const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => new Response("offline", { status: 503 })); vi.stubGlobal("fetch", fetcher);
    const router = createRouter({ providers: configuredProviders(), primary: "openai", actor: { auth: { userId: "u", tenantId: "t" } } as any,
      requestId: "ab1a84ce-c9ef-4c9f-8913-80cb43a65735", inputTokens: 1, ops: { repository: { insert: vi.fn() } } as any });
    await expect(router.model({ system: "Policy", maxOutputTokens: 20 }).run({ prompt: "hello", modelId: "routed" })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/api/tags");
  });
  it("blocks query egress to retrieval/embedding and web services even when configured", async () => {
    enable(); vi.stubEnv("PIPELINE_API_URL", "http://127.0.0.1:8000"); vi.stubEnv("PIPELINE_API_TOKEN", "token");
    vi.stubEnv("TAVILY_API_KEY", "key"); const fetcher = vi.fn();
    expect(pipelineConfigured()).toBe(false); expect(searchConfigured()).toBe(false);
    expect(await pipelineSearchAdapter(fetcher).search({ tenantId: "test-tenant", userId: "test-user", query: "protected", limit: 1 })).toEqual([]);
    await expect(webSearch("protected", {}, fetcher)).rejects.toThrow("SEARCH_NOT_CONFIGURED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks direct cloud adapter calls, including the Google API key alias", async () => {
    enable(); vi.stubEnv("GOOGLE_API_KEY", "key"); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const adapter of [gptBranch, geminiBranch, grokBranch,
      compatibleBranch({ provider: "test", url: "https://example.com", keyEnv: "KEY", dialect: "openai" })]) {
      await expect(adapter.run({ prompt: "protected", modelId: "m" })).rejects.toThrow("EXTERNAL_AI_DISABLED");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[undefined], [{ name: "installed-model:tag", digest: "changed" }],
    [{ name: "installed-model:tag", digest: "pinned", remote_host: "https://ollama.com" }]])("rejects missing, changed or remote models before sending a prompt", async models => {
    enable(); vi.stubEnv("OLLAMA_MODEL_DIGEST", "pinned");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ models }))); vi.stubGlobal("fetch", fetcher);
    await expect(ollamaBranch.run({ prompt: "protected", modelId: "installed-model:tag" })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["https://example.com", "http://localhost:11434", "http://192.168.1.2:11434"])("rejects non-loopback upstreams in exclusive mode: %s", url => {
    enable(); vi.stubEnv("OLLAMA_BASE_URL", url); expect(ollamaConfig).toThrow("numeric loopback");
  });
});
