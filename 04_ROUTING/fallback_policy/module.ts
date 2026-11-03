// ============================================================
// 04_ROUTING / FALLBACK_POLICY
// File: lib/routing/fallback_policy.ts — SERVER ONLY
// ============================================================

import "server-only";
export type FailureKind =
  | "transient" | "invalid" | "safety" | "authorization";

export class DispatchError extends Error {
  constructor(public kind: FailureKind, message: string) {
    super(message);
  }
}

type Target = { id: string };
type Execute<T> = (
  target: Target, signal: AbortSignal
) => Promise<T>;

export async function runFallbackPolicy<T>(
  approvedTargets: readonly Target[],
  execute: Execute<T>,
  parentSignal?: AbortSignal,
  deadlineMs = 30000
): Promise<{ value: T; modelId: string; attempts: number }> {
  if (!approvedTargets.length) throw new Error("No approved targets");
  const targets = approvedTargets.slice(0, 3);
  const deadline = AbortSignal.timeout(deadlineMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, deadline]) : deadline;

  for (let index = 0; index < targets.length; index++) {
    signal.throwIfAborted();
    try {
      const value = await execute(targets[index], signal);
      return {
        value, modelId: targets[index].id, attempts: index + 1,
      };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof DispatchError) ||
          error.kind !== "transient" ||
          index === targets.length - 1) throw error;
    }
  }
  throw new Error("Fallback exhausted");
}

// Requires a runtime supporting AbortSignal.any/timeout.
// Adapters must honor cancellation and classify failures.
// Only transient network/service failures qualify.
// Recheck eligibility and reserve budget before EACH attempt.
// Do not replay side-effecting tools without idempotency keys.
// Prevent nested SDK retries from multiplying the attempt budget.
