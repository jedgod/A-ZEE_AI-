import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { answerChat } from "@/lib/pipeline";
import { webActor } from "@/lib/pipeline/actor";
import { accessFor } from "@/lib/plans";
import { allow } from "@/lib/users/auth";
import { UserError, type SessionUser } from "@/lib/users/types";
import { getConsent } from "./consent";
import {
  AllowanceExhausted, chargeRequest, nextReset, refundRequest, resolvePolicy, textingUsed,
  TYPING_DAILY_CAP, TYPING_MIN_INTERVAL_SECONDS,
} from "./entitlements";
import { linqextUser } from "./keyboard-auth";
import { buildPrompt, LANGUAGES, MODES, MULTI_VARIANT_MODES, parseReplies, TONES, trimContext, wordBudget } from "./policy";

// AZLinqext texting assistant: POST /api/linqext/replies runs one mode (reply, rewrite, grammar, tone,
// translate, summarize) on text the user chose. It never sends anything: the keyboard shows the result
// and the user chooses to insert it. Identity, plan, moderation and PII redaction are A-Zee's own (the
// request goes through the same pipeline as chat), but usage is counted against the texting assistant's
// own allowance (lib/linqext/entitlements.ts), never the Main AI Page's chat allowance.

export { TYPING_DAILY_CAP, TYPING_MIN_INTERVAL_SECONDS };

/** Shown wherever the user is asked to agree, and returned with the entitlements so every client can show it. */
export const DISCLOSURE =
  "When you ask for a suggestion, the text you chose (and, only if you allow it, earlier messages) is sent to A-Zee and processed by the external AI services A-Zee uses to write the result. Passwords and private fields are never sent. Nothing is sent or inserted unless you ask for it.";

export const replySchema = z.object({
  requestId: z.string().uuid(),
  mode: z.enum(MODES).default("reply"),
  message: z.string().trim().min(1).max(4000),
  context: z.array(z.object({ role: z.enum(["self", "other"]), text: z.string().max(2000) }).strict()).max(20).default([]),
  tone: z.enum(TONES).default("professional"),
  customTone: z.string().max(120).optional(),
  variants: z.number().int().min(1).max(5).default(1),
  language: z.enum(LANGUAGES).optional(),
  consent: z.literal(true),
  // tap: the user pressed a button. typing: the keyboard asked after a pause in typing (needs its own consent).
  trigger: z.enum(["tap", "typing"]).default("tap"),
}).strict().superRefine((r, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (r.trigger === "typing" && r.mode !== "rewrite") bad("mode", "typing suggestions improve the user's own draft (rewrite)");
  if (r.trigger === "typing" && r.variants !== 1) bad("variants", "typing suggestions are one result");
  if (r.variants > 1 && !MULTI_VARIANT_MODES.includes(r.mode)) bad("variants", `${r.mode} returns one result`);
  if (r.mode === "translate" && !r.language) bad("language", "translate needs a target language");
  if (r.mode !== "translate" && r.language) bad("language", "only translate takes a language");
});

const STALE_RUNNING_SECONDS = 300;
const MAX_IN_FLIGHT = 3; // generations one user may have running at once

export class LinqextError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) { super(code); }
}

export async function entitlementsFor(request: Request) {
  const user = await linqextUser(request, false);
  const { actor } = webActor(request, user);
  const policy = resolvePolicy(await accessFor(actor));
  const used = await textingUsed(user.id);
  const consent = await getConsent(user.id);
  const limit = policy.monthlyAllowance;
  return {
    tier: policy.tier, plan: policy.planName,
    features: { context: policy.context, variants: policy.variants, maxWords: policy.maxWords, maxInputChars: policy.maxInputChars, personalized: policy.personalized, tones: policy.tones, modes: policy.modes },
    languages: LANGUAGES, consent, typing: policy.typing, disclosure: DISCLOSURE,
    // The texting assistant's own allowance, separate from the Main AI Page's chat allowance.
    usage: { used, limit, remaining: limit === null ? null : Math.max(limit - used, 0), resetsAt: nextReset(), separateFromChat: true },
  };
}

