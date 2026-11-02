// ============================================================
// 05_MODEL_LAYER / GEMINI_BRANCH
// File: lib/models/gemini_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  Model, requiredEnv, validateRequest
} from "../contracts";

export const geminiBranch: Model = {
  async run(request) {
    validateRequest(request);
    const client = new GoogleGenAI({
      apiKey: requiredEnv("GOOGLE_API_KEY"),
    });

    const response = await client.models.generateContent({
      model: request.modelId,
      contents: request.prompt,
      config: {
        maxOutputTokens: 2048,
        httpOptions: {
          timeout: 60_000,
          abortSignal: request.signal,
        },
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Gemini returned no text");

    return {
      provider: "google",
      modelId: request.modelId,
      text,
    };
  },
};

// Pin an SDK version and integration-test cancellation,
// safety blocks, model availability, and output limits.
