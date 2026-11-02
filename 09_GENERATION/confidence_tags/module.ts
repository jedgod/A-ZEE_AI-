// ============================================================
// 09_GENERATION / CONFIDENCE_TAGS
// File: lib/reliability/confidence_tags.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export function runConfidenceTags(raw: unknown) {
  const statuses = z.array(
    z.enum(["supported", "contradicted", "unknown"])
  ).max(100).parse(raw);

  if (!statuses.length) return { tag: "unassessed" as const };
  if (statuses.includes("contradicted")) {
    return { tag: "conflicting_evidence" as const };
  }
  if (statuses.includes("unknown")) {
    return { tag: "partial_evidence" as const };
  }
  return { tag: "supported_by_checked_sources" as const };
}

// Caller must supply statuses from an authorized evidence verifier.
// These tags are not calibrated probabilities or truth guarantees.