export async function createReply(request: Request, raw: unknown) {
  const user: SessionUser = await linqextUser(request, true);
  if (!await allow("linqext", user.id, 20)) throw new UserError(429, "RATE_LIMITED");
  const input = replySchema.parse(raw);
  const attempt = randomUUID();
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  const { actor } = webActor(request, user);
  const access = await accessFor(actor);
  const policy = resolvePolicy(access);
  const notInPlan = (feature: string) => new LinqextError(403, "FEATURE_NOT_IN_PLAN", { tier: policy.tier, plan: policy.planName, feature });
  if (access.walled && access.planId === "free") throw notInPlan("walled"); // the free-plan abuse wall applies here too
  if (!policy.modes.includes(input.mode)) throw notInPlan(input.mode);
  if ((input.mode === "reply" || input.mode === "tone") && !policy.tones.includes(input.tone)) throw notInPlan(`tone:${input.tone}`);
  if (input.variants > policy.variants) throw notInPlan("variants");
  if (input.mode !== "reply" && input.message.length > policy.maxInputChars) throw new LinqextError(413, "INPUT_TOO_LONG", { limit: policy.maxInputChars });
  // Server-side consent: the client's `consent: true` is not enough. Earlier messages are used only if agreed separately.
  const consent = await getConsent(user.id);
  if (!consent.replyAssist) throw new LinqextError(403, "CONSENT_REQUIRED", { version: consent.version });
  if (input.trigger === "typing" && !consent.typing) throw new LinqextError(403, "CONSENT_REQUIRED", { version: consent.version, scope: "typing" });
  const context = input.mode === "reply" && consent.context ? trimContext(input.context, policy.context) : [];

  // Claim the request id. A retry of a finished request replays its answer; a different body under
  // the same id is refused; a failed or abandoned attempt may be taken over. (user_id, request_id)
  // is the table's primary key, so two simultaneous requests can never both claim it.

  const claimed = await pool.query(
    `INSERT INTO linqext_requests (user_id, request_id, payload_hash, status, trigger, mode, attempt_id) VALUES ($1, $2, $3, 'running', $4, $5, $6) ON CONFLICT DO NOTHING RETURNING 1`,
    [user.id, input.requestId, hash, input.trigger, input.mode, attempt]);
  if (!claimed.rowCount) {
    const row = (await pool.query(`SELECT payload_hash, status, response FROM linqext_requests WHERE user_id = $1 AND request_id = $2`, [user.id, input.requestId])).rows[0];
    if (row?.payload_hash !== hash) throw new LinqextError(409, "IDEMPOTENCY_CONFLICT");
    if (row.status === "completed" && !row.response) throw new LinqextError(410, "REPLAY_EXPIRED");
    if (row.status === "completed") return { replay: true, result: row.response };
    const taken = await pool.query(
      `UPDATE linqext_requests SET status = 'running', created_at = now(), attempt_id = $4
       WHERE user_id = $1 AND request_id = $2 AND (status = 'failed' OR (status = 'running' AND created_at < now() - make_interval(secs => $3))) RETURNING 1`,
      [user.id, input.requestId, STALE_RUNNING_SECONDS, attempt]);
    if (!taken.rowCount) throw new LinqextError(409, "REQUEST_IN_PROGRESS");
  }
  const fail = () => pool.query(`UPDATE linqext_requests SET status = 'failed' WHERE user_id = $1 AND request_id = $2 AND status = 'running' AND attempt_id = $3`, [user.id, input.requestId, attempt]).catch(() => undefined);

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
      [user.id, input.requestId, policy.typing.minIntervalSeconds])).rows[0];
    if (t.recent) { await fail(); throw new LinqextError(429, "TOO_SOON", { retryAfterSeconds: policy.typing.minIntervalSeconds }); }
    if (t.day >= policy.typing.dailyCap) { await fail(); throw new LinqextError(429, "TYPING_LIMIT_REACHED", { dailyCap: policy.typing.dailyCap }); }
  }

  // Charge the texting allowance once, atomically (entitlements.ts). Nothing is generated if it is used up.
  try { await chargeRequest(user.id, input.requestId, policy.monthlyAllowance, attempt); }
  catch (error) {
    await fail();
    if (error instanceof AllowanceExhausted) throw new LinqextError(429, "PLAN_LIMIT_REACHED", { limit: error.limit, plan: policy.planName });
    throw error;
  }

  try {
    const maxWords = wordBudget(input.mode, policy.maxWords, input.message);
    const prompt = buildPrompt({ mode: input.mode, tone: input.tone, customTone: input.customTone, variants: input.variants, language: input.language, maxWords }, input.message, context);
    // skipUsage: this request is metered above against the texting allowance, not the chat allowance.
    const { answer } = await answerChat({ mode: "chat", model: "auto", messages: [{ role: "user", content: prompt }] }, actor, fetch, { skipUsage: true });
    const replies = parseReplies(answer, input.variants, maxWords);
    if (!replies) throw new LinqextError(503, "REPLY_GENERATION_UNAVAILABLE");
    const result = { requestId: input.requestId, mode: input.mode, tier: policy.tier, replies, insertRequiresUserAction: true };
    const completed = await pool.query(`UPDATE linqext_requests SET status = 'completed', response = $3 WHERE user_id = $1 AND request_id = $2 AND attempt_id = $4 AND status = 'running'`, [user.id, input.requestId, JSON.stringify(result), attempt]);
    if (!completed.rowCount) throw new Error('Inference attempt superseded');
    return { replay: false, result };
  } catch (error) {
    // Give the charge back (to the period it was charged to) and free the request id for a retry.
    await refundRequest(user.id, input.requestId, attempt);
    await fail();
    throw error;
  }
}
