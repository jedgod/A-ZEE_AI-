// ============================================================
// 09_GENERATION / STYLE_CONTROL
// File: lib/reliability/style_control.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runStyleControl(raw: unknown, model: ModelAdapter) {
  const input = z.object({
    text: textInput,
    style: z.enum(["concise", "formal", "plain_language"]),
  }).strict().parse(raw);
  return generateValidated(
    model,
    "Rewrite using the requested style. Preserve facts, caveats, and citations.",
    input,
    z.object({ text: z.string().min(1).max(20000) }).strict()
  );
}

// Style transfer can still change meaning. Revalidate factual claims.

// ------------------------------------------------------------
// Composer tone picker (wired into lib/pipeline/index.ts).
// The validated enum selects a fixed instruction; no user text reaches the system prompt.
// ------------------------------------------------------------
import { ANSWER_STYLES, type AnswerStyle } from "../../lib/chat/contracts";

const STYLE_INSTRUCTIONS: Record<Exclude<AnswerStyle, "default">, string> = {
  concise: "Answer briefly. Prefer direct sentences; omit unnecessary preambles.",
  professional: "Use a measured professional tone and a clear logical structure.",
  friendly: "Be approachable and warm without sacrificing precision.",
  technical: "Use precise technical language; explain assumptions and limitations.",
};

/** The style instruction for a tone, or null for "default" (no instruction added). */
export function styleInstruction(style: AnswerStyle = "default"): string | null {
  const parsed = z.enum(ANSWER_STYLES).parse(style);
  return parsed === "default" ? null : `Answer style: ${STYLE_INSTRUCTIONS[parsed]}`;
}
