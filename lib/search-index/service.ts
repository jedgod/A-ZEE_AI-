import "server-only";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { githubProvider } from "@/lib/connectors/github";
import { googleDriveProvider } from "@/lib/connectors/google-drive";
import { withToken } from "@/lib/connectors/service";
import { FEATURES, featureEnabled } from "@/lib/features";
import { chunk, IndexError, MARK_END, MARK_START, prepareContent } from "./chunk";

// A-Zee Search Index: per-account collections of explicitly added documents, searched with
// PostgreSQL full-text search. Every read and write is filtered by owner; collections separate
// workspaces. Connector documents are fetched read-only, one selected item at a time, and only
// re-fetched when the owner asks (sync).

const MAX_DOCUMENTS_PER_OWNER = 1000;
const MAX_COLLECTIONS_PER_OWNER = 50;
const uuid = z.string().uuid();

function ready() {
  if (!featureEnabled("searchIndex")) throw new IndexError(404, "FEATURE_DISABLED");
}

export async function status() {
  const ext = await pool.query(`SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'`).catch(() => ({ rows: [] as { installed_version: string | null }[] }));
  return {
    enabled: featureEnabled("searchIndex"), readiness: FEATURES.searchIndex.readiness, engine: "postgresql_fts",
    vectorSearch: { readiness: FEATURES.vectorSearch.readiness, extensionAvailable: ext.rows.length > 0, extensionInstalled: Boolean(ext.rows[0]?.installed_version), blockedBy: FEATURES.vectorSearch.blockedBy ?? null },
  };
}

// ---- Collections ----

export async function listCollections(owner: string) {
  ready();
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.created_at AS "createdAt", count(d.id)::int AS documents
       FROM search_index_collections c LEFT JOIN search_index_documents d ON d.collection_id = c.id
      WHERE c.owner_id = $1 GROUP BY c.id ORDER BY lower(c.name)`, [owner]);
  return rows;
}

export async function createCollection(owner: string, raw: unknown) {
  ready();
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(raw);
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM search_index_collections WHERE owner_id = $1`, [owner]);
  if (n >= MAX_COLLECTIONS_PER_OWNER) throw new IndexError(409, "COLLECTION_LIMIT_REACHED");
  try {
    const { rows } = await pool.query(`INSERT INTO search_index_collections (owner_id, name) VALUES ($1, $2) RETURNING id, name, created_at AS "createdAt"`, [owner, name]);
    return { ...rows[0], documents: 0 };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new IndexError(409, "COLLECTION_EXISTS");
    throw error;
  }
}

async function ownedCollection(owner: string, id: unknown) {
  if (!uuid.safeParse(id).success) throw new IndexError(404, "COLLECTION_NOT_FOUND");
  const { rows } = await pool.query(`SELECT id, name FROM search_index_collections WHERE id = $1 AND owner_id = $2`, [id, owner]);
  if (!rows[0]) throw new IndexError(404, "COLLECTION_NOT_FOUND");   // another account's collection looks like none
  return rows[0] as { id: string; name: string };
}

export async function deleteCollection(owner: string, id: string) {
  ready();
  await ownedCollection(owner, id);
  await pool.query(`DELETE FROM search_index_collections WHERE id = $1 AND owner_id = $2`, [id, owner]);
}

// ---- Documents ----

type Source = { type: "text" | "github" | "google_drive"; ref: string | null; title: string; url: string | null; content: string };

const ingestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("text"), collectionId: z.string(), title: z.string().trim().min(1).max(300), content: z.string() }),
  z.object({ source: z.literal("github"), collectionId: z.string(), repo: z.string().regex(/^[\w.-]{1,100}\/[\w.-]{1,100}$/), path: z.string().min(1).max(500).refine(p => !p.split("/").some(s => s === ".." || s === "." || s === ""), "invalid path"), ref: z.string().regex(/^[\w./-]{1,200}$/).optional() }),
  z.object({ source: z.literal("google_drive"), collectionId: z.string(), fileId: z.string().regex(/^[\w-]{8,200}$/) }),
]);
type IngestInput = z.infer<typeof ingestSchema>;

