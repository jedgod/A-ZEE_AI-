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
