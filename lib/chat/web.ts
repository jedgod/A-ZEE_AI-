import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { ProviderError } from "@/lib/chat/provider";
import { InputBlockedError, NotPermittedError, OutputBlockedError } from "@/lib/pipeline";
import { PlanLimitError, UpgradeRequiredError } from "@/lib/plans";

// Shared by the browser chat routes: /api/chat (JSON) and /api/chat/stream (SSE).

const localLimits = new Map<string, { count: number; reset: number }>();

/** Shared 20-requests/minute budget for public chat. */
export async function chatAllowed(request: Request) {
  // Only trust forwarding headers when the deployment proxy replaces them.
  const id = process.env.TRUST_PROXY === "true"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "public" : "public";
  const key = createHash("sha256").update(`chat:${id}`).digest("hex");
  if (process.env.DATABASE_URL) {
    const result = await pool.query(
      `INSERT INTO admin_rate_limits (key, bucket, hits) VALUES ($1, $2, 1)
       ON CONFLICT (key, bucket) DO UPDATE SET hits = admin_rate_limits.hits + 1 RETURNING hits`,
      [key, Math.floor(Date.now() / 60000)],
    );
    return result.rows[0].hits <= 20;
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_NOT_CONFIGURED");
  const now = Date.now();
  for (const [k, value] of localLimits) if (value.reset <= now) localLimits.delete(k);
  if (localLimits.size >= 10000 && !localLimits.has(key)) return false;
  const entry = localLimits.get(key) || { count: 0, reset: now + 60000 };
  entry.count++;
  localLimits.set(key, entry);
  return entry.count <= 20;
}

export const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === (process.env.APP_ORIGIN || "http://localhost:3000");
};

/** Maps a pipeline failure to the public error body and HTTP status (no internal details). */
export function chatError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof InputBlockedError) return { status: 422, body: { error: "INPUT_BLOCKED" } };
  if (error instanceof OutputBlockedError) return { status: 422, body: { error: "OUTPUT_BLOCKED" } };
  if (error instanceof UpgradeRequiredError) return { status: 403, body: { error: "UPGRADE_REQUIRED", feature: error.feature, plan: error.planName } };
  if (error instanceof PlanLimitError) return { status: 429, body: { error: "PLAN_LIMIT_REACHED", feature: error.feature, limit: error.limit, plan: error.planName } };
  if (error instanceof NotPermittedError) return { status: 403, body: { error: "NOT_PERMITTED", reasons: error.reasons } };
  if (error instanceof ProviderError) return { status: error.status, body: { error: error.code } };
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { status: 422, body: { error: "INVALID_INPUT" } };
  return { status: 503, body: { error: "SERVICE_UNAVAILABLE" } };
}
