// ============================================================
// 14_OBSERVABILITY / TRACES
// File: lib/operations/traces.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface TraceSink {
  emit(input: {
    traceId: string; spanId: string; operation: string;
    durationMs: number; status: "ok" | "error";
  }): Promise<void>;
}

export async function runTraces(raw: unknown, sink: TraceSink) {
  const span = z.object({
    traceId: z.string().regex(/^[a-f0-9]{32}$/),
    spanId: z.string().regex(/^[a-f0-9]{16}$/),
    operation: z.enum(["retrieve", "generate", "validate", "deliver"]),
    durationMs: z.number().finite().min(0).max(3600000),
    status: z.enum(["ok", "error"]),
  }).strict().parse(raw);
  await sink.emit(span);
  return { recorded: true };
}

// Prefer OpenTelemetry for propagation and span lifecycle.
// Generate IDs server-side; limit retention and sampling.
