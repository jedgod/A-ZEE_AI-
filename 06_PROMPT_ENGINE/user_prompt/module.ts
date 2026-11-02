// ============================================================
// 06_PROMPT_ENGINE / USER_PROMPT
// File: lib/06_prompt_engine/user_prompt.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import type { Message } from "../../lib/execution/contracts";

const schema = z.object({
  text: z.string().trim().min(1).max(50000),
}).strict();

export function buildUserPrompt(raw: unknown): Message {
  const input = schema.parse(raw);
  return { role: "user", content: input.text };
}

// Apply model-specific token budgeting after packaging.
// Character limits do not imply token limits.
// Redact sensitive data where required before provider dispatch.
