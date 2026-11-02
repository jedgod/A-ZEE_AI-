// ============================================================
// 05_MODEL_LAYER / SHARED CONTRACTS
// File: lib/models/contracts.ts
// ============================================================

export type Request = {
  prompt: string;
  modelId: string;
  signal?: AbortSignal;
};

export type Result = {
  provider: string;
  modelId: string;
  text: string;
};

export interface Model {
  run(request: Request): Promise<Result>;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Missing server configuration: " + name);
  return value;
}

export function validateRequest(request: Request) {
  if (!request.prompt.trim() || !request.modelId.trim()) {
    throw new Error("Prompt and model ID are required");
  }
  if (request.prompt.length > 100_000) {
    throw new Error("Input exceeds application character limit");
  }
}

// Character limits are not token limits.
// Add tokenizer-based budgeting, authorization,
// rate limits, and provider-specific capability checks.
