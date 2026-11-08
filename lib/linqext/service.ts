import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { answerChat } from "@/lib/pipeline";
import { webActor } from "@/lib/pipeline/actor";
import { accessFor, usageFor } from "@/lib/plans";
import { allow } from "@/lib/users/auth";
import { UserError, type SessionUser } from "@/lib/users/types";
import { getConsent } from "./consent";
import { linqextUser } from "./keyboard-auth";
import { buildPrompt, parseReplies, TIERS, tierForPlan, TONES, trimContext } from "./policy";

// AZLinqext reply assist: POST /api/linqext/replies drafts a reply to a message the user selected.
// It never sends anything; the keyboard shows the draft and the user chooses to insert it.
// Identity, plan, moderation, PII redaction and the monthly quota are all A-Zee's own (the request
// goes through the same pipeline as chat, and counts as one message). Callers are the app (its
// session) or the keyboard (its scoped link, lib/linqext/keyboard-auth.ts).

export const replySchema = z.object({
  requestId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
  context: z.array(z.object({ role: z.enum(["self", "other"]), text: z.string().max(2000) }).strict()).max(20).default([]),
  tone: z.enum(TONES).default("professional"),
  customTone: z.string().max(120).optional(),
  variants: z.number().int().min(1).max(5).default(1),
  consent: z.literal(true),
  // tap: the user pressed Suggest. typing: the keyboard asked after a pause in typing (needs its own consent).
  trigger: z.enum(["tap", "typing"]).default("tap"),
}).strict().refine(r => r.trigger === "tap" || r.variants === 1, { message: "typing suggestions are one reply", path: ["variants"] });

const STALE_RUNNING_SECONDS = 60;
const RETENTION_DAYS = 7;
const MAX_IN_FLIGHT = 3; // generations one user may have running at once
// Typing-triggered suggestions each cost a reply, so the server paces and caps them itself (the keyboard also debounces).
export const TYPING_MIN_INTERVAL_SECONDS = 10;
export const TYPING_DAILY_CAP: Record<"free" | "plus" | "premium", number> = { free: 20, plus: 100, premium: 300 };

export class LinqextError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); }
}

const monthReset = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString(); };

export async function entitlementsFor(request: Request) {
  const user = await linqextUser(request, false);
  const { actor } = webActor(request, user);
  const access = await accessFor(actor);
  const tier = tierForPlan(access.planId);
  const limit = access.entitlements.messages?.monthlyLimit ?? null;
  const used = (await usageFor(access.subject)).messages ?? 0;
  const consent = await getConsent(user.id);
  return {
    tier, plan: access.planName, features: TIERS[tier], consent,
    typing: { minIntervalSeconds: TYPING_MIN_INTERVAL_SECONDS, dailyCap: TYPING_DAILY_CAP[tier] },
    usage: { used, limit, remaining: limit === null ? null : Math.max(limit - used, 0), resetsAt: monthReset() },
  };
}

export async function createReply(request: Request, raw: unknown) {
  const user: SessionUser = await linqextUser(request, true);
  if (!await allow("linqext", user.id, 20)) throw new UserError(429, "RATE_LIMITED");
  const input = replySchema.parse(raw);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  const { actor } = webActor(request, user);
  const access = await accessFor(actor);
  const tier = tierForPlan(access.planId);
  const policy = TIERS[tier];
  if (!policy.tones.includes(input.tone) || input.variants > policy.variants) throw new LinqextError(403, "FEATURE_NOT_IN_PLAN", { tier, plan: access.planName });
  // Server-side consent: the client's `consent: true` is not enough. Earlier messages are used only if agreed separately.
  const consent = await getConsent(user.id);
  if (!consent.replyAssist) throw new LinqextError(403, "CONSENT_REQUIRED", { version: consent.version });
  if (input.trigger === "typing" && !consent.typing) throw new LinqextError(403, "CONSENT_REQUIRED", { version: consent.version, scope: "typing" });
  const context = consent.context ? trimContext(input.context, tier) : [];

  // Claim the request id. A retry of a finished request replays its answer; a different body under
  // the same id is refused; a failed or abandoned attempt may be taken over. (user_id, request_id)
  // is the table's primary key, so two simultaneous requests can never both claim it.
  await pool.query(`DELETE FROM linqext_requests WHERE created_at < now() - make_interval(days => $1)`, [RETENTION_DAYS]).catch(() => undefined);
  const claimed = await pool.query(
    `INSERT INTO linqext_requests (user_id, request_id, payload_hash, status, trigger) VALUES ($1, $2, $3, 'running', $4) ON CONFLICT DO NOTHING RETURNING 1`,
    [user.id, input.requestId, hash, input.trigger]);
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
  const fail = () => pool.query(`UPDATE linqext_requests SET status = 'failed' WHERE user_id = $1 AND request_id = $2 AND status = 'running'`, [user.id, input.requestId]).catch(() => undefined);

  // At most MAX_IN_FLIGHT generations per user at once. Checked after the claim, before any model call or charge.
  const running = (await pool.query(
    `SELECT count(*)::int AS n FROM linqext_requests WHERE user_id = $1 AND status = 'running' AND created_at > now() - make_interval(secs => $2)`,
    [user.id, STALE_RUNNING_SECONDS])).rows[0].n;
  if (running > MAX_IN_FLIGHT) { await fail(); throw new LinqextError(429, "TOO_MANY_IN_FLIGHT"); }

  // Typing-triggered suggestions: the server enforces the pace and the daily cap, whatever the client does.
  if (input.trigger === "typing") {
    const t = (await pool.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS day, coalesce(bool_or(created_at > now() - make_interval(secs => $3)), false) AS recent
       FROM linqext_requests WHERE user_id = $1 AND trigger = 'typing' AND request_id <> $2 AND status <> 'failed'`,
      [user.id, input.requestId, TYPING_MIN_INTERVAL_SECONDS])).rows[0];
    if (t.recent) { await fail(); throw new LinqextError(429, "TOO_SOON", { retryAfterSeconds: TYPING_MIN_INTERVAL_SECONDS }); }
    if (t.day >= TYPING_DAILY_CAP[tier]) { await fail(); throw new LinqextError(429, "TYPING_LIMIT_REACHED", { dailyCap: TYPING_DAILY_CAP[tier] }); }
  }

  try {
    const prompt = buildPrompt(tier, input.tone, input.customTone, input.variants, input.message, context, input.trigger === "typing" ? "draft" : "reply");
    const { answer } = await answerChat({ mode: "chat", model: "auto", messages: [{ role: "user", content: prompt }] }, actor);
    const replies = parseReplies(answer, input.variants, policy.maxWords);
    if (!replies) throw new LinqextError(503, "REPLY_GENERATION_UNAVAILABLE");
    const result = { requestId: input.requestId, tier, replies, insertRequiresUserAction: true };
    await pool.query(`UPDATE linqext_requests SET status = 'completed', response = $3 WHERE user_id = $1 AND request_id = $2`, [user.id, input.requestId, JSON.stringify(result)]);
    return { replay: false, result };
  } catch (error) {
    // The pipeline has already refunded the usage it reserved; free the request id for a retry.
    await fail();
    throw error;
  }
}
