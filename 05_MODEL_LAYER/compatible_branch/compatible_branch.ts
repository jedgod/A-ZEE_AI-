// ============================================================
// 05_MODEL_LAYER / COMPATIBLE_BRANCH
// File: lib/models/compatible_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import { requireCloudInferenceAllowed } from "@/lib/pipeline/privacy";
import {
  Model, requiredEnv, turnsOf, validateRequest
} from "../contracts";

/** Thrown for non-2xx provider responses; `status` lets routing classify the failure. */
export class ProviderHttpError extends Error {
  constructor(public provider: string, public status: number) {
    super(`${provider} returned HTTP ${status}`);
  }
}

type Endpoint = {
  provider: string;
  url: string;
  keyEnv: string;
  dialect: "openai" | "anthropic";
};

/**
 * A branch for providers that speak the OpenAI chat-completions dialect (Groq, Mistral,
 * OpenRouter, Together) or Anthropic's Messages API, using plain fetch (no SDK).
 */
export function compatibleBranch(endpoint: Endpoint): Model {
  return {
    async run(request) {
      requireCloudInferenceAllowed();
      validateRequest(request);
      const key = requiredEnv(endpoint.keyEnv);
      const anthropic = endpoint.dialect === "anthropic";
      const turns = turnsOf(request);
      const maxTokens = request.maxOutputTokens ?? 2048;
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(anthropic
            ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
            : { Authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify(anthropic
          ? { model: request.modelId, max_tokens: maxTokens, ...(request.system ? { system: request.system } : {}), messages: turns }
          : { model: request.modelId, max_tokens: maxTokens,
              messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...turns] }),
        signal: request.signal,
      });
      if (!response.ok) throw new ProviderHttpError(endpoint.provider, response.status);
      const body = await response.json();
      const text = (anthropic
        ? body.content?.filter((b: { text?: unknown }) => typeof b.text === "string").map((b: { text: string }) => b.text).join("\n")
        : body.choices?.[0]?.message?.content)?.trim();
      if (!text) throw new Error(`${endpoint.provider} returned no text`);
      return { provider: endpoint.provider, modelId: request.modelId, text };
    },
  };
}

// Endpoints are a fixed server allowlist; never build URLs from client input.
// Keys come from server environment only.
