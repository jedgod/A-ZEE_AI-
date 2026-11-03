// ============================================================
// 10_VALIDATION / QUALITY_SCORE
// File: lib/reliability/quality_score.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export function runQualityScore(raw: unknown) {
  const input = z.object({
    relevance: z.number().finite().min(0).max(1),
    completeness: z.number().finite().min(0).max(1),
    evidence: z.number().finite().min(0).max(1),
    clarity: z.number().finite().min(0).max(1),
    policyAllowed: z.boolean(),
    verificationPassed: z.boolean(),
  }).strict().parse(raw);

  const score = Math.round(100 * (
    input.relevance * 0.3 +
    input.completeness * 0.25 +
    input.evidence * 0.3 +
    input.clarity * 0.15
  ));

  return {
    rubricVersion: "1.0.0", score,
    eligibleForDelivery: input.policyAllowed &&
      input.verificationPassed && score >= 80,
  };
}

// Threshold and weights are application-specific.
// Assess dimensions against a versioned evaluation rubric.
// Do not populate these values with uncalibrated model confidence.

// ------------------------------------------------------------
// Structural rubric (wired into lib/pipeline/index.ts; buckets shown in /insights).
// Measures visible structure only, never truth or model confidence. Uncalibrated until its
// score buckets are compared with real 13_FEEDBACK ratings.
// ------------------------------------------------------------
export const STRUCTURE_RUBRIC = "structure-v1";

export type StructuralQuality = {
  rubric: typeof STRUCTURE_RUBRIC;
  score: number;
  checks: { name: string; pass: boolean; weight: number }[];
  calibrated: false;
};

export function structuralQuality(answer: string, refs: {
  sourcesRetrieved: number; citations: number; unsupported: number;
}): StructuralQuality {
  const text = answer.trim();
  const checks = [
    { name: "nonempty", pass: text.length > 0, weight: 20 },
    { name: "bounded_length", pass: text.length <= 12000, weight: 20 },
    { name: "no_placeholder", pass: !/\b(TODO|PLACEHOLDER|lorem ipsum)\b/i.test(text), weight: 20 },
    // Source checks only apply when 07 search retrieved something to cite.
    ...(refs.sourcesRetrieved > 0 ? [
      { name: "has_source_reference", pass: refs.citations > 0, weight: 20 },
      { name: "valid_reference_ids", pass: refs.unsupported === 0, weight: 20 },
    ] : []),
  ];
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const passed = checks.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  return { rubric: STRUCTURE_RUBRIC, score: text ? Math.round(100 * passed / total) : 0, checks, calibrated: false };
}

/** Descriptive helpful-rate per score bucket (not a calibration certificate). */
export function ratingBuckets(rows: { score: number; helpful: boolean }[]) {
  return [0, 20, 40, 60, 80].map(low => {
    const sample = rows.filter(r => r.score >= low && (low === 80 ? r.score <= 100 : r.score < low + 20));
    return {
      low, high: low + 20, count: sample.length,
      helpfulRate: sample.length ? sample.filter(r => r.helpful).length / sample.length : null,
    };
  });
}
