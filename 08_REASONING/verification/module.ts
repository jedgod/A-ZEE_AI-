// ============================================================
// 08_REASONING / VERIFICATION
// File: lib/reliability/verification.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export interface CheckRunner {
  run(id: string): Promise<"pass" | "fail" | "unknown">;
}

export async function runVerification(raw: unknown, runner: CheckRunner) {
  const ids = z.array(z.string().min(1).max(100)).min(1).max(20).parse(raw);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate checks");
  const checks = [];
  for (const id of ids) {
    const status = z.enum(["pass", "fail", "unknown"])
      .parse(await runner.run(id));
    checks.push({ id, status });
  }
  return {
    passed: checks.every(check => check.status === "pass"),
    checks,
  };
}

// Runner enforces authorization, deadlines, and sandbox boundaries.
// Unknown is not a successful verification.
