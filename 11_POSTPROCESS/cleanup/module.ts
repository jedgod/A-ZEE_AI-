// ============================================================
// 11_POSTPROCESS / CLEANUP
// File: lib/operations/cleanup.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export function runCleanup(raw: unknown) {
  const text = z.string().min(1).max(100000).parse(raw);
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

// Preserve code indentation and intentional spacing.
// Cleanup is not HTML sanitization or factual validation.
