// ============================================================
// 01_INTAKE / PRIORITY / VALIDATION
// File: lib/intake/priority.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const prioritySchema = z.object({
  requested: z.enum(["low", "normal", "high"]),
  reason: z.string().trim().max(1000),
}).strict();

export function effectivePriority(
  requested: "low" | "normal" | "high",
  canExpedite: boolean
) {
  return requested === "high" && !canExpedite
    ? "normal" : requested;
}

export type PriorityInput =
  z.infer<typeof prioritySchema>;
