import "server-only";
import { z } from "zod";
import { pool } from "@/lib/admin/db";

// The sidebar account menu's data: the signed-in user's account and its
// workspaces, plus personalization the chat pipeline applies to answers.

export const preferencesSchema = z.object({
  customInstructions: z.string().trim().max(1500).default(""),
  style: z.enum(["default", "concise", "detailed"]).default("default"),
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  avatarInitials: z.string().trim().min(1).max(3).regex(/^[\p{L}\p{N}]+$/u).optional(),
  // ISO country code used for regional pricing; "" clears it.
  region: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/).optional(),
}).strict();

export type Account = {
  id: string; name: string; email: string; initials: string; plan: string; planName: string; region: string | null;
  preferences: Preferences;
  workspaces: { id: string; name: string; personal: boolean; status: "active" | "deactivated"; role: string }[];
};

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join("").toUpperCase() || "?";

/** The account menu data for one signed-in user. */
export async function accountById(userId: string): Promise<Account | null> {
  if (!process.env.DATABASE_URL) return null;
  const user = (await pool.query("SELECT u.id, u.name, u.email, u.avatar_initials, u.plan, u.region, u.preferences, coalesce(p.name, u.plan) AS plan_name FROM users u LEFT JOIN plans p ON p.id = u.plan WHERE u.id = $1", [userId])).rows[0];
  if (!user) return null;
  const workspaces = await pool.query(
    `SELECT w.id, w.name, w.is_personal, w.status, uw.role FROM workspaces w
     JOIN user_workspaces uw ON uw.workspace_id = w.id WHERE uw.user_id = $1
     ORDER BY w.is_personal DESC, w.created_at`,
    [user.id],
  );
  return {
    id: user.id, name: user.name, email: user.email, plan: user.plan, planName: user.plan_name, region: user.region ?? null,
    initials: user.avatar_initials || initialsOf(user.name),
    preferences: preferencesSchema.parse(user.preferences ?? {}),
    workspaces: workspaces.rows.map(w => ({ id: w.id, name: w.name, personal: w.is_personal, status: w.status, role: w.role })),
  };
}

export async function updateProfile(userId: string, input: z.infer<typeof profileSchema>): Promise<Account | null> {
  const result = await pool.query(
    `UPDATE users SET name = $1, email = $2, avatar_initials = $3,
       region = CASE WHEN $4::text IS NULL THEN region ELSE nullif($4, '') END, updated_at = now()
     WHERE id = $5 RETURNING id`,
    [input.name, input.email, input.avatarInitials?.toUpperCase() ?? null, input.region ?? null, userId],
  );
  return result.rowCount ? accountById(userId) : null;
}

export async function updatePreferences(userId: string, preferences: Preferences): Promise<Account | null> {
  const result = await pool.query(
    "UPDATE users SET preferences = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING id",
    [JSON.stringify(preferences), userId],
  );
  return result.rowCount ? accountById(userId) : null;
}

/** Personalization text for the chat pipeline (signed-in users only); empty when nothing is set. */
export async function personalizationFor(userId: string): Promise<string> {
  try {
    const account = await accountById(userId);
    if (!account) return "";
    const { customInstructions, style } = account.preferences;
    const lines = [];
    if (style === "concise") lines.push("The user prefers concise answers: lead with the answer, keep it short.");
    if (style === "detailed") lines.push("The user prefers detailed answers with explanation and examples.");
    if (customInstructions) lines.push(`The user's own instructions for every answer (follow them unless they conflict with policy):\n${customInstructions}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}
