import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import { turnsOf, validateRequest, type Model } from "../contracts";

// Native Qorlla port of the production candidate's src/ollama.mjs transport.
// Only server configuration may choose an upstream; callers cannot supply a URL.
export function ollamaConfig() {
  const url = new URL(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Ollama server configuration");
  }
  // Until remote private hosts have an authenticated allowlist, exclusive mode
  // accepts numeric loopback only (no DNS rebinding or public Ollama endpoints).
  if (ollamaOnly() && !["127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Ollama-only mode requires a numeric loopback endpoint");
  }
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] || fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  const contextWindow = integer("OLLAMA_CONTEXT_TOKENS", 32768, 1024, 1048576);
  const maxOutputTokens = integer("OLLAMA_MAX_OUTPUT_TOKENS", 8192, 1, contextWindow - 1);
  return { baseUrl: url.href.replace(/\/$/, ""), contextWindow, maxOutputTokens,
    timeoutMs: integer("OLLAMA_TIMEOUT_MS", 60000, 1, 600000) };
}

export const ollamaBranch: Model = {
  async run(request) {
    validateRequest(request);
    const config = ollamaConfig();
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error("Invalid Ollama output budget");
    try {
      const digest = process.env.OLLAMA_MODEL_DIGEST;
      if (ollamaOnly() || digest) {
        const tags = await fetch(`${config.baseUrl}/api/tags`, { signal, redirect: "error" });
        if (!tags.ok) throw new Error("Ollama catalog unavailable");
        const catalog = await tags.json();
        const model = catalog?.models?.find((m: { name?: string; model?: string }) => m.name === request.modelId || m.model === request.modelId);
        // Remote/cloud aliases must never silently proxy private prompts.
        if (!model || model.remote_host || model.remote_model || /(?:^|[-:])cloud(?:$|[-:])/i.test(request.modelId)) {
          throw new Error("Local Ollama model required");
        }
        if (digest && model.digest !== digest) throw new Error("Ollama model digest mismatch");
      }
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal,
        body: JSON.stringify({ model: request.modelId,
          messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...turnsOf(request)],
          stream: false, keep_alive: "5m", think: false,
          options: { num_predict: Math.min(maxTokens, config.maxOutputTokens), num_ctx: config.contextWindow },
        }),
      });
      if (!response.ok) throw new Error("Ollama inference unavailable");
      const payload = await response.json();
      if (payload?.done !== true || typeof payload?.message?.content !== "string" || !payload.message.content.trim()) {
        throw new Error("Invalid Ollama inference response");
      }
      return { provider: "ollama", modelId: request.modelId, text: payload.message.content };
    } catch {
      signal.throwIfAborted();
      // Never include upstream bodies, prompts, or network credentials in router logs.
      throw new Error("Ollama inference unavailable");
    }
  },
};
