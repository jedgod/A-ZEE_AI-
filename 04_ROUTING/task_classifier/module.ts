// ============================================================
// 04_ROUTING / TASK_CLASSIFIER
// File: lib/routing/task_classifier.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import type { Task } from "../contracts";

const schema = z.object({
  query: z.string().trim().min(1).max(50000),
  declaredTask: z.enum([
    "qa", "summarize", "write", "code", "extract", "other",
  ]).optional(),
}).strict();

export function runTaskClassifier(raw: unknown): {
  task: Task;
  source: "user_declared" | "unresolved";
  needsClarification: boolean;
} {
  const input = schema.parse(raw);
  const task = input.declaredTask ?? "other";
  return {
    task,
    source: input.declaredTask ? "user_declared" : "unresolved",
    needsClarification: task === "other",
  };
}

// For automatic classification, inject an evaluated classifier,
// validate its schema, and calibrate abstention thresholds.
// A declared task is a routing hint, never permission to act.
