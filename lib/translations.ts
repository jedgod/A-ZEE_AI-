import "server-only";
import { pool } from "@/lib/admin/db";

export type SavedTranslation = { id: string; targetLang: string; sourceText: string; translatedText: string; provider: string | null; createdAt: string };

const COLUMNS = `id, target_lang AS "targetLang", source_text AS "sourceText", translated_text AS "translatedText", provider, created_at AS "createdAt"`;

/** Keeps the account's last 30 translations; older ones are dropped so the history cannot grow without limit. */
export async function saveTranslation(ownerId: string, t: { targetLang: string; sourceText: string; translatedText: string; provider: string | null }): Promise<void> {
  await pool.query(`INSERT INTO translations (owner_id, target_lang, source_text, translated_text, provider) VALUES ($1, $2, $3, $4, $5)`,
    [ownerId, t.targetLang, t.sourceText.slice(0, 20000), t.translatedText.slice(0, 40000), t.provider?.slice(0, 100) ?? null]);
  await pool.query(`DELETE FROM translations WHERE owner_id = $1 AND id NOT IN (SELECT id FROM translations WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 30)`, [ownerId]);
}

export async function listTranslations(ownerId: string, limit = 30): Promise<SavedTranslation[]> {
  return (await pool.query(`SELECT ${COLUMNS} FROM translations WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`, [ownerId, Math.min(Math.max(limit, 1), 30)])).rows;
}

export async function clearTranslations(ownerId: string): Promise<number> {
  return (await pool.query(`DELETE FROM translations WHERE owner_id = $1`, [ownerId])).rowCount ?? 0;
}
