// ============================================================
// 10_VALIDATION / FACTUAL_CHECK
// File: lib/reliability/factual_check.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export async function runFactualCheck(
  raw: unknown, verifier: EvidenceVerifier
) {
  const claims = z.array(z.object({
    claim: z.string().min(1).max(2000),
    sourceIds: z.array(z.string().max(200)).max(10),
  }).strict()).min(1).max(30).parse(raw);

  const results = [];
  for (const claim of claims) {
    const checked = z.object({
      status: z.enum(["supported", "contradicted", "unknown"]),
      checkedSourceIds: z.array(z.string().max(200)).max(10),
    }).strict().parse(await verifier.check(claim.claim, claim.sourceIds));
    if (checked.checkedSourceIds.some(id => !claim.sourceIds.includes(id))) {
      throw new Error("Verifier returned an undeclared source");
    }
    if (checked.status !== "unknown" && !checked.checkedSourceIds.length) {
      throw new Error("Evidence status requires checked sources");
    }
    results.push({ claim: claim.claim, ...checked });
  }
  return { results };
}
