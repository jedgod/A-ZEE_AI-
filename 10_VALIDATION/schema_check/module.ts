// ============================================================
// 10_VALIDATION / SCHEMA_CHECK
// File: lib/reliability/schema_check.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type ModelAdapter, type EvidenceVerifier,
  generateValidated, textInput
} from "../../lib/reliability/contracts";

export function runSchemaCheck<T>(
  text: string, serverSchema: z.ZodType<T>
) {
  if (text.length > 100000) throw new Error("Output too large");
  const parsed: unknown = JSON.parse(text);
  return serverSchema.parse(parsed);
}

// Select schema from a server allowlist.
// Never accept executable schemas or arbitrary code from a client.
// Handle refusal/truncation before invoking this validator.
