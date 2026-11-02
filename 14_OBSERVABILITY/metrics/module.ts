// ============================================================
// 14_OBSERVABILITY / METRICS
// File: lib/operations/metrics.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface MetricSink {
  record(input: {
    name: "request_duration_ms" | "request_count";
    value: number; outcome: "success" | "failure";
  }): Promise<void>;
}

export async function runMetrics(raw: unknown, sink: MetricSink) {
  const input = z.object({
    name: z.enum(["request_duration_ms", "request_count"]),
    value: z.number().finite().min(0).max(3600000),
    outcome: z.enum(["success", "failure"]),
  }).strict().parse(raw);
  if (input.name === "request_count" && input.value !== 1) {
    throw new Error("Request counter increments must equal one");
  }
  await sink.record(input);
  return { recorded: true };
}

// Collect from trusted server instrumentation only.
// Export metrics to a dedicated telemetry backend, not per-event SQL.
