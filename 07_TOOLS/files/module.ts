// ============================================================
// 07_TOOLS / FILES
// File: lib/07_tools/files.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({
  fileId: z.string().uuid(),
}).strict();

export interface FileRepository {
  readApprovedText(input: {
    tenantId: string; userId: string; fileId: string;
    maxBytes: number;
  }): Promise<{ text: string; sourceId: string }>;
}

export async function runFiles(
  auth: AuthContext, raw: unknown, repository: FileRepository
) {
  requirePermission(auth, "tools:files:read");
  const input = schema.parse(raw);
  return repository.readApprovedText({
    tenantId: auth.tenantId, userId: auth.userId,
    fileId: input.fileId, maxBytes: 100000,
  });
}

// Repository must enforce ownership, scan status, MIME signature,
// actual byte limits, and approved text extraction.
// Block symlinks/path traversal; never accept absolute paths.
// File writes/deletion need separate permissions and approval.
