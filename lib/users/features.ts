import "server-only";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { UserError } from "./types";

// Data behind the user icon rail. Every query is scoped to the signed-in user's id, so one
// account can never read or change another's rows (ids from the client are only ever filters).

const uuid = z.string().uuid();

// ---- favorites ----
export async function listFavorites(userId: string) {
  const r = await pool.query(
    `SELECT c.id, c.title, c.mode, c.project_id, c.updated_at, f.created_at AS favorited_at
     FROM favorites f JOIN chats c ON c.id = f.chat_id AND c.owner_id = f.user_id
     WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 100`, [userId]);
  return r.rows.map(c => ({ id: c.id as string, title: c.title as string, mode: c.mode as string, projectId: (c.project_id as string) ?? null, updatedAt: new Date(c.updated_at).toISOString(), favoritedAt: new Date(c.favorited_at).toISOString() }));
}
export async function addFavorite(userId: string, raw: unknown) {
  const chatId = z.object({ chatId: uuid }).strict().parse(raw).chatId;
  // Only the owner's own chats can be favorited.
  const r = await pool.query(
    `INSERT INTO favorites (user_id, chat_id) SELECT $1, id FROM chats WHERE id = $2 AND owner_id = $1
     ON CONFLICT DO NOTHING RETURNING chat_id`, [userId, chatId]);
  if (!r.rowCount) {
    const exists = await pool.query(`SELECT 1 FROM favorites WHERE user_id = $1 AND chat_id = $2`, [userId, chatId]);
    if (!exists.rowCount) throw new UserError(404, "CHAT_NOT_FOUND");
  }
}
export async function removeFavorite(userId: string, chatIdRaw: unknown) {
  await pool.query(`DELETE FROM favorites WHERE user_id = $1 AND chat_id = $2`, [userId, uuid.parse(chatIdRaw)]);
}

// ---- notifications ----
export async function listNotifications(userId: string) {
  const r = await pool.query(
    `SELECT id, title, body, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId]);
  return r.rows.map(n => ({ id: n.id as string, title: n.title as string, body: (n.body as string) ?? null, read: !!n.read_at, createdAt: new Date(n.created_at).toISOString() }));
}
export async function unreadCount(userId: string): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return r.rows[0].n;
}
export const notificationPatch = z.object({ id: uuid.optional(), all: z.literal(true).optional() }).strict()
  .refine(v => Boolean(v.id) !== Boolean(v.all), { message: "Send either id or all" });
export async function markRead(userId: string, raw: unknown) {
  const { id } = notificationPatch.parse(raw);
  await pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid IS NULL OR id = $2)`, [userId, id ?? null]);
}
/** For server code to tell a user something (e.g. a plan activated). Not exposed as an API. */
export async function notify(userId: string, title: string, body?: string) {
  await pool.query(`INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)`, [userId, title.slice(0, 120), body?.slice(0, 1000) ?? null]);
}

// ---- prompt library ----
export const promptInput = z.object({ title: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(4000) }).strict();
export async function listPrompts(userId: string) {
  const r = await pool.query(`SELECT id, title, content, created_at FROM saved_prompts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [userId]);
  return r.rows.map(p => ({ id: p.id as string, title: p.title as string, content: p.content as string, createdAt: new Date(p.created_at).toISOString() }));
}
export async function addPrompt(userId: string, raw: unknown) {
  const { title, content } = promptInput.parse(raw);
  const count = await pool.query(`SELECT count(*)::int AS n FROM saved_prompts WHERE user_id = $1`, [userId]);
  if (count.rows[0].n >= 200) throw new UserError(422, "LIBRARY_FULL");
  const r = await pool.query(`INSERT INTO saved_prompts (user_id, title, content) VALUES ($1, $2, $3) RETURNING id, title, content, created_at`, [userId, title, content]);
  const p = r.rows[0];
  return { id: p.id as string, title: p.title as string, content: p.content as string, createdAt: new Date(p.created_at).toISOString() };
}
export async function deletePrompt(userId: string, idRaw: unknown) {
  await pool.query(`DELETE FROM saved_prompts WHERE user_id = $1 AND id = $2`, [userId, uuid.parse(idRaw)]);
}

// ---- search across the user's own chats (titles) ----
export async function searchChats(userId: string, raw: string | null) {
  const q = (raw ?? "").trim().slice(0, 100);
  if (!q) return [];
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const r = await pool.query(
    `SELECT id, title, mode, project_id, updated_at FROM chats WHERE owner_id = $1 AND title ILIKE $2 ESCAPE '\\'
     ORDER BY updated_at DESC LIMIT 50`, [userId, like]);
  return r.rows.map(c => ({ id: c.id as string, title: c.title as string, mode: c.mode as string, projectId: (c.project_id as string) ?? null, updatedAt: new Date(c.updated_at).toISOString() }));
}
