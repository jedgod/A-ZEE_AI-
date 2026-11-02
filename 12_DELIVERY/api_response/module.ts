// ============================================================
// 12_DELIVERY / API_RESPONSE
// File: lib/operations/api_response.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

export async function runApiResponse(
  auth: Auth, artifactId: string, repository: ArtifactRepository
) {
  requireAuth(auth);
  z.string().uuid().parse(artifactId);
  const artifact = artifactSchema.parse(
    await repository.readApproved(auth, artifactId)
  );
  return Response.json(
    { schemaVersion: "1.0.0", data: artifact },
    { headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } }
  );
}

// Route maps typed failures to 401/403/404/422/429.
// Do not expose internal exceptions or credentials to callers.
