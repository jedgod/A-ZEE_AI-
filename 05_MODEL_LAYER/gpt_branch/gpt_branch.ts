// ============================================================
// 05_MODEL_LAYER / GPT_BRANCH
// File: lib/models/gpt_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import OpenAI from "openai";
import {
  Model, requiredEnv, turnsOf, validateRequest
} from "../contracts";

export const gptBranch: Model = {
  async run(request) {
    validateRequest(request);
    const client = new OpenAI({
      apiKey: requiredEnv("OPENAI_API_KEY"),
      timeout: 60_000,
      // 04_ROUTING/fallback_policy owns retries; nested SDK retries would multiply attempts.
      maxRetries: 0,
    });

    const response = await client.responses.create({
      model: request.modelId,
      ...(request.system ? { instructions: request.system } : {}),
      input: turnsOf(request),
      max_output_tokens: request.maxOutputTokens ?? 2048,
    }, { signal: request.signal });

    const text = response.output_text?.trim();
    if (!text) throw new Error("OpenAI returned no text");

    return {
      provider: "openai",
      modelId: request.modelId,
      text,
    };
  },
};

// Call from an authenticated server route.
// Use a server-side model allowlist; never accept
// arbitrary client model IDs without validation.
