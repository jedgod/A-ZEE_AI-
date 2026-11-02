// ============================================================
// 13_FEEDBACK / USER_RATING
// File: lib/operations/user_rating.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runUserRating(
  auth: Auth, raw: unknown, repository: RecordRepository
) {
  requireAuth(auth);
  const input = z.object({
    requestId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
  }).strict().parse(raw);
  return repository.insert({
    auth, module: "user_rating", requestId: input.requestId,
    payload: { rating: input.rating }, expiresAt: expiresIn(90),
  });
}

// Enforce request ownership and one current rating per owner/request.
// Add an idempotent upsert in your repository if edits are allowed.
