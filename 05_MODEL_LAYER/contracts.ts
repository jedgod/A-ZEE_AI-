// ============================================================
// 05_MODEL_LAYER / SHARED CONTRACTS
// File: lib/models/contracts.ts
// ============================================================

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type Request = {
  prompt: string;
  modelId: string;
  signal?: AbortSignal;
  // Optional multi-turn form. When present, `messages` (ending with the user turn) is sent
  // instead of `prompt`, and `system` carries server-built instructions (06_PROMPT_ENGINE).
  system?: string;
  messages?: readonly ChatTurn[];
  maxOutputTokens?: number;
};

/** The turns to send: the conversation if supplied, otherwise the single prompt. */
export function turnsOf(request: Request): ChatTurn[] {
  return request.messages?.length ? [...request.messages] : [{ role: "user", content: request.prompt }];
}

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
  if (request.prompt.length > 100_000 ||
      (request.messages ?? []).reduce((n, m) => n + m.content.length, 0) > 400_000) {
    throw new Error("Input exceeds application character limit");
  }
}

// Character limits are not token limits.
// Add tokenizer-based budgeting, authorization,
// rate limits, and provider-specific capability checks.
