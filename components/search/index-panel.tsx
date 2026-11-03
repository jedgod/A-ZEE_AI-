"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Database, FileText, GitBranch, HardDrive, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// "My index" tab of A-Zee Search: collections of documents you add explicitly (text, one GitHub file,
// one Google Drive document), full-text search with highlighted excerpts and their provenance.

type Status = { enabled: boolean; readiness: string; vectorSearch: { readiness: string; extensionAvailable: boolean; blockedBy: string | null } };
type Collection = { id: string; name: string; documents: number };
type Doc = { id: string; collectionId: string; sourceType: "text" | "github" | "google_drive"; sourceRef: string | null; title: string; url: string | null; version: number; chunks: number; bytes: number; indexedAt: string; lastSyncedAt: string | null };
type Result = {
  n: number; rank: number; excerpt: string;
  source: { documentId: string; title: string; sourceType: Doc["sourceType"]; url: string | null; version: number; contentHash: string; indexedAt: string; collection: string };
  location: { chunk: number; start: number; end: number };
};

const MESSAGES: Record<string, string> = {
  CSRF_HEADER_REQUIRED: "Request refused (missing request header).",
  COLLECTION_EXISTS: "A collection with that name already exists.",
  COLLECTION_NOT_FOUND: "Collection not found.",
  DOCUMENT_NOT_FOUND: "Document not found.",
  DOCUMENT_TOO_LARGE: "That document is larger than the 1 MB limit.",
  EMPTY_DOCUMENT: "The document has no text to index.",
  INDEX_LIMIT_REACHED: "You've reached the 1,000-document limit. Delete documents first.",
  NOT_CONNECTED: "Connect that service on the Connectors page first.",
  CONNECTOR_KEY_MISSING: "Connectors aren't set up on this server.",
  PROVIDER_NOT_CONFIGURED: "That connector isn't configured on this server.",
  SOURCE_NOT_FOUND: "The source wasn't found (it may have been deleted or moved).",
  BINARY_FILE: "Binary files can't be indexed.",
  NOT_A_TEXT_FILE: "Only text documents can be indexed.",
  FILE_TOO_LARGE: "That file is too large to fetch.",
  RECONNECT_REQUIRED: "The connection expired. Reconnect on the Connectors page.",
  INVALID_INPUT: "Check the input and try again.",
  SIGN_IN_REQUIRED: "The index is available to this computer's signed-in account.",
};
const OUTCOME = { created: "Indexed.", updated: "Content changed: re-indexed as a new version.", unchanged: "Already up to date; nothing changed.", duplicate: "Identical text is already in this collection; not added again." };
const SOURCE_ICON: Record<Doc["sourceType"], ReactNode> = { text: <FileText className="h-3.5 w-3.5" />, github: <GitBranch className="h-3.5 w-3.5" />, google_drive: <HardDrive className="h-3.5 w-3.5" /> };
const SOURCE_LABEL: Record<Doc["sourceType"], string> = { text: "Text", github: "GitHub", google_drive: "Google Drive" };
const READINESS: Record<string, string> = { planned: "Planned", implemented: "Implemented", locally_tested: "Locally tested", infrastructure_blocked: "Infrastructure blocked", production_ready: "Production ready" };

