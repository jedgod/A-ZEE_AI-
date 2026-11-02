// ============================================================
// 14_OBSERVABILITY / PROMPTS_LOG
// File: lib/operations/prompts_log.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runPromptsLog(
  auth: Auth, raw: unknown, repository: RecordRepository
) {
  requireAuth(auth);
  const input = z.object({
    requestId: z.string().uuid(),
    templateVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    inputTokens: z.number().int().min(0).max(10000000),
  }).strict().parse(raw);
  return repository.insert({
    auth, module: "prompts_log", requestId: input.requestId,
    payload: {
      templateVersion: input.templateVersion,
      inputTokens: input.inputTokens,
    },
    expiresAt: expiresIn(30),
  });
}

// Do not include raw prompt text, private reasoning, or secrets.
// Token counts come from provider usage or a verified tokenizer.