/** Fetches the one selected item through the read-only connector (audited there). */
async function fetchSource(owner: string, input: Exclude<IngestInput, { source: "text" }>): Promise<Source> {
  if (input.source === "github") {
    const [o, r] = input.repo.split("/");
    const file = await withToken(owner, "github", "index.file", `${input.repo}/${input.path}`, token => githubProvider().file(token, o, r, input.path, input.ref));
    const ref = input.ref ?? "HEAD";
    return { type: "github", ref: `${input.repo}:${input.path}@${input.ref ?? ""}`, title: `${input.repo}/${file.path}`, url: `https://github.com/${input.repo}/blob/${encodeURIComponent(ref)}/${file.path.split("/").map(encodeURIComponent).join("/")}`, content: file.content };
  }
  const doc = await withToken(owner, "google_drive", "index.file", input.fileId, token => googleDriveProvider().fileText(token, input.fileId));
  return { type: "google_drive", ref: input.fileId, title: doc.name.slice(0, 300) || input.fileId, url: `https://drive.google.com/file/d/${encodeURIComponent(input.fileId)}/view`, content: doc.content };
}

const DOC_COLUMNS = `d.id, d.collection_id AS "collectionId", d.source_type AS "sourceType", d.source_ref AS "sourceRef", d.title, d.url,
  d.content_hash AS "contentHash", d.bytes, d.version, d.created_at AS "createdAt", d.updated_at AS "indexedAt", d.last_synced_at AS "lastSyncedAt",
  (SELECT count(*)::int FROM search_index_chunks k WHERE k.document_id = d.id) AS chunks`;

async function documentMeta(owner: string, id: string) {
  const { rows } = await pool.query(`SELECT ${DOC_COLUMNS} FROM search_index_documents d WHERE d.id = $1 AND d.owner_id = $2`, [id, owner]);
  return rows[0];
}

type Db = { query: typeof pool.query };

async function writeChunks(db: Db, owner: string, collectionId: string, documentId: string, content: string) {
  await db.query(`DELETE FROM search_index_chunks WHERE document_id = $1`, [documentId]);   // stale chunks never survive an update
  const parts = chunk(content);
  for (let i = 0; i < parts.length; i += 200) {
    const batch = parts.slice(i, i + 200);
    await db.query(
      `INSERT INTO search_index_chunks (document_id, owner_id, collection_id, position, start_offset, end_offset, content)
       SELECT $1, $2, $3, * FROM unnest($4::int[], $5::int[], $6::int[], $7::text[])`,
      [documentId, owner, collectionId, batch.map(c => c.position), batch.map(c => c.start), batch.map(c => c.end), batch.map(c => c.content)]);
  }
  return parts.length;
}

type Outcome = "created" | "updated" | "unchanged" | "duplicate";

