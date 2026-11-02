// ============================================================
// 04_ROUTING / COST_OPTIMIZER
// File: lib/routing/cost_optimizer.ts — SERVER ONLY
// ============================================================

import "server-only";
import {
  Candidate, Requirements, eligible
} from "../contracts";

export function estimateUsd(
  model: Candidate, inputTokens: number, outputTokens: number
) {
  if (![model.inputUsdPerMillion, model.outputUsdPerMillion]
      .every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error("Invalid pricing");
  }
  return (
    inputTokens * model.inputUsdPerMillion +
    outputTokens * model.outputUsdPerMillion
  ) / 1000000;
}

export function runCostOptimizer(
  models: readonly Candidate[],
  request: Requirements,
  maxUsd: number
) {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error("Invalid spending limit");
  }
  const ranked = eligible(models, request)
    .map(model => ({
      model,
      estimatedUsd: estimateUsd(
        model, request.inputTokens, request.outputTokens
      ),
    }))
    .filter(item => item.estimatedUsd <= maxUsd)
    .sort((a, b) =>
      a.estimatedUsd - b.estimatedUsd ||
      b.model.qualityScore - a.model.qualityScore ||
      a.model.id.localeCompare(b.model.id)
    );

  if (!ranked.length) throw new Error("No eligible model within budget");
  return ranked[0];
}

// Illustrative text-token pricing only.
// Include tools, images, cached tokens, and reasoning charges
// where the provider bills them. Version and refresh pricing.
// Use model-specific token counts per candidate in production.
// Atomically reserve budget; reconcile with actual billed usage.
// Estimates are not a guaranteed maximum invoice.
