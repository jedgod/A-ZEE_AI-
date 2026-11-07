import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { answerChat } from "@/lib/pipeline";
import { accessFor } from "@/lib/plans";
import { actorFor, allow, requireUser } from "@/lib/users/auth";
import { UserError } from "@/lib/users/types";
import { buildPrompt, parseReplies, TIERS, tierForPlan, TONES, trimContext } from "./policy";

// AZLinqext reply assist: POST /api/linqext/replies drafts a reply to a message the user selected.
// It never sends anything; the keyboard shows the draft and the user chooses to insert it.
// Identity, plan, moderation, PII redaction and the monthly quota are all A-Zee's own (the request
// goes through the same pipeline as chat, and counts as one message).

export const replySchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  context: z.array(z.object({ role: z.enum(["self", "other"]), text: z.string().max(2000) }).strict()).max(20).default([]),
  tone: z.enum(TONES).default("professional"),
  customTone: z.string().max(120).optional(),
  variants: z.number().int().min(1).max(5).default(1),
  consent: z.literal(true),
}).strict();

const STALE_RUNNING_SECONDS = 60;
const RETENTION_DAYS = 7;

export class LinqextError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); }
}

export async function entitlementsFor(request: Request) {
  const user = await requireUser(request);
  const { actor } = await actorFor(request);
  const access = await accessFor(actor);
  const tier = tierForPlan(access.planId);
  return { user, tier, plan: access.planName, features: TIERS[tier], monthlyReplies: access.entitlements.messages?.monthlyLimit ?? null };
}

export async function createReply(request: Request, raw: unknown) {
  const user = await requireUser(request, true);
  if (!await allow("linqext", user.id, 20)) throw new UserError(429, "RATE_LIMITED");
  const input = replySchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  const { actor } = await actorFor(request);
  const access = await accessFor(actor);
  const tier = tierForPlan(access.planId);
  const policy = TIERS[tier];
  if (!policy.tones.includes(input.tone) || input.variants > policy.variants) throw new LinqextError(403, "FEATURE_NOT_IN_PLAN", { tier, plan: access.planName });

  // Claim the request id. A retry of a finished request replays its answer; a different body under
  // the same id is refused; a failed or abandoned attempt may be taken over.
  await pool.query(`DELETE FROM linqext_requests WHERE created_at < now() - make_interval(days => $1)`, [RETENTION_DAYS]).catch(() => undefined);
  const claimed = await pool.query(
    `INSERT INTO linqext_requests (user_id, request_id, payload_hash, status) VALUES ($1, $2, $3, 'running') ON CONFLICT DO NOTHING RETURNING 1`,
    [user.id, input.requestId, hash]);
  if (!claimed.rowCount) {
    const row = (await pool.query(`SELECT payload_hash, status, response FROM linqext_requests WHERE user_id = $1 AND request_id = $2`, [user.id, input.requestId])).rows[0];
    if (row?.payload_hash !== hash) throw new LinqextError(409, "IDEMPOTENCY_CONFLICT");
    if (row.status === "completed") return { replay: true, result: row.response };
    const taken = await pool.query(
      `UPDATE linqext_requests SET status = 'running', created_at = now()
       WHERE user_id = $1 AND request_id = $2 AND (status = 'failed' OR (status = 'running' AND created_at < now() - make_interval(secs => $3))) RETURNING 1`,
      [user.id, input.requestId, STALE_RUNNING_SECONDS]);
    if (!taken.rowCount) throw new LinqextError(409, "REQUEST_IN_PROGRESS");
  }

  try {
    const prompt = buildPrompt(tier, input.tone, input.customTone, input.variants, input.message, trimContext(input.context, tier));
    const { answer } = await answerChat({ mode: "chat", model: "auto", messages: [{ role: "user", content: prompt }] }, actor);
    const replies = parseReplies(answer, input.variants, policy.maxWords);
    if (!replies) throw new LinqextError(503, "REPLY_GENERATION_UNAVAILABLE");
    const result = { requestId: input.requestId, tier, replies, insertRequiresUserAction: true };
    await pool.query(`UPDATE linqext_requests SET status = 'completed', response = $3 WHERE user_id = $1 AND request_id = $2`, [user.id, input.requestId, JSON.stringify(result)]);
    return { replay: false, result };
  } catch (error) {
    // The pipeline has already refunded the usage it reserved; free the request id for a retry.
    await pool.query(`UPDATE linqext_requests SET status = 'failed' WHERE user_id = $1 AND request_id = $2 AND status = 'running'`, [user.id, input.requestId]).catch(() => undefined);
    throw error;
  }
}
