// ============================================================
// 04_ROUTING / MODEL_SELECTOR
// File: lib/routing/model_selector.ts — SERVER ONLY
// ============================================================

import "server-only";
import {
  Candidate, Requirements, eligible
} from "../contracts";

export function runModelSelector(
  registry: readonly Candidate[],
  request: Requirements
): Candidate {
  const candidates = eligible(registry, request);
  if (!candidates.length) {
    throw new Error("No policy-compliant model available");
  }
  return candidates.sort((a, b) =>
    b.qualityScore - a.qualityScore || a.id.localeCompare(b.id)
  )[0];
}

// The registry is a server-side allowlist of exact model IDs.
// Verify quality scores against your task evaluation set.
// Add circuit-breaker health checks before dispatch.
// Never loosen residency or authorization when selection fails.