async function api<T>(url: string, init?: { method?: string; json?: unknown }): Promise<T> {
  const mutation = init?.method && init.method !== "GET";
  const r = await fetch(url, {
    cache: "no-store", method: init?.method,
    headers: mutation ? { "X-AZee-Request": "1", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(MESSAGES[d.error] ?? d.error ?? `Request failed (${r.status})`);
  return d.data as T;
}

/** Renders ts_headline's private-use markers as <mark>. */
function Excerpt({ text }: { text: string }) {
  const parts = text.split(/([^]*)/g);
  return <p className="text-sm leading-6">{parts.map((p, i) => p.startsWith("") ? <mark key={i} className="rounded bg-amber-100 px-0.5">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}</p>;
}

export function IndexPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [newName, setNewName] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [mode, setMode] = useState<Doc["sourceType"]>("text");
  const [form, setForm] = useState({ title: "", content: "", repo: "", path: "", ref: "", fileId: "" });
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"collection" | "all">("collection");
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(""); setNotice("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const loadCollections = useCallback(async () => {
    const list = await api<Collection[]>("/api/v1/search/index/collections");
    setCollections(list);
    setCollectionId(current => current && list.some(c => c.id === current) ? current : list[0]?.id ?? "");
  }, []);
  const loadDocs = useCallback(async (id: string) => setDocs(id ? await api<Doc[]>(`/api/v1/search/index/documents?collectionId=${id}`) : []), []);

  useEffect(() => { run("load", async () => { setStatus(await api<Status>("/api/v1/search/index")); await loadCollections(); }); }, [loadCollections]);
  useEffect(() => { loadDocs(collectionId).catch(e => setError((e as Error).message)); }, [collectionId, loadDocs]);

  const createCollection = (e: FormEvent) => { e.preventDefault(); run("collection", async () => {
    const c = await api<Collection>("/api/v1/search/index/collections", { method: "POST", json: { name: newName } });
    setNewName(""); await loadCollections(); setCollectionId(c.id);
  }); };
  const deleteCollection = () => run("collection", async () => {
    const c = collections.find(x => x.id === collectionId);
    if (!c || !confirm(`Delete the collection "${c.name}" and remove its ${c.documents} document(s) from the index?`)) return;
    await api(`/api/v1/search/index/collections/${c.id}`, { method: "DELETE" }); setResults(null); await loadCollections();
  });
  const add = (e: FormEvent) => { e.preventDefault(); run("add", async () => {
    const json = mode === "text" ? { source: "text", collectionId, title: form.title, content: form.content }
      : mode === "github" ? { source: "github", collectionId, repo: form.repo.trim(), path: form.path.trim().replace(/^\/+/, ""), ...(form.ref.trim() ? { ref: form.ref.trim() } : {}) }
      : { source: "google_drive", collectionId, fileId: form.fileId.trim() };
    const r = await api<{ outcome: keyof typeof OUTCOME; document: Doc }>("/api/v1/search/index/documents", { method: "POST", json });
    setNotice(`${OUTCOME[r.outcome]} “${r.document.title}” (version ${r.document.version}, ${r.document.chunks} chunk${r.document.chunks === 1 ? "" : "s"}).`);
    if (r.outcome !== "duplicate") setForm(f => ({ ...f, title: "", content: "" }));
    await Promise.all([loadDocs(collectionId), loadCollections()]);
  }); };
  const sync = (d: Doc) => run(`sync:${d.id}`, async () => {
    const r = await api<{ outcome: keyof typeof OUTCOME; document: Doc }>(`/api/v1/search/index/documents/${d.id}/sync`, { method: "POST" });
    setNotice(`${OUTCOME[r.outcome]} “${r.document.title}” is at version ${r.document.version}.`); await loadDocs(collectionId);
  });
  const remove = (d: Doc) => run(`delete:${d.id}`, async () => {
    if (!confirm(`Remove “${d.title}” from the index?`)) return;
    await api(`/api/v1/search/index/documents/${d.id}`, { method: "DELETE" });
    setNotice(`Removed “${d.title}” from the index.`); setResults(r => r?.filter(x => x.source.documentId !== d.id) ?? null);
    await Promise.all([loadDocs(collectionId), loadCollections()]);
  });
  const search = (e: FormEvent) => { e.preventDefault(); run("search", async () => {
    const p = new URLSearchParams({ q: query, ...(scope === "collection" && collectionId ? { collectionId } : {}) });
    const r = await api<{ results: Result[]; note?: string }>(`/api/v1/search/index/query?${p}`);
    setResults(r.results);
    if (r.note === "NO_SEARCHABLE_TERMS") setNotice("That query has only very common words; add a more specific term.");
  }); };

  if (status && !status.enabled) return <p className="text-sm text-muted-foreground">The search index is turned off on this server.</p>;
  return (
    <div className="space-y-5">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Index status">
        <Database className="h-3.5 w-3.5" />Full-text search (PostgreSQL)
        {status && <Badge variant="outline">{READINESS[status.readiness] ?? status.readiness}</Badge>}
        {status && <span>· Vector search: <strong>{READINESS[status.vectorSearch.readiness]}</strong>{status.vectorSearch.extensionAvailable ? "" : " (pgvector isn't installed)"}</span>}
      </p>
      <p className="text-xs text-muted-foreground">Only documents you add here are indexed. Connected GitHub and Google Drive accounts are never indexed automatically: add one file or document at a time, and sync it when you want the latest version.</p>
      {notice && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <section className="flex flex-wrap items-end gap-2" aria-label="Collections">
        <label className="text-xs font-medium">Collection
          <select aria-label="Collection" value={collectionId} onChange={e => { setCollectionId(e.target.value); setResults(null); }} className="mt-1 block min-w-48 rounded-md border bg-background px-2 py-1.5 text-sm">
            {!collections.length && <option value="">No collections yet</option>}
            {collections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.documents})</option>)}
          </select>
        </label>
        {collectionId && <Button variant="outline" size="sm" disabled={busy !== null} onClick={deleteCollection}><Trash2 className="h-4 w-4" />Delete collection</Button>}
        <form onSubmit={createCollection} className="flex gap-2">
          <Input aria-label="New collection name" placeholder="New collection" value={newName} onChange={e => setNewName(e.target.value)} className="w-48" />
          <Button type="submit" variant="outline" disabled={!newName.trim() || busy !== null}>Create</Button>
        </form>
      </section>

      {collectionId && (
        <form onSubmit={add} className="space-y-2 rounded-xl border p-4" aria-label="Add document">
          <div className="flex flex-wrap gap-2 text-sm" role="radiogroup" aria-label="Source">
            {(["text", "github", "google_drive"] as const).map(m => (
              <label key={m} className="flex items-center gap-1"><input type="radio" name="source" checked={mode === m} onChange={() => setMode(m)} />{SOURCE_LABEL[m]}</label>
            ))}
          </div>
          {mode === "text" && <>
            <Input aria-label="Document title" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <Textarea aria-label="Document text" rows={5} placeholder="Paste text or Markdown (up to 1 MB)" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
          </>}
          {mode === "github" && <div className="grid gap-2 md:grid-cols-3">
            <Input aria-label="Repository" placeholder="owner/repository" value={form.repo} onChange={e => setForm({ ...form, repo: e.target.value })} />
            <Input aria-label="File path" placeholder="docs/guide.md" value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} />
            <Input aria-label="Branch or tag (optional)" placeholder="main (optional)" value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} />
          </div>}
          {mode === "google_drive" && <Input aria-label="Drive file ID" placeholder="Google Drive file ID (from its link)" value={form.fileId} onChange={e => setForm({ ...form, fileId: e.target.value })} />}
          <Button type="submit" disabled={busy !== null}>{busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}Add to index</Button>
        </form>
      )}

      {collectionId && (
        <ul className="divide-y rounded-lg border" aria-label="Indexed documents">
          {docs.map(d => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Badge variant="outline" className="gap-1">{SOURCE_ICON[d.sourceType]}{SOURCE_LABEL[d.sourceType]}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
              <span className="text-xs text-muted-foreground">v{d.version} · {d.chunks} chunk{d.chunks === 1 ? "" : "s"} · indexed {new Date(d.indexedAt).toLocaleString()}</span>
              {d.sourceType !== "text" && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => sync(d)} aria-label={`Sync ${d.title}`}><RefreshCw className="h-3.5 w-3.5" />Sync</Button>}
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => remove(d)} aria-label={`Remove ${d.title}`}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
          {!docs.length && <li className="p-3 text-sm text-muted-foreground">No documents in this collection.</li>}
        </ul>
      )}

      <form onSubmit={search} className="flex flex-wrap gap-2" aria-label="Search the index">
        <Input aria-label="Search your index" placeholder="Search your documents" value={query} onChange={e => setQuery(e.target.value)} className="min-w-64 flex-1" />
        <select aria-label="Search scope" value={scope} onChange={e => setScope(e.target.value as "collection" | "all")} className="rounded-md border bg-background px-2 text-sm">
          <option value="collection">This collection</option><option value="all">All my collections</option>
        </select>
        <Button type="submit" disabled={!query.trim() || busy !== null}>{busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search</Button>
      </form>
      {results && (
        <ol className="space-y-3" aria-label="Index results">
          {results.map(r => (
            <li key={`${r.source.documentId}:${r.location.chunk}`} className="rounded-lg border p-3">
              <Excerpt text={r.excerpt} />
              <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">[{r.n}]</span>
                {r.source.url ? <a href={r.source.url} target="_blank" rel="noopener noreferrer" className="underline">{r.source.title}</a> : <span>{r.source.title}</span>}
                <span>· {SOURCE_LABEL[r.source.sourceType]} · {r.source.collection} · v{r.source.version} · chunk {r.location.chunk + 1} (chars {r.location.start}–{r.location.end}) · indexed {new Date(r.source.indexedAt).toLocaleDateString()}</span>
              </p>
            </li>
          ))}
          {!results.length && <li className="text-sm text-muted-foreground">No matching documents.</li>}
        </ol>
      )}
    </div>
  );
}
