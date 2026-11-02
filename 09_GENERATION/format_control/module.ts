// ============================================================
// 09_GENERATION / FORMAT_CONTROL
// File: lib/reliability/format_control.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export function runFormatControl(raw: unknown) {
  const input = z.object({
    format: z.enum(["text", "json"]),
    answer: z.string().min(1).max(20000),
    citations: z.array(z.string().max(500)).max(30),
  }).strict().parse(raw);

  const body = input.format === "json"
    ? JSON.stringify({ answer: input.answer, citations: input.citations })
    : input.answer + (input.citations.length
      ? "\n\nSources:\n" + input.citations.join("\n") : "");

  return {
    contentType: input.format === "json"
      ? "application/json" : "text/plain; charset=utf-8",
    body,
  };
}

// Render text as text, never unsanitized HTML.
