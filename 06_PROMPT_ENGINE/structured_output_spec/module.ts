// ============================================================
// 06_PROMPT_ENGINE / STRUCTURED_OUTPUT_SPEC
// File: lib/06_prompt_engine/structured_output_spec.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";

export const answerSchema = z.object({
  answer: z.string().min(1).max(20000),
  citations: z.array(z.string().max(500)).max(30),
  warnings: z.array(z.string().max(1000)).max(10),
}).strict();

export const answerJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "citations", "warnings"],
  additionalProperties: false,
} as const;

export function parseStructuredOutput(text: string) {
  if (text.length > 100000) throw new Error("Output too large");
  return answerSchema.parse(JSON.parse(text));
}

// Pass the JSON schema through the provider's supported API.
// Handle refusals and truncation BEFORE attempting JSON parsing.
// Validate citations against sources actually supplied to the model.
