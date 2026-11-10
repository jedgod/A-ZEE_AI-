// ============================================================
// 05_MODEL_LAYER / GROK_BRANCH
// File: lib/models/grok_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import { requireCloudInferenceAllowed } from "@/lib/pipeline/privacy";
import OpenAI from "openai";
import {
  Model, requiredEnv, turnsOf, validateRequest
} from "../contracts";

export const grokBranch: Model = {
  async run(request) {
    requireCloudInferenceAllowed();
    validateRequest(request);
    const client = new OpenAI({
      apiKey: requiredEnv("XAI_API_KEY"),
      baseURL: "https://api.x.ai/v1",
      timeout: 60_000,
      // 04_ROUTING/fallback_policy owns retries; nested SDK retries would multiply attempts.
      maxRetries: 0,
    });

    const response = await client.chat.completions.create({
      model: request.modelId,
      messages: [
        ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
        ...turnsOf(request),
      ],
      max_tokens: request.maxOutputTokens ?? 2048,
    }, { signal: request.signal });

    const text = response.choices[0]?.message.content?.trim();
    if (!text) throw new Error("xAI returned no text");

    return {
      provider: "xai",
      modelId: request.modelId,
      text,
    };
  },
};

// Configure output-token limits using parameters supported
// by your selected xAI model. Verify API compatibility.
