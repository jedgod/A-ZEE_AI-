// ============================================================
// 01_INTAKE / TASK_TYPE / VALIDATION
// File: lib/intake/task_type.ts
// Dependency: zod
// ============================================================

import { z } from "zod";

export const taskTypeSchema = z.object({
  type: z.enum([
    "question_answering", "summarization", "writing",
    "coding", "extraction", "planning", "other",
  ]),
}).strict();

export type TaskTypeInput =
  z.infer<typeof taskTypeSchema>;
