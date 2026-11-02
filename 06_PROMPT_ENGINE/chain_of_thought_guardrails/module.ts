// ============================================================
// 06_PROMPT_ENGINE / CHAIN_OF_THOUGHT_GUARDRAILS
// File: lib/06_prompt_engine/chain_of_thought_guardrails.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import type { Message } from "../../lib/execution/contracts";

export function buildReasoningGuardrails(): Message {
  return {
    role: "developer",
    content: [
      "Return the answer with key assumptions and a concise rationale.",
      "Provide relevant calculations, citations, or test results.",
      "Do not provide private internal reasoning or hidden chain-of-thought.",
      "If uncertain, state the uncertainty and propose a verification step.",
    ].join("\n"),
  };
}

export function publicAnswerOnly(
  result: { answer: string; citations?: string[] }
) {
  return {
    answer: result.answer,
    citations: result.citations ?? [],
  };
}

// This helper is not a leakage detector.
// Validate provider output schemas and avoid logging raw responses
// containing provider-specific internal or sensitive fields.
// Store final outputs and operational traces only.
