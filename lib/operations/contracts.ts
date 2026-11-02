// ============================================================
// SHARED / OPERATIONS CONTRACTS
// File: lib/operations/contracts.ts
// ============================================================

import { z } from "zod";

export type Auth = { userId: string; tenantId: string };

export function requireAuth(auth: Auth) {
  if (!auth.userId || !auth.tenantId) throw new Error("Unauthorized");
}

export const artifactSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  text: z.string().min(1).max(100000),
  citations: z.array(z.object({
    sourceId: z.string().min(1).max(200),
    url: z.string().url().max(2000),
  }).strict()).max(30),
  warnings: z.array(z.string().max(1000)).max(10),
  validationVersion: z.string().min(1).max(100),
}).strict();

export type Artifact = z.infer<typeof artifactSchema>;

export interface ArtifactRepository {
  // MUST enforce ownership and current delivery approval.
  readApproved(auth: Auth, artifactId: string): Promise<Artifact>;
}

export interface RecordRepository {
  // Table identifiers must be resolved from a server allowlist.
  insert(input: {
    auth: Auth; module: string; requestId: string;
    payload: unknown; expiresAt: string;
  }): Promise<{ id: string }>;
}

export function expiresIn(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

// Auth must originate from authenticated server state.
// All repositories enforce tenant/user/request ownership.
// Never use arbitrary table names from request JSON.
// Bound SQL parameters, encryption, deletion, and quotas are required.
