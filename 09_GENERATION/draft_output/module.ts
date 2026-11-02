// ============================================================
// 09_GENERATION / DRAFT_OUTPUT
// File: lib/reliability/draft_output.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runDraftOutput(raw: unknown, model: ModelAdapter) {
  const task = textInput.parse(raw);
  return generateValidated(
    model, "Create a draft answer. Disclose missing information.",
    { task },
    z.object({
      draft: z.string().min(1).max(20000),
      warnings: z.array(z.string().max(1000)).max(10),
    }).strict()
  );
}

// Run policy and factual validation before final delivery.
