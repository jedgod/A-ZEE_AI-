// ============================================================
// 11_POSTPROCESS / TRANSLATION
// File: lib/operations/translation.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export interface Translator {
  translate(input: {
    text: string; targetLanguage: string;
  }): Promise<string>;
}

export async function runTranslation(raw: unknown, adapter: Translator) {
  const input = z.object({
    text: z.string().min(1).max(20000),
    targetLanguage: z.enum(["en", "es", "fr", "de", "ja"]),
  }).strict().parse(raw);
  const text = z.string().min(1).max(40000)
    .parse(await adapter.translate(input));
  return { text, language: input.targetLanguage, requiresRevalidation: true };
}

// Enforce provider deadlines and budgets in the adapter.
// Recheck policy, meaning, terminology, and citations before delivery.
