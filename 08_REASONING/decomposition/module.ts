// ============================================================
// 08_REASONING / DECOMPOSITION
// File: lib/reliability/decomposition.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runDecomposition(
  raw: unknown, model: ModelAdapter
) {
  const task = textInput.parse(raw);
  const schema = z.object({
    subtasks: z.array(z.object({
      id: z.string().min(1).max(40),
      objective: z.string().min(1).max(1000),
    }).strict()).min(1).max(8),
  }).strict();
  const result = await generateValidated(
    model, "Decompose the task into actionable subtasks.", { task }, schema
  );
  if (new Set(result.subtasks.map(t => t.id)).size !== result.subtasks.length) {
    throw new Error("Duplicate subtask IDs");
  }
  return result;
}
