// ============================================================
// 08_REASONING / SELF_CRITIQUE
// File: lib/reliability/self_critique.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runSelfCritique(
  raw: unknown, model: ModelAdapter
) {
  const draft = textInput.parse(raw);
  return generateValidated(
    model,
    "Review the draft for omissions and unsupported claims. Return concise review notes.",
    { draft },
    z.object({
      issues: z.array(z.string().min(1).max(1000)).max(10),
      suggestedRevision: z.string().max(5000),
    }).strict()
  );
}

// A same-model critique is not an independent quality assessment.
// Do not expose or log private internal reasoning.
