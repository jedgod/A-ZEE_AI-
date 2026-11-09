import "server-only";
import { z } from "zod";
import { pool } from "@/lib/admin/db";

// What the user agreed to for AZLinqext. Enforced on the server: no consent, no processing.
// Bump CONSENT_VERSION whenever what is sent, or why, changes, so everyone is asked again.
export const CONSENT_VERSION = 2; // 2: more modes (rewrite, grammar, tone, translate, summarize) and explicit disclosure of third-party AI providers

export const consentSchema = z.object({
  version: z.literal(CONSENT_VERSION),
  replyAssist: z.boolean(),
  context: z.boolean(),
  typing: z.boolean().default(false), // "suggest as I type": its own opt-in
}).strict().refine(c => c.replyAssist || !(c.context || c.typing), { message: "context and typing need replyAssist", path: ["replyAssist"] });

export type Consent = { version: number; replyAssist: boolean; context: boolean; typing: boolean; current: boolean };

export async function getConsent(userId: string): Promise<Consent> {
  const row = (await pool.query(`SELECT version, reply_assist, context, typing FROM linqext_consents WHERE user_id = $1`, [userId])).rows[0];
  const current = row?.version === CONSENT_VERSION;
  return { version: CONSENT_VERSION, replyAssist: current && row.reply_assist, context: current && row.reply_assist && row.context, typing: current && row.reply_assist && row.typing, current: Boolean(current) };
}

export async function setConsent(userId: string, raw: unknown): Promise<Consent> {
  const input = consentSchema.parse(raw);
  await pool.query(
    `INSERT INTO linqext_consents (user_id, version, reply_assist, context, typing) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, reply_assist = EXCLUDED.reply_assist, context = EXCLUDED.context, typing = EXCLUDED.typing, updated_at = now()`,
    [userId, input.version, input.replyAssist, input.replyAssist && input.context, input.replyAssist && input.typing]);
  return getConsent(userId);
}
