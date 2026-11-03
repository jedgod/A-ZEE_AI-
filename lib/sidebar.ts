import "server-only";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { MAX_PROJECT_NAME, MAX_PROJECTS } from "@/lib/projects";

// Server side of the workspace sidebar (migration 012): configurable groups/items, plus each
// account's projects and chat metadata. Chat messages are never sent here; they stay in the
// browser. Every query is scoped to the owner.

export type ItemAction = "new-chat" | "new-tab" | "rename" | "share" | "edit" | "settings" | "pin" | "delete";
export type GroupAction = "all" | "add" | "see-all";
export type SidebarItem = {
  id: string; label: string; icon?: string; href?: string; badge?: string; description?: string;
  type?: "project" | "chat"; pinned?: boolean; projectId?: string | null; mode?: string; actions?: ItemAction[];
  /** A project's chats (the sidebar shows them when the project is expanded). */
  children?: SidebarItem[]; childCount?: number;
};
export type SidebarGroup = {
  id: string; label?: string; collapsible?: boolean; showMore?: boolean;
  actions?: GroupAction[]; items: SidebarItem[]; total?: number;
};

export class SidebarError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export const SIDEBAR_LIMIT = 8;
/** Chats listed under each project (newest first, pinned on top). */
export const PROJECT_CHAT_LIMIT = 10;
// Project menu: Rename, Share (a link with the project's chats), Edit (name + description),
// Settings (instructions + default mode), Delete. "+" on hover starts a chat in the project.
const PROJECT_ACTIONS: ItemAction[] = ["new-chat", "rename", "share", "edit", "settings", "delete"];
const CHAT_ACTIONS: ItemAction[] = ["new-tab", "rename", "pin", "delete"];

export const projectName = z.string().transform(s => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(MAX_PROJECT_NAME));
export const chatTitle = z.string().transform(s => s.trim().replace(/\s+/g, " ").slice(0, 120)).pipe(z.string().min(1));
const projectRef = z.union([z.literal("general"), z.string().uuid()]).nullable();
const toProjectId = (ref: string | null | undefined) => (ref && ref !== "general" ? ref : null);

const unique = (error: unknown) => (error as { code?: string })?.code === "23505";

type ChatRow = { id: string; title: string; pinned: boolean; project_id: string | null; mode: string };
const chatItem = (c: ChatRow): SidebarItem => ({
  id: c.id, label: c.title, icon: c.pinned ? "pin" : "message", type: "chat",
  pinned: c.pinned, projectId: c.project_id, mode: c.mode, actions: CHAT_ACTIONS,
});

export type SidebarQuery = { project?: string | null; allChats?: boolean; allProjects?: boolean };

/**
 * Groups in configured order, with this owner's data injected:
 * - Projects: each project carries its chats as `children` (a folder tree).
 * - Chats: chats in no project (the implicit "General"). `?project=` lists one project's chats here instead.
 */
export async function sidebarFor(ownerId: string, query: SidebarQuery = {}): Promise<SidebarGroup[]> {
  const project = query.project ? projectRef.parse(query.project) : undefined;
  const scope = project === undefined ? "general" : (project ?? "general");
  const chatLimit = query.allChats ? 200 : SIDEBAR_LIMIT;
  const [groups, items, projects, projectCount, chats, chatCount, projectChats] = await Promise.all([
    pool.query(`SELECT id, label, collapsible, show_more FROM sidebar_groups ORDER BY sort_order, id`),
    pool.query(`SELECT id, group_id, label, icon, href, badge FROM sidebar_items WHERE enabled ORDER BY sort_order, id`),
    pool.query(`SELECT id, name, description, default_mode FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC, id LIMIT $2`, [ownerId, query.allProjects ? MAX_PROJECTS : SIDEBAR_LIMIT]),
    pool.query(`SELECT count(*)::int AS n FROM projects WHERE owner_id = $1`, [ownerId]),
    pool.query(
      `SELECT id, title, pinned, project_id, mode FROM chats
       WHERE owner_id = $1 AND (($2 = 'general' AND project_id IS NULL) OR project_id::text = $2)
       ORDER BY pinned DESC, updated_at DESC, id LIMIT $3`,
      [ownerId, scope, chatLimit]),
    pool.query(
      `SELECT count(*)::int AS n FROM chats
       WHERE owner_id = $1 AND (($2 = 'general' AND project_id IS NULL) OR project_id::text = $2)`,
      [ownerId, scope]),
    pool.query(
      `SELECT id, title, pinned, project_id, mode, n FROM (
         SELECT id, title, pinned, project_id, mode,
                row_number() OVER (PARTITION BY project_id ORDER BY pinned DESC, updated_at DESC, id) AS rank,
                count(*) OVER (PARTITION BY project_id)::int AS n
         FROM chats WHERE owner_id = $1 AND project_id IS NOT NULL
       ) ranked WHERE rank <= $2 ORDER BY project_id, rank`,
      [ownerId, PROJECT_CHAT_LIMIT]),
  ]);

  return groups.rows.map(g => {
    const base: SidebarGroup = {
      id: g.id, ...(g.label ? { label: g.label } : {}), collapsible: g.collapsible,
      items: items.rows.filter(i => i.group_id === g.id).map(i => ({
        id: i.id, label: i.label, ...(i.icon ? { icon: i.icon } : {}), ...(i.href ? { href: i.href } : {}), ...(i.badge ? { badge: i.badge } : {}),
      })),
    };
    if (g.id === "projects") {
      return {
        ...base, actions: ["all", "add"], total: projectCount.rows[0].n,
        showMore: !query.allProjects && projectCount.rows[0].n > projects.rowCount!,
        items: projects.rows.map(p => {
          const children = (projectChats.rows as (ChatRow & { n: number })[]).filter(c => c.project_id === p.id);
          return {
            id: p.id, label: p.name, icon: "folder", type: "project" as const, actions: PROJECT_ACTIONS,
            ...(p.description ? { description: p.description } : {}), mode: p.default_mode,
            children: children.map(chatItem), childCount: children[0]?.n ?? 0,
          };
        }),
      };
    }
    if (g.id === "chats") {
      return { ...base, actions: ["see-all"], total: chatCount.rows[0].n, items: (chats.rows as ChatRow[]).map(chatItem) };
    }
    return base;
  });
}

