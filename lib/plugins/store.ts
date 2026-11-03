import "server-only";
import { pool } from "@/lib/admin/db";
import { decrypt, encrypt } from "@/lib/connectors/crypto";
import { fieldsOf } from "./fields";

export type Pref = { enabled: boolean | null; settings: Record<string, string | boolean>; secrets: Record<string, string> };
const EMPTY: Pref = { enabled: null, settings: {}, secrets: {} };

export async function preferences(owner: string): Promise<Map<string, Pref>> {
  const { rows } = await pool.query(`SELECT plugin_id, enabled, settings, secrets_enc FROM plugin_preferences WHERE owner_id = $1`, [owner]);
  return new Map(rows.map(r => [r.plugin_id as string, { enabled: r.enabled, settings: r.settings ?? {}, secrets: r.secrets_enc ?? {} }]));
}

export async function preference(owner: string, pluginId: string): Promise<Pref> {
  return (await preferences(owner)).get(pluginId) ?? EMPTY;
}

/** Merges a patch into the stored preference. Secrets arrive in plain text and are sealed here. */
export async function savePreference(owner: string, pluginId: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }) {
  const current = await preference(owner, pluginId);
  const settings = { ...current.settings };
  const secrets = { ...current.secrets };
  const secretKeys = new Set(fieldsOf(pluginId).filter(f => f.type === "secret").map(f => f.key));
  for (const [key, value] of Object.entries(patch.settings ?? {})) {
    if (secretKeys.has(key)) { if (value === null) delete secrets[key]; else if (typeof value === "string") secrets[key] = encrypt(value); }
    else if (typeof value === "string" || typeof value === "boolean") settings[key] = value;
  }
  await pool.query(
    `INSERT INTO plugin_preferences (owner_id, plugin_id, enabled, settings, secrets_enc) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (owner_id, plugin_id) DO UPDATE SET enabled = COALESCE($3, plugin_preferences.enabled),
       settings = EXCLUDED.settings, secrets_enc = EXCLUDED.secrets_enc, updated_at = now()`,
    [owner, pluginId, patch.enabled ?? null, JSON.stringify(settings), JSON.stringify(secrets)]);
}

/** A plugin's decrypted secret, for server-side use only (never sent to the browser). */
export async function secretOf(owner: string, pluginId: string, key: string): Promise<string | null> {
  const sealed = (await preference(owner, pluginId)).secrets[key];
  return sealed ? decrypt(sealed) : null;
}

/** False only when this account switched the plugin off. */
export async function pluginEnabled(owner: string, pluginId: string): Promise<boolean> {
  return (await preference(owner, pluginId)).enabled !== false;
}
