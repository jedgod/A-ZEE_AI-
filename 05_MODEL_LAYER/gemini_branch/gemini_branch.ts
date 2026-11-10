// ============================================================
// 05_MODEL_LAYER / GEMINI_BRANCH
// File: lib/models/gemini_branch.ts — SERVER ONLY
// ============================================================

import "server-only";
import { requireCloudInferenceAllowed } from "@/lib/pipeline/privacy";
import { GoogleGenAI } from "@google/genai";
import {
  Model, requiredEnv, turnsOf, validateRequest
} from "../contracts";

export const geminiBranch: Model = {
  async run(request) {
    requireCloudInferenceAllowed();
    validateRequest(request);
    const client = new GoogleGenAI({
      // Accept the Google SDK's variable name or this app's GEMINI_API_KEY.
      apiKey: process.env.GOOGLE_API_KEY || requiredEnv("GEMINI_API_KEY"),
    });

    const response = await client.models.generateContent({
      model: request.modelId,
      contents: turnsOf(request).map(turn => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      config: {
        ...(request.system ? { systemInstruction: request.system } : {}),
        maxOutputTokens: request.maxOutputTokens ?? 2048,
        // In @google/genai 2.x the abort signal is a request-config field, not an HTTP option.
        abortSignal: request.signal,
        httpOptions: {
          timeout: 60_000,
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
