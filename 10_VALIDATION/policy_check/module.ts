// ============================================================
// 10_VALIDATION / POLICY_CHECK
// File: lib/reliability/policy_check.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export interface PolicyChecker {
  check(text: string): Promise<{
    decision: "allow" | "block" | "review";
    reasons: string[];
  }>;
}

export async function runPolicyCheck(raw: unknown, checker: PolicyChecker) {
  const text = textInput.parse(raw);
  try {
    return z.object({
      decision: z.enum(["allow", "block", "review"]),
      reasons: z.array(z.string().max(500)).max(20),
    }).strict().parse(await checker.check(text));
  } catch {
    return { decision: "review" as const, reasons: ["policy_check_unavailable"] };
  }
}

// Backend must block delivery for block/review until authorized resolution.
// Prompt-based compliance alone is not policy enforcement.