/** Stores a source in a collection: new, replaced (same source, new content), unchanged, or a duplicate of identical text. */
async function store(owner: string, collectionId: string, source: Source, existingId?: string): Promise<{ outcome: Outcome; id: string }> {
  const prepared = prepareContent(source.content);
  return transaction(async db => {
    // One writer per collection at a time, so concurrent duplicate ingests can't both insert.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`search-index:${collectionId}`]);
    const existing = existingId
      ? (await db.query(`SELECT id, content_hash FROM search_index_documents WHERE id = $1 AND owner_id = $2 FOR UPDATE`, [existingId, owner])).rows[0]
      : source.ref
        ? (await db.query(`SELECT id, content_hash FROM search_index_documents WHERE collection_id = $1 AND source_type = $2 AND source_ref = $3 FOR UPDATE`, [collectionId, source.type, source.ref])).rows[0]
        : (await db.query(`SELECT id, content_hash FROM search_index_documents WHERE collection_id = $1 AND source_type = 'text' AND content_hash = $2 LIMIT 1`, [collectionId, prepared.hash])).rows[0];
    const synced = source.type === "text" ? null : new Date();
    if (existing) {
      if (!existingId && source.type === "text") return { outcome: "duplicate" as const, id: existing.id };
      if (existing.content_hash === prepared.hash) {
        await db.query(`UPDATE search_index_documents SET title = $2, last_synced_at = COALESCE($3, last_synced_at) WHERE id = $1`, [existing.id, source.title, synced]);
        return { outcome: "unchanged" as const, id: existing.id };
      }
      await db.query(
        `UPDATE search_index_documents SET title = $2, url = $3, content = $4, content_hash = $5, bytes = $6, version = version + 1, updated_at = now(), last_synced_at = COALESCE($7, last_synced_at) WHERE id = $1`,
        [existing.id, source.title, source.url, prepared.content, prepared.hash, prepared.bytes, synced]);
      await writeChunks(db, owner, collectionId, existing.id, prepared.content);
      return { outcome: "updated" as const, id: existing.id };
    }
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM search_index_documents WHERE owner_id = $1`, [owner]);
    if (n >= MAX_DOCUMENTS_PER_OWNER) throw new IndexError(409, "INDEX_LIMIT_REACHED", { limit: MAX_DOCUMENTS_PER_OWNER });
    const { rows } = await db.query(
      `INSERT INTO search_index_documents (owner_id, collection_id, source_type, source_ref, title, url, content, content_hash, bytes, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [owner, collectionId, source.type, source.ref, source.title, source.url, prepared.content, prepared.hash, prepared.bytes, synced]);
    await writeChunks(db, owner, collectionId, rows[0].id, prepared.content);
    return { outcome: "created" as const, id: rows[0].id };
  });
}

export async function ingest(owner: string, raw: unknown) {
  ready();
  const input = ingestSchema.parse(raw);
  const collection = await ownedCollection(owner, input.collectionId);
  const source: Source = input.source === "text"
    ? { type: "text", ref: null, title: input.title, url: null, content: input.content }
    : await fetchSource(owner, input);
  const { outcome, id } = await store(owner, collection.id, source);
  return { outcome, document: await documentMeta(owner, id) };
}

export async function listDocuments(owner: string, collectionId: string | null) {
  ready();
  if (collectionId) await ownedCollection(owner, collectionId);
  const { rows } = await pool.query(
    `SELECT ${DOC_COLUMNS} FROM search_index_documents d WHERE d.owner_id = $1 AND ($2::uuid IS NULL OR d.collection_id = $2) ORDER BY d.updated_at DESC LIMIT 500`,
    [owner, collectionId]);
  return rows;
}

async function ownedDocument(owner: string, id: string) {
  if (!uuid.safeParse(id).success) throw new IndexError(404, "DOCUMENT_NOT_FOUND");
  const { rows } = await pool.query(`SELECT id, collection_id, source_type, source_ref, title, content FROM search_index_documents WHERE id = $1 AND owner_id = $2`, [id, owner]);
  if (!rows[0]) throw new IndexError(404, "DOCUMENT_NOT_FOUND");
  return rows[0] as { id: string; collection_id: string; source_type: Source["type"]; source_ref: string | null; title: string; content: string };
}

export async function getDocument(owner: string, id: string) {
  ready();
  const doc = await ownedDocument(owner, id);
  return { ...(await documentMeta(owner, id)), content: doc.content };
}

/** Replaces a text document's content (connector documents change only through sync). */
export async function updateDocument(owner: string, id: string, raw: unknown) {
  ready();
  const input = z.object({ title: z.string().trim().min(1).max(300).optional(), content: z.string() }).parse(raw);
  const doc = await ownedDocument(owner, id);
  if (doc.source_type !== "text") throw new IndexError(409, "USE_SYNC");
  const { outcome } = await store(owner, doc.collection_id, { type: "text", ref: null, title: input.title ?? doc.title, url: null, content: input.content }, id);
  return { outcome, document: await documentMeta(owner, id) };
}

