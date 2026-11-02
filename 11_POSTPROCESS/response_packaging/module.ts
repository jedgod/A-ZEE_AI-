// ============================================================
// 11_POSTPROCESS / RESPONSE_PACKAGING
// File: lib/operations/response_packaging.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runResponsePackaging(
  auth: Auth, artifactId: string, repository: ArtifactRepository
) {
  requireAuth(auth);
  z.string().uuid().parse(artifactId);
  const artifact = artifactSchema.parse(
    await repository.readApproved(auth, artifactId)
  );
  return { schemaVersion: "1.0.0", ...artifact };
}
