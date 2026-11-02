// ============================================================
// 09_GENERATION / VARIANTS
// File: lib/reliability/variants.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runVariants(raw: unknown, model: ModelAdapter) {
  const input = z.object({
    task: textInput,
    count: z.number().int().min(2).max(3),
  }).strict().parse(raw);
  const schema = z.object({
    variants: z.array(z.object({
      label: z.string().min(1).max(100),
      text: z.string().min(1).max(6000),
    }).strict()).length(input.count),
  }).strict();
  return generateValidated(
    model, "Create the requested number of distinct answer drafts.",
    input, schema
  );
}
