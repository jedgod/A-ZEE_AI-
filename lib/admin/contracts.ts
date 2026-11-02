// ============================================================
// 15_ADMIN / API CONTRACTS
// ============================================================
import "server-only";
import { z } from "zod";

export const roleSchema = z.enum([
  "owner",
  "admin",
  "reviewer",
  "operator",
  "viewer",
]);
export type Role = z.infer<typeof roleSchema>;

export const permissionSchema = z.enum([
  "read",
  "users.write",
  "roles.write",
  "policies.write",
  "registry.write",
  "billing.write",
  "incidents.write",
  "approvals.write",
  "approvals.review",
]);
export type Permission = z.infer<typeof permissionSchema>;

export const moduleSchema = z.enum([
  "users",
  "roles",
  "policies",
  "registry",
  "billing",
  "incidents",
  "approvals",
  "tenants",
]);
export type Module = z.infer<typeof moduleSchema>;

export const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const updateSchema = z.object({
  revision: z.number().int().positive(),
  payload: z.unknown(),
}).strict();

export const decisionSchema = z.object({
  revision: z.number().int().positive(),
  decision: z.enum(["approved", "rejected"]),
}).strict();

const userPayloadSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
  status: z.enum(["active", "suspended"]).default("active"),
  displayName: z.string().trim().max(200).optional(),
  email: z.string().email().optional(),
}).strict();

const rolePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  permissions: z.array(permissionSchema).min(1).max(20),
}).strict();

const policyPayloadSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional(),
  enabled: z.boolean().default(true),
  target: z.enum(["tenant", "registry", "extensions", "billing"]).default("tenant"),
  rules: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

const registryPayloadSchema = z.object({
  name: z.string().trim().min(1).max(150),
  version: z.string().trim().min(1).max(50),
  kind: z.enum(["model", "tool", "prompt", "dataset"]).default("model"),
  enabled: z.boolean().default(false),
  sourceUrl: z.string().url().optional(),
}).strict();

const billingPayloadSchema = z.object({
  label: z.string().trim().min(1).max(150),
  currency: z.string().trim().toUpperCase().length(3),
  budget: z.number().nonnegative(),
  spend: z.number().nonnegative().default(0),
  status: z.enum(["active", "warning", "paused"]).default("active"),
}).strict();

const incidentPayloadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  status: z.enum(["open", "investigating", "resolved", "blocked"]).default("open"),
  ownerUserId: z.string().uuid(),
  summary: z.string().trim().max(4000).optional(),
}).strict();

const approvalPayloadSchema = z.object({
  resourceId: z.string().uuid(),
  resourceRevision: z.number().int().positive(),
  requestedBy: z.string().uuid(),
  reason: z.string().trim().min(1).max(4000),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

const tenantPayloadSchema = z.object({
  name: z.string().trim().min(1).max(150),
  status: z.enum(["active", "suspended"]).default("active"),
  ownerUserId: z.string().uuid(),
}).strict();

export type PayloadMap = {
  users: z.infer<typeof userPayloadSchema>;
  roles: z.infer<typeof rolePayloadSchema>;
  policies: z.infer<typeof policyPayloadSchema>;
  registry: z.infer<typeof registryPayloadSchema>;
  billing: z.infer<typeof billingPayloadSchema>;
  incidents: z.infer<typeof incidentPayloadSchema>;
  approvals: z.infer<typeof approvalPayloadSchema>;
  tenants: z.infer<typeof tenantPayloadSchema>;
};

export type Resource<K extends Module = Module> = {
  id: string;
  tenantId: string;
  module: K;
  payload: PayloadMap[K];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export function parsePayload<K extends Module>(module: K, raw: unknown): PayloadMap[K] {
  const schemas: Record<Module, z.ZodTypeAny> = {
    users: userPayloadSchema,
    roles: rolePayloadSchema,
    policies: policyPayloadSchema,
    registry: registryPayloadSchema,
    billing: billingPayloadSchema,
    incidents: incidentPayloadSchema,
    approvals: approvalPayloadSchema,
    tenants: tenantPayloadSchema,
  };
  return schemas[module].parse(raw) as PayloadMap[K];
}

// These contracts are intentionally strict and server-owned.
// Client-provided tenant selection is rejected; membership and role state are resolved from the session.
