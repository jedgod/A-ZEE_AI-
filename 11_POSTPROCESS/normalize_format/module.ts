// ============================================================
// 11_POSTPROCESS / NORMALIZE_FORMAT
// File: lib/operations/normalize_format.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export function runNormalizeFormat(raw: unknown) {
  const input = z.object({
    format: z.enum(["text", "json"]),
    text: z.string().min(1).max(100000),
  }).strict().parse(raw);
  return {
    contentType: input.format === "json"
      ? "application/json" : "text/plain; charset=utf-8",
    body: input.format === "json"
      ? JSON.stringify({ text: input.text }) : input.text,
  };
}