export async function listProjects(ownerId: string) {
  const { rows } = await pool.query(`SELECT id, name FROM projects WHERE owner_id = $1 ORDER BY created_at, id LIMIT $2`, [ownerId, MAX_PROJECTS]);
  return rows as { id: string; name: string }[];
}

export async function createProject(ownerId: string, rawName: unknown, id?: string) {
  const name = projectName.parse(rawName);
  return transaction(async db => {
    await db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [ownerId]);   // serialize the count check
    const same = await db.query(`SELECT id, name FROM projects WHERE owner_id = $1 AND lower(name) = lower($2)`, [ownerId, name]);
    if (same.rowCount) return { project: same.rows[0] as { id: string; name: string }, created: false };
    const count = (await db.query(`SELECT count(*)::int AS n FROM projects WHERE owner_id = $1`, [ownerId])).rows[0].n;
    // General is implicit, so accounts get MAX_PROJECTS - 1 of their own (as in the browser).
    if (count >= MAX_PROJECTS - 1) throw new SidebarError(409, "PROJECT_LIMIT");
    const { rows } = await db.query(
      `INSERT INTO projects (id, name, owner_id) VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3) RETURNING id, name`,
      [id ?? null, name, ownerId]);
    return { project: rows[0] as { id: string; name: string }, created: true };
  });
}

export async function renameProject(ownerId: string, id: string, rawName: unknown) {
  z.string().uuid().parse(id);
  const name = projectName.parse(rawName);
  try {
    const { rows } = await pool.query(
      `UPDATE projects SET name = $1, updated_at = now() WHERE id = $2 AND owner_id = $3 RETURNING id, name`, [name, id, ownerId]);
    if (!rows.length) throw new SidebarError(404, "NOT_FOUND");
    return rows[0] as { id: string; name: string };
  } catch (error) {
    if (unique(error)) throw new SidebarError(409, "PROJECT_EXISTS");
    throw error;
  }
}

export const MODES = ["chat", "code", "research"] as const;
export type ProjectDetails = { id: string; name: string; description: string; instructions: string; defaultMode: (typeof MODES)[number] };

