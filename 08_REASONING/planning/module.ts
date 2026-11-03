// ============================================================
// 08_REASONING / PLANNING
// File: lib/reliability/planning.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runPlanning(raw: unknown, model: ModelAdapter) {
  const task = textInput.parse(raw);
  const schema = z.object({
    steps: z.array(z.object({
      action: z.string().min(1).max(1000),
      acceptanceCriterion: z.string().min(1).max(1000),
      requiresApproval: z.boolean(),
    }).strict()).min(1).max(10),
  }).strict();
  return generateValidated(
    model,
    // State the exact shape: models otherwise guess field names and types, failing validation.
    'Provide an ordered work plan (1-10 steps) with testable acceptance criteria. Return {"steps":[{"action":"...","acceptanceCriterion":"...","requiresApproval":false}]}.',
    { task }, schema
  );
}

// Approval flags are hints. Server policy independently determines
// which operations require approval. A plan grants no permissions.
