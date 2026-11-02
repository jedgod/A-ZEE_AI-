// ============================================================
// 01_INTAKE / CONSTRAINTS / VALIDATION
// File: lib/intake/constraints.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const constraintsSchema = z.object({
  maxOutputTokens: z.number().int().min(128).max(8192),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  format: z.enum(["text", "markdown", "json"]),
}).strict();

// Provider adapters must enforce token budgets.
// JSON output still requires downstream schema validation.

export type ConstraintsInput =
  z.infer<typeof constraintsSchema>;
