// ============================================================
// 05_MODEL_LAYER / GROK_BRANCH
// File: lib/models/grok_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import OpenAI from "openai";
import {
  Model, requiredEnv, validateRequest
} from "../contracts";

export const grokBranch: Model = {
  async run(request) {
    validateRequest(request);
    const client = new OpenAI({
      apiKey: requiredEnv("XAI_API_KEY"),
      baseURL: "https://api.x.ai/v1",
      timeout: 60_000,
      maxRetries: 2,
    });

    const response = await client.chat.completions.create({
      model: request.modelId,
      messages: [{ role: "user", content: request.prompt }],
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
