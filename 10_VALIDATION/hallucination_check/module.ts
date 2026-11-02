// ============================================================
// 10_VALIDATION / HALLUCINATION_CHECK
// File: lib/reliability/hallucination_check.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export function runHallucinationCheck(raw: unknown) {
  const statuses = z.array(
    z.enum(["supported", "contradicted", "unknown"])
  ).max(100).parse(raw);

  const supported = statuses.filter(s => s === "supported").length;
  const contradicted = statuses.filter(s => s === "contradicted").length;
  const unknown = statuses.filter(s => s === "unknown").length;

  return {
    assessedClaims: statuses.length,
    supported, contradicted, unknown,
    outcome: !statuses.length ? "unassessed"
      : contradicted > 0 ? "conflict"
      : unknown > 0 ? "evidence_gap" : "checked_claims_supported",
  };
}

// Claim extraction coverage must be evaluated separately.
// All checked claims supported does NOT mean hallucination-free.
