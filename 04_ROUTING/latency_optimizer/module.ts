// ============================================================
// 04_ROUTING / LATENCY_OPTIMIZER
// File: lib/routing/latency_optimizer.ts — SERVER ONLY
// ============================================================

import "server-only";
import {
  Candidate, Requirements, eligible
} from "../contracts";

export function runLatencyOptimizer(
  models: readonly Candidate[],
  request: Requirements,
  targetMs: number,
  now = Date.now()
) {
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error("Invalid latency target");
  }

  const ranked = eligible(models, request)
    .filter(model =>
      model.p95LatencyMs !== null &&
      Number.isFinite(model.p95LatencyMs) &&
      model.p95LatencyMs > 0 &&
      model.p95LatencyMs <= targetMs &&
      model.telemetryAt !== null &&
      model.telemetryAt <= now &&
      now - model.telemetryAt <= 15 * 60 * 1000 &&
      model.latencySamples >= 100
    )
    .sort((a, b) =>
      a.p95LatencyMs! - b.p95LatencyMs! ||
      b.qualityScore - a.qualityScore ||
      a.id.localeCompare(b.id)
    );

  if (!ranked.length) throw new Error("No fresh eligible latency candidate");
  return ranked[0];
}

// p95 is a statistical observation, not a deadline guarantee.
// Segment by task, region, input/output size, and provider model.
// Record time-to-first-token separately from full completion.
// Enforce an actual deadline in the execution adapter.
