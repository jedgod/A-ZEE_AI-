// ============================================================
// 01_INTAKE / INTENT / VALIDATION
// File: lib/intake/intent.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const intentSchema = z.object({
  goal: z.string().trim().min(1).max(2000),
  needsClarification: z.enum(["no", "yes"]),
}).strict();

export type IntentInput =
  z.infer<typeof intentSchema>;
