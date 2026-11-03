import "server-only";
import type { ModelDefinition } from "@/00_META/model_registry";
import type { Capability } from "@/00_META/shared";
import type { Candidate, Task } from "@/04_ROUTING/contracts";
import type { Model } from "@/05_MODEL_LAYER/contracts";
import { compatibleBranch } from "@/05_MODEL_LAYER/compatible_branch/compatible_branch";
import { geminiBranch } from "@/05_MODEL_LAYER/gemini_branch/gemini_branch";
import { gptBranch } from "@/05_MODEL_LAYER/gpt_branch/gpt_branch";
import { grokBranch } from "@/05_MODEL_LAYER/grok_branch/grok_branch";

// The server-side allowlist of providers. Order is the default priority.
// Prices default to 0 (unknown); set AZ_PRICE_<ID>="input,output" (USD per million tokens)
// to let 00_META/04_ROUTING budget checks use real numbers.
type ProviderSpec = { id: string; label: string; keyEnv: string; modelEnv: string; defaultModel: string; adapter: Model };

const SPECS: ProviderSpec[] = [
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", defaultModel: "gpt-4o-mini", adapter: gptBranch },
  { id: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", defaultModel: "claude-sonnet-4-5",
    adapter: compatibleBranch({ provider: "anthropic", url: "https://api.anthropic.com/v1/messages", keyEnv: "ANTHROPIC_API_KEY", dialect: "anthropic" }) },
  { id: "xai", label: "xAI", keyEnv: "XAI_API_KEY", modelEnv: "XAI_MODEL", defaultModel: "grok-4-fast-non-reasoning", adapter: grokBranch },
  { id: "gemini", label: "Gemini", keyEnv: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", defaultModel: "gemini-3.5-flash", adapter: geminiBranch },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL", defaultModel: "openai/gpt-oss-120b",
    adapter: compatibleBranch({ provider: "groq", url: "https://api.groq.com/openai/v1/chat/completions", keyEnv: "GROQ_API_KEY", dialect: "openai" }) },
  { id: "mistral", label: "Mistral", keyEnv: "MISTRALAI_API_KEY", modelEnv: "MISTRAL_MODEL", defaultModel: "mistral-small-latest",
    adapter: compatibleBranch({ provider: "mistral", url: "https://api.mistral.ai/v1/chat/completions", keyEnv: "MISTRALAI_API_KEY", dialect: "openai" }) },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTERAI_API_KEY", modelEnv: "OPENROUTER_MODEL", defaultModel: "openrouter/auto",
    adapter: compatibleBranch({ provider: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", keyEnv: "OPENROUTERAI_API_KEY", dialect: "openai" }) },
  { id: "together", label: "Together", keyEnv: "TOGETHERAI_API_KEY", modelEnv: "TOGETHER_MODEL", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    adapter: compatibleBranch({ provider: "together", url: "https://api.together.xyz/v1/chat/completions", keyEnv: "TOGETHERAI_API_KEY", dialect: "openai" }) },
];

// Providers tried first for "AZ · Code" (05_MODEL_LAYER/specialist_models). Override with AZ_CODE_PROVIDERS.
const DEFAULT_CODE_PROVIDERS = ["groq", "gemini"];

export type Provider = {
  id: string;
  label: string;
  providerModel: string;
  adapter: Model;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  priority: number;
};

// live_search: models synthesize from retrieved sources (00_META scope enables it only while a search adapter is configured).
const CAPABILITIES: Capability[] = ["conversation", "code_assistance", "research", "file_context", "live_search"];
const TASKS: Task[] = ["qa", "summarize", "write", "code", "extract", "other"];
const CONTEXT_WINDOW = 128_000;
const MAX_OUTPUT = 8_192;

function price(id: string): [number, number] {
  const raw = process.env[`AZ_PRICE_${id.toUpperCase()}`];
  const parts = raw?.split(",").map(Number);
  return parts?.length === 2 && parts.every(n => Number.isFinite(n) && n >= 0) ? [parts[0], parts[1]] : [0, 0];
}

/**
 * Providers with a key, minus AZ_DISABLED_PROVIDERS (comma-separated ids). Disabling keeps the key
 * available for other uses, e.g. an OpenAI key without chat credits still serves free moderation.
 */
export function configuredProviders(): Provider[] {
  const disabled = new Set((process.env.AZ_DISABLED_PROVIDERS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
  return SPECS.filter(spec => process.env[spec.keyEnv] && !disabled.has(spec.id)).map((spec, index) => {
    const [input, output] = price(spec.id);
    return {
      id: spec.id, label: spec.label, adapter: spec.adapter,
      providerModel: process.env[spec.modelEnv] || spec.defaultModel,
      inputUsdPerMillion: input, outputUsdPerMillion: output, priority: (index + 1) * 10,
    };
  });
}

export function codeProviderIds(): string[] {
  return (process.env.AZ_CODE_PROVIDERS?.split(",").map(s => s.trim()).filter(Boolean)) ?? DEFAULT_CODE_PROVIDERS;
}

/** 00_META model registry entries for the configured providers. */
export function metaRegistry(providers: Provider[]): ModelDefinition[] {
  return providers.map(p => ({
    id: p.id, provider: "openai-compatible", providerModel: p.providerModel,
    enabled: true, productionReady: true, external: true,
    capabilities: CAPABILITIES, classifications: ["public", "internal"],
    contextWindow: CONTEXT_WINDOW, maxOutputTokens: MAX_OUTPUT, priority: p.priority,
    inputUsdPerMillion: p.inputUsdPerMillion, outputUsdPerMillion: p.outputUsdPerMillion,
  }));
}

/** 04_ROUTING candidates, with live latency telemetry from the health tracker. */
export function routingCandidates(providers: Provider[], tenantId: string, capability: Capability): Candidate[] {
  return providers.map(p => {
    const stats = health.stats(p.id);
    return {
      id: p.id, enabled: true, verified: true, allowedTenantIds: [tenantId],
      tasks: TASKS, capabilities: [capability], region: "global", contextTokens: CONTEXT_WINDOW,
      // No versioned evaluation exists yet, so every provider gets the same neutral score.
      qualityScore: 0.5,
      inputUsdPerMillion: p.inputUsdPerMillion, outputUsdPerMillion: p.outputUsdPerMillion,
      p95LatencyMs: stats.p95, telemetryAt: stats.at, latencySamples: stats.samples,
    };
  });
}

/**
 * In-process provider health: recent failures demote a provider for a cool-down period, and
 * successful latencies feed 04_ROUTING/latency_optimizer. Per server instance, not shared.
 */
class HealthTracker {
  private failedAt = new Map<string, number>();
  private latencies = new Map<string, { values: number[]; at: number }>();
  static COOL_DOWN_MS = 5 * 60_000;

  success(id: string, ms: number) {
    this.failedAt.delete(id);
    const entry = this.latencies.get(id) ?? { values: [], at: 0 };
    entry.values.push(ms);
    if (entry.values.length > 500) entry.values.shift();
    entry.at = Date.now();
    this.latencies.set(id, entry);
  }

  failure(id: string) { this.failedAt.set(id, Date.now()); }

  coolingDown(id: string, now = Date.now()) {
    const at = this.failedAt.get(id);
    return at !== undefined && now - at < HealthTracker.COOL_DOWN_MS;
  }

  stats(id: string) {
    const entry = this.latencies.get(id);
    if (!entry?.values.length) return { p95: null, at: null, samples: 0 };
    const sorted = [...entry.values].sort((a, b) => a - b);
    return { p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], at: entry.at, samples: sorted.length };
  }

  reset() { this.failedAt.clear(); this.latencies.clear(); }
}

export const health = new HealthTracker();
