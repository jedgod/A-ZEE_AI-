// ============================================================
// 06_PROMPT_ENGINE / DEVELOPER_PROMPT
// File: lib/06_prompt_engine/developer_prompt.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import type { Message } from "../../lib/execution/contracts";

const profileSchema = z.enum(["support", "engineering", "research"]);
const profiles = {
  support: "Answer clearly. Ask for missing account context. Do not invent account data.",
  engineering: "State assumptions, provide testable code, and flag security-sensitive changes.",
  research: "Separate sourced facts from interpretation. Cite source identifiers.",
} as const;

export function buildDeveloperPrompt(raw: unknown): Message {
  const profile = profileSchema.parse(raw);
  return { role: "developer", content: profiles[profile] };
}

// Map developer roles only where the target API supports them.
// Profile selection must obey server-side application permissions.
// Do not concatenate untrusted text into privileged instructions.
