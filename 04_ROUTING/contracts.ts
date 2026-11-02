// ============================================================
// 04_ROUTING / SHARED CONTRACTS
// File: lib/routing/contracts.ts
// ============================================================

export type Task =
  | "qa" | "summarize" | "write" | "code" | "extract" | "other";

export type Candidate = {
  id: string;
  enabled: boolean;
  verified: boolean;
  allowedTenantIds: readonly string[];
  tasks: readonly Task[];
  capabilities: readonly string[];
  region: string;
  contextTokens: number;
  qualityScore: number; // measured against a versioned eval
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  p95LatencyMs: number | null;
  telemetryAt: number | null;
  latencySamples: number;
};

export type Requirements = {
  tenantId: string;
  task: Task;
  capabilities: readonly string[];
  region: string;
  inputTokens: number;
  outputTokens: number;
  minQuality: number;
};

export function eligible(
  models: readonly Candidate[], request: Requirements
): Candidate[] {
  if (!request.tenantId ||
      !Number.isInteger(request.inputTokens) ||
      !Number.isInteger(request.outputTokens) ||
      request.inputTokens < 0 || request.outputTokens < 1 ||
      !Number.isFinite(request.minQuality)) {
    throw new Error("Invalid routing requirements");
  }

  return models.filter(model =>
    model.enabled && model.verified &&
    model.allowedTenantIds.includes(request.tenantId) &&
    model.tasks.includes(request.task) &&
    request.capabilities.every(c => model.capabilities.includes(c)) &&
    model.region === request.region &&
    model.contextTokens >= request.inputTokens + request.outputTokens &&
    Number.isFinite(model.qualityScore) &&
    model.qualityScore >= request.minQuality
  );
}

// Build these objects from trusted server configuration.
// Count tokens per provider/model; do not accept client counts.
// Revalidate eligibility immediately before every dispatch.
