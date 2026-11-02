// ============================================================
// 07_TOOLS / EXTERNAL_APIS
// File: lib/07_tools/external_apis.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({
  operation: z.literal("order_status"),
  orderId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
}).strict();

export interface OrderApi {
  status(input: {
    tenantId: string; userId: string; orderId: string;
    timeoutMs: number;
  }): Promise<{ status: string; updatedAt: string }>;
}

export async function runExternalApis(
  auth: AuthContext, raw: unknown, api: OrderApi
) {
  requirePermission(auth, "tools:orders:read");
  const input = schema.parse(raw);
  const result = await api.status({
    tenantId: auth.tenantId, userId: auth.userId,
    orderId: input.orderId, timeoutMs: 8000,
  });
  return z.object({
    status: z.string().max(100),
    updatedAt: z.string().datetime(),
  }).strict().parse(result);
}

// Adapter uses a fixed endpoint and server-stored credentials.
// Verify object ownership before contacting the provider.
// Redact responses and enforce timeouts, rate limits, and quotas.
// Mutating operations need explicit approval + idempotency keys.
