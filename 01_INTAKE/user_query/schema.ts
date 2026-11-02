// ============================================================
// 01_INTAKE / USER_QUERY / VALIDATION
// File: lib/intake/user_query.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const userQuerySchema = z.object({
  text: z.string().trim().min(1).max(50000),
}).strict();

export type UserQueryInput =
  z.infer<typeof userQuerySchema>;