/** Re-fetches a connector document; replaces the indexed content only if it changed. */
export async function syncDocument(owner: string, id: string) {
  ready();
  const doc = await ownedDocument(owner, id);
  if (doc.source_type === "text" || !doc.source_ref) throw new IndexError(409, "NOT_A_CONNECTOR_DOCUMENT");
  let input: Exclude<IngestInput, { source: "text" }>;
  if (doc.source_type === "github") {
    const m = /^([^:]+):(.+)@(.*)$/.exec(doc.source_ref);
    if (!m) throw new IndexError(409, "INVALID_SOURCE");
    input = { source: "github", collectionId: doc.collection_id, repo: m[1], path: m[2], ...(m[3] ? { ref: m[3] } : {}) };
  } else input = { source: "google_drive", collectionId: doc.collection_id, fileId: doc.source_ref };
  const source = await fetchSource(owner, input);
  const { outcome } = await store(owner, doc.collection_id, source, id);
  return { outcome, document: await documentMeta(owner, id) };
}

export async function deleteDocument(owner: string, id: string) {
  ready();
  await ownedDocument(owner, id);
  await pool.query(`DELETE FROM search_index_documents WHERE id = $1 AND owner_id = $2`, [id, owner]);   // chunks cascade
}

// ---- Query ----

const querySchema = z.object({
  q: z.string().trim().min(1).max(300),
  collectionId: z.string().uuid().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function search(owner: string, raw: unknown) {
  ready();
  const input = querySchema.parse(raw);
  if (input.collectionId) await ownedCollection(owner, input.collectionId);
  // websearch_to_tsquery never raises on user syntax ("quotes", or, -minus); stopword-only input has no terms.
  const { rows: [{ terms }] } = await pool.query(`SELECT numnode(websearch_to_tsquery('english', $1)) AS terms`, [input.q]);
  if (!terms) return { query: input.q, results: [], note: "NO_SEARCHABLE_TERMS" };
  const { rows } = await pool.query(
    `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS query)
     SELECT d.id AS "documentId", d.title, d.source_type AS "sourceType", d.source_ref AS "sourceRef", d.url, d.version,
            d.content_hash AS "contentHash", d.updated_at AS "indexedAt", col.id AS "collectionId", col.name AS collection,
            c.position, c.start_offset AS "start", c.end_offset AS "end",
            ts_rank_cd(c.tsv, q.query, 32) AS rank,
            ts_headline('english', c.content, q.query, $5) AS excerpt
       FROM q, search_index_chunks c
       JOIN search_index_documents d ON d.id = c.document_id AND d.owner_id = c.owner_id
       JOIN search_index_collections col ON col.id = c.collection_id AND col.owner_id = c.owner_id
      WHERE c.owner_id = $2 AND ($3::uuid IS NULL OR c.collection_id = $3) AND c.tsv @@ q.query
      ORDER BY rank DESC, d.updated_at DESC, c.position
      LIMIT $4`,
    [input.q, owner, input.collectionId, input.limit, `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxWords=45, MinWords=15, ShortWord=2, MaxFragments=0`]);
  return {
    query: input.q,
    results: rows.map((r, i) => ({
      n: i + 1, rank: Number(r.rank), excerpt: r.excerpt,
      source: { documentId: r.documentId, title: r.title, sourceType: r.sourceType, sourceRef: r.sourceRef, url: r.url, version: r.version, contentHash: r.contentHash, indexedAt: r.indexedAt, collectionId: r.collectionId, collection: r.collection },
      location: { chunk: r.position, start: r.start, end: r.end },
    })),
  };
}
