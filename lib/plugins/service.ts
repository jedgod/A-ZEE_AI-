import "server-only";
import { installations, registry, saveInstallation } from "@/15_EXTENSIONS/registry";
import { requireActor, requireAdmin } from "@/15_EXTENSIONS/permissions";
import { audit } from "@/15_EXTENSIONS/audit";
import { CATALOG } from "@/lib/connectors/catalog";
import { FEATURES, featureEnabled, type FeatureName } from "@/lib/features";
import { statuses } from "@/lib/connectors/service";
import { ConnectorError } from "@/lib/connectors/types";
import { fieldsOf, settingsPatch, type Field } from "./fields";
import { preferences, savePreference } from "./store";

// GET /api/plugins and PATCH /api/plugins/:id.
//   connector: per account. installed = connected; enabled = the account's toggle (default on).
//   skill:     per workspace, reviewed built-ins. Enabling grants the manifest's permissions to code
//              that can read chat context or output, so only a staff admin may toggle it.

export type Plugin = {
  id: string; name: string; description: string; kind: "connector" | "skill" | "feature";
  category: "search" | "connector" | "tool";
  /** ready: usable. readonly: usable, read access only. blocked: can't be turned on yet (see blockedBy). */
  status: "ready" | "blocked" | "readonly"; blockedBy?: string;
  /** Connected (connector), approved (skill) or switched on at least once (feature). */
  installed: boolean; enabled: boolean; version?: string; permissions?: string[];
  /** Who may change it here: this account ("user") or a staff admin ("staff"). */
  managedBy: "user" | "staff"; canManage: boolean;
  fields: Field[]; settings: Record<string, string | boolean | { set: boolean }>;
};

async function staffActor() {
  try { const actor = await requireActor(); return { actor, admin: actor.permissions.has("extensions:admin") }; }
  catch { return { actor: null, admin: false }; }
}

/** Plugins for this account; `owner` is null when nobody is signed in locally (skills only). */
export async function listPlugins(owner: string | null): Promise<Plugin[]> {
  const prefs = owner ? await preferences(owner) : new Map();
  const connectors: Plugin[] = owner ? (await statuses(owner)).map(s => {
    const entry = CATALOG.find(c => c.provider === s.id);
    const pref = prefs.get(s.id);
    const fields = fieldsOf(s.id);
    return {
      id: s.id, name: s.label, description: entry?.intro ?? "", kind: "connector" as const, category: "connector" as const,
      status: "readonly" as const, installed: s.connected,
      enabled: s.connected && pref?.enabled !== false, managedBy: "user" as const, canManage: true, fields,
      settings: Object.fromEntries(fields.map(f => [f.key, f.type === "secret" ? { set: Boolean(pref?.secrets[f.key]) } : pref?.settings[f.key] ?? f.default ?? ""])),
    };
  }) : [];

  const { actor, admin } = await staffActor();
  const installed = actor && admin ? await installations(actor.tenantId) : [];
  const skills: Plugin[] = registry.list().map(m => {
    const row = installed.find(i => i.id === m.id);
    return {
      id: m.id, name: m.name, description: m.description, kind: "skill" as const, category: "tool" as const,
      status: "ready" as const, installed: Boolean(row), enabled: Boolean(row?.enabled),
      version: m.version, permissions: m.permissions, managedBy: "staff" as const, canManage: admin, fields: [], settings: {},
    };
  });
  const features: Plugin[] = owner ? Object.entries(FEATURE_PLUGINS).map(([id, f]) => {
    const available = featureEnabled(f.feature);
    const pref = prefs.get(id);
    return {
      id, name: f.name, description: f.description, kind: "feature" as const, category: "search" as const,
      status: available ? "ready" as const : "blocked" as const,
      ...(available ? {} : { blockedBy: FEATURES[f.feature].blockedBy ?? `${FEATURES[f.feature].label} isn't available yet.` }),
      installed: pref?.enabled != null, enabled: available && pref?.enabled === true, managedBy: "user" as const, canManage: available, fields: [], settings: {},
    };
  }) : [];
  return [...connectors, ...features, ...skills];
}

/** Account-level switches for platform features. Off until the account turns them on. */
const FEATURE_PLUGINS: Record<string, { feature: FeatureName; name: string; description: string }> = {
  "search-index": { feature: "searchIndex", name: "Search Index", description: "PostgreSQL full-text search with source provenance and access control." },
  "vector-search": { feature: "vectorSearch", name: "Vector Search", description: "Semantic search (requires pgvector)." },
};
export const isFeaturePlugin = (id: string) => id in FEATURE_PLUGINS;

export async function updateFeature(owner: string, id: string, enabled: boolean) {
  const f = FEATURE_PLUGINS[id];
  if (!f) throw new ConnectorError(404, "UNKNOWN_PLUGIN");
  if (enabled && !featureEnabled(f.feature)) throw new ConnectorError(409, "FEATURE_BLOCKED", FEATURES[f.feature].blockedBy);
  await savePreference(owner, id, { enabled });
}

export async function updateConnector(owner: string, id: string, input: { enabled?: boolean; settings?: Record<string, unknown> }) {
  const entry = CATALOG.find(c => c.provider === id);
  if (!entry) throw new ConnectorError(404, "UNKNOWN_PLUGIN");
  const connected = (await statuses(owner)).find(s => s.id === id)?.connected;
  if (input.enabled && !connected) throw new ConnectorError(409, "NOT_CONNECTED");
  const settings = input.settings ? settingsPatch(fieldsOf(id)).parse(input.settings) : undefined;
  await savePreference(owner, id, { enabled: input.enabled, settings });
}

export async function updateSkill(id: string, enabled: boolean) {
  const { actor } = await staffActor();
  if (!actor) throw new ConnectorError(401, "STAFF_SIGN_IN_REQUIRED");
  try { requireAdmin(actor); } catch { throw new ConnectorError(403, "STAFF_REQUIRED"); }
  let manifest;
  try { manifest = registry.get(id).manifest; } catch { throw new ConnectorError(404, "UNKNOWN_PLUGIN"); }
  await saveInstallation({ tenantId: actor.tenantId, actorId: actor.userId, id: manifest.id, version: manifest.version, enabled, grants: [...manifest.permissions] });
  await audit({ tenantId: actor.tenantId, actorId: actor.userId, extensionId: manifest.id, event: "configuration", status: "success" });
}

export const isSkill = (id: string) => registry.list().some(m => m.id === id);