export async function getProject(ownerId: string, id: string): Promise<ProjectDetails> {
  z.string().uuid().parse(id);
  const { rows } = await pool.query(
    `SELECT id, name, description, instructions, default_mode FROM projects WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!rows.length) throw new SidebarError(404, "NOT_FOUND");
  const r = rows[0];
  return { id: r.id, name: r.name, description: r.description, instructions: r.instructions, defaultMode: r.default_mode };
}

export const projectPatchSchema = z.object({
  name: projectName.optional(),
  description: z.string().transform(v => v.trim()).pipe(z.string().max(500)).optional(),
  instructions: z.string().transform(v => v.trim()).pipe(z.string().max(4000)).optional(),
  defaultMode: z.enum(MODES).optional(),
}).strict().refine(v => Object.values(v).some(x => x !== undefined), "Nothing to update");

/** Edit (name, description) and Settings (instructions, default mode). */
export async function updateProject(ownerId: string, id: string, raw: unknown): Promise<ProjectDetails> {
  z.string().uuid().parse(id);
  const input = projectPatchSchema.parse(raw);
  try {
    const { rowCount } = await pool.query(
      `UPDATE projects SET
         name = coalesce($1, name), description = coalesce($2, description),
         instructions = coalesce($3, instructions), default_mode = coalesce($4, default_mode), updated_at = now()
       WHERE id = $5 AND owner_id = $6`,
      [input.name ?? null, input.description ?? null, input.instructions ?? null, input.defaultMode ?? null, id, ownerId]);
    if (!rowCount) throw new SidebarError(404, "NOT_FOUND");
  } catch (error) {
    if (unique(error)) throw new SidebarError(409, "PROJECT_EXISTS");
    throw error;
  }
  return getProject(ownerId, id);
}

/** The project's instructions for the AI, if the project belongs to this owner. */
export async function projectInstructions(ownerId: string, projectId: string): Promise<{ name: string; instructions: string } | null> {
  if (!z.string().uuid().safeParse(projectId).success) return null;
  const { rows } = await pool.query(`SELECT name, instructions FROM projects WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
  return rows[0]?.instructions ? { name: rows[0].name, instructions: rows[0].instructions } : null;
}

/** Deleting a project keeps its chats: they move to General (ON DELETE SET NULL). */
export async function deleteProject(ownerId: string, id: string) {
  z.string().uuid().parse(id);
  const { rowCount } = await pool.query(`DELETE FROM projects WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!rowCount) throw new SidebarError(404, "NOT_FOUND");
}

// Messages as the workspace keeps them (answers carry their request id, research plan, notes and
// cited sources). Strict: anything else is rejected.
const MAX_TEXT = 40_000;
const httpUrl = z.string().max(2048).refine(v => { try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; } });
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_TEXT),
  display: z.string().max(MAX_TEXT).optional(),
  requestId: z.string().uuid().optional(),
  plan: z.array(z.string().max(2000)).max(20).optional(),
  notes: z.array(z.string().max(1000)).max(20).optional(),
  sources: z.array(z.object({ id: z.string().max(200), title: z.string().max(200), url: httpUrl.nullable() }).strict()).max(30).optional(),
}).strict();
export const chatMessages = z.array(chatMessageSchema).max(200);
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatUpsertSchema = z.object({
  title: chatTitle,
  projectId: projectRef.optional(),
  mode: z.enum(["chat", "code", "research"]).optional(),
  messages: chatMessages.optional(),
}).strict();

/** Create or update a chat (the browser saves a conversation: metadata and, when sent, its messages). */
export async function upsertChat(ownerId: string, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = chatUpsertSchema.parse(raw);
  const projectId = toProjectId(input.projectId);
  if (projectId) {
    const owned = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
    if (!owned.rowCount) throw new SidebarError(404, "PROJECT_NOT_FOUND");
  }
  const { rows } = await pool.query(
    `INSERT INTO chats (id, title, owner_id, project_id, mode, messages) VALUES ($1, $2, $3, $4::uuid, $5, coalesce($7::jsonb, '[]'::jsonb))
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       project_id = CASE WHEN $6 THEN EXCLUDED.project_id ELSE chats.project_id END,
       mode = EXCLUDED.mode,
       messages = CASE WHEN $7::jsonb IS NULL THEN chats.messages ELSE EXCLUDED.messages END,
       updated_at = now()
     WHERE chats.owner_id = EXCLUDED.owner_id
     RETURNING id, title, project_id, pinned, mode, message_count`,
    [id, input.title, ownerId, projectId, input.mode ?? "chat", input.projectId !== undefined, input.messages ? JSON.stringify(input.messages) : null],
  );
  // No row: the id belongs to another account's chat.
  if (!rows.length) throw new SidebarError(409, "CHAT_ID_TAKEN");
  return rows[0];
}

export type ChatSummary = { id: string; title: string; projectId: string | null; pinned: boolean; mode: string; messageCount: number; updatedAt: string };
const summary = (r: { id: string; title: string; project_id: string | null; pinned: boolean; mode: string; message_count: number; updated_at: Date }): ChatSummary => ({
  id: r.id, title: r.title, projectId: r.project_id, pinned: r.pinned, mode: r.mode, messageCount: r.message_count, updatedAt: new Date(r.updated_at).toISOString(),
});

/** GET /api/chats[?projectId=<uuid|general>]: this owner's chats, pinned first then newest. */
export async function listChats(ownerId: string, query: { projectId?: string | null; limit?: number } = {}): Promise<ChatSummary[]> {
  const scope = query.projectId ? projectRef.parse(query.projectId) : undefined;
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 200), 1), 500);
  const { rows } = await pool.query(
    `SELECT id, title, project_id, pinned, mode, message_count, updated_at FROM chats
     WHERE owner_id = $1 AND ($2::text IS NULL OR ($2 = 'general' AND project_id IS NULL) OR project_id::text = $2)
     ORDER BY pinned DESC, updated_at DESC, id LIMIT $3`,
    [ownerId, scope === undefined ? null : (scope ?? "general"), limit]);
  return rows.map(summary);
}

/** GET /api/chats/:id: one chat with its messages. */
export async function getChat(ownerId: string, id: string): Promise<ChatSummary & { messages: ChatMessage[] }> {
  z.string().uuid().parse(id);
  const { rows } = await pool.query(
    `SELECT id, title, project_id, pinned, mode, message_count, updated_at, messages FROM chats WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!rows.length) throw new SidebarError(404, "NOT_FOUND");
  return { ...summary(rows[0]), messages: rows[0].messages };
}

export const chatPatchSchema = z.object({
  title: chatTitle.optional(),
  pinned: z.boolean().optional(),
  projectId: projectRef.optional(),
}).strict().refine(v => v.title !== undefined || v.pinned !== undefined || v.projectId !== undefined, "Nothing to update");

export async function updateChat(ownerId: string, id: string, raw: unknown) {
  z.string().uuid().parse(id);
  const input = chatPatchSchema.parse(raw);
  const projectId = toProjectId(input.projectId);
  if (projectId) {
    const owned = await pool.query(`SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`, [projectId, ownerId]);
    if (!owned.rowCount) throw new SidebarError(404, "PROJECT_NOT_FOUND");
  }
  const { rows } = await pool.query(
    `UPDATE chats SET
       title = coalesce($1, title),
       pinned = coalesce($2, pinned),
       project_id = CASE WHEN $3 THEN $4::uuid ELSE project_id END,
       updated_at = CASE WHEN $1 IS NOT NULL OR $3 THEN now() ELSE updated_at END
     WHERE id = $5 AND owner_id = $6
     RETURNING id, title, project_id, pinned, mode`,
    [input.title ?? null, input.pinned ?? null, input.projectId !== undefined, projectId, id, ownerId],
  );
  if (!rows.length) throw new SidebarError(404, "NOT_FOUND");
  return rows[0];
}

export async function deleteChatRecord(ownerId: string, id: string) {
  z.string().uuid().parse(id);
  const { rowCount } = await pool.query(`DELETE FROM chats WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!rowCount) throw new SidebarError(404, "NOT_FOUND");
}

export const syncSchema = z.object({
  projects: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(MAX_PROJECTS),
  chats: z.array(z.object({
    id: z.string().uuid(), title: z.string().max(500), projectId: z.string().max(64).optional(),
    mode: z.enum(["chat", "code", "research"]).optional(),
    messages: z.unknown().optional(),
  })).max(100),
}).strict();

/**
 * Import what a browser already has (projects, chats, and their messages). Existing server rows
 * win: titles and projects are never overwritten, and messages only fill chats that have none.
 */
export async function importLocal(ownerId: string, raw: unknown) {
  const input = syncSchema.parse(raw);
  const projectIds = new Map<string, string>();   // local id -> server id (same, or an existing same-name project)
  let projectsAdded = 0, chatsAdded = 0, messagesAdded = 0;
  for (const p of input.projects) {
    const name = projectName.safeParse(p.name);
    if (!name.success) continue;
    try {
      const result = await createProject(ownerId, name.data, p.id);
      projectIds.set(p.id, result.project.id);
      if (result.created) projectsAdded++;
    } catch (error) {
      if (error instanceof SidebarError && error.code === "PROJECT_LIMIT") break;
      if (!unique(error)) throw error;   // id taken by another row: skip
    }
  }
  for (const c of input.chats) {
    const title = chatTitle.safeParse(c.title);
    if (!title.success) continue;
    const projectId = c.projectId ? projectIds.get(c.projectId) ?? null : null;
    // Invalid messages are dropped (the chat's metadata still imports).
    const parsed = chatMessages.safeParse(c.messages);
    const messages = parsed.success && parsed.data.length ? JSON.stringify(parsed.data) : null;
    const result = await pool.query(
      `INSERT INTO chats (id, title, owner_id, project_id, mode, messages) VALUES ($1, $2, $3, $4, $5, coalesce($6::jsonb, '[]'::jsonb))
       ON CONFLICT (id) DO UPDATE SET messages = EXCLUDED.messages
       WHERE chats.owner_id = EXCLUDED.owner_id AND chats.message_count = 0 AND $6::jsonb IS NOT NULL
       RETURNING (xmax = 0) AS inserted`,
      [c.id, title.data, ownerId, projectId, c.mode ?? "chat", messages]);
    if (result.rows[0]?.inserted) chatsAdded++;
    if (result.rowCount && messages) messagesAdded++;
  }
  return { projectsAdded, chatsAdded, messagesAdded, projectIds: Object.fromEntries(projectIds) };
}
