"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, FileText, Folder, GitBranch, HardDrive, Link2, Loader2, Lock, ShieldCheck, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Connectors: GitHub and Google Drive over /api/connectors (OAuth, read-only, audited).

type Status = {
  id: "github" | "google_drive"; label: string; scopes: string[]; requiredEnv: string[];
  keyConfigured: boolean; configured: boolean; enabled: boolean; connected: boolean; account: string | null; grantedScopes: string[]; connectedAt: string | null;
};
type Repo = { fullName: string; private: boolean; defaultBranch: string; description: string | null; updatedAt: string };
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string | null; size: number | null; webViewLink: string | null; readable: boolean };
type AuditRow = { provider: string; action: string; resource: string | null; outcome: string; created_at: string };

const ERRORS: Record<string, string> = {
  CONNECTOR_KEY_MISSING: "Set CONNECTOR_TOKEN_KEY in .env.local first (see below).",
  PROVIDER_NOT_CONFIGURED: "This provider's OAuth credentials aren't set in .env.local.",
  INVALID_STATE: "That sign-in link expired or was already used. Connect again.",
  AUTHORIZATION_DENIED: "Access wasn't granted on the provider's page.",
  OAUTH_EXCHANGE_FAILED: "The provider rejected the sign-in. Check the OAuth app's callback URL and credentials.",
  RECONNECT_REQUIRED: "The connection expired. Disconnect and connect again.",
  NOT_CONNECTED: "Not connected.",
  NOT_A_TEXT_FILE: "Only text files can be shown here.",
  BINARY_FILE: "This is a binary file.",
  FILE_TOO_LARGE: "This file is too large to show.",
  PROVIDER_FORBIDDEN: "The provider refused access to this item.",
  NOT_FOUND: "Not found.",
};
const message = (code?: string) => (code ? ERRORS[code] ?? code : "Request failed.");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (r.status === 204) return undefined as T;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(message(d.error));
  return d.data as T;
}

function GitHubBrowser() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [filter, setFilter] = useState("");
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { run(async () => setRepos(await api<Repo[]>("/api/connectors/github/repos"))); }, []);
  const openRepo = (r: Repo) => run(async () => {
    setRepo(r); setFile(null);
    const [o, n] = r.fullName.split("/");
    setFiles((await api<{ files: { path: string; size: number }[] }>(`/api/connectors/github/repos/${o}/${n}/tree?ref=${encodeURIComponent(r.defaultBranch)}`)).files);
  });
  const openFile = (path: string) => repo && run(async () => {
    const [o, n] = repo.fullName.split("/");
    setFile(await api(`/api/connectors/github/repos/${o}/${n}/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(repo.defaultBranch)}`));
  });
  const shown = files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 300);
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!repo ? (
        repos === null ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading repositories…</p>
          : <ul className="max-h-72 space-y-1 overflow-auto" aria-label="Repositories">{repos.map(r => (
            <li key={r.fullName}><button onClick={() => openRepo(r)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
              {r.private ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="font-medium">{r.fullName}</span><span className="truncate text-xs text-muted-foreground">{r.description}</span>
            </button></li>
          ))}{!repos.length && <li className="text-sm text-muted-foreground">No repositories.</li>}</ul>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm"><button className="text-muted-foreground hover:underline" onClick={() => { setRepo(null); setFile(null); }}>Repositories</button><span>/</span><span className="font-medium">{repo.fullName}</span><Badge variant="outline">{repo.defaultBranch}</Badge></div>
          <div className="grid gap-3 md:grid-cols-[260px_1fr]">
            <div className="space-y-2">
              <Input aria-label="Filter files" placeholder="Filter files" value={filter} onChange={e => setFilter(e.target.value)} />
              <ul className="max-h-80 overflow-auto text-xs" aria-label="Files">{shown.map(f => (
                <li key={f.path}><button onClick={() => openFile(f.path)} className={cn("w-full truncate rounded px-2 py-1 text-left font-mono hover:bg-muted", file?.path === f.path && "bg-muted")}>{f.path}</button></li>
              ))}</ul>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/20">
              {busy && !file ? <p className="p-3 text-sm text-muted-foreground">Loading…</p>
                : file ? <pre className="max-h-96 overflow-auto p-3 text-xs" aria-label={`Contents of ${file.path}`}>{file.content}</pre>
                : <p className="p-3 text-sm text-muted-foreground">Select a file to read it.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DriveBrowser() {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [q, setQ] = useState("");
  const [doc, setDoc] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (query = "") => {
    setError("");
    try { setFiles((await api<{ files: DriveFile[] }>(`/api/connectors/google_drive/files${query ? `?q=${encodeURIComponent(query)}` : ""}`)).files); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const open = async (f: DriveFile) => { setError(""); try { setDoc(await api(`/api/connectors/google_drive/files/${f.id}`)); } catch (e) { setError((e as Error).message); } };
  const search = (e: FormEvent) => { e.preventDefault(); load(q); };
  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2"><Input aria-label="Search Drive" placeholder="Search file names" value={q} onChange={e => setQ(e.target.value)} /><Button type="submit" variant="outline">Search</Button></form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 md:grid-cols-[280px_1fr]">
        <ul className="max-h-80 space-y-1 overflow-auto" aria-label="Drive files">
          {files === null ? <li className="text-sm text-muted-foreground">Loading…</li> : files.map(f => (
            <li key={f.id}><button disabled={!f.readable} onClick={() => open(f)} title={f.readable ? "Read" : "Only text documents can be read here"}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{f.name}</span></button></li>
          ))}
          {files?.length === 0 && <li className="text-sm text-muted-foreground">No files.</li>}
        </ul>
        <div className="min-w-0 rounded-lg border bg-muted/20">
          {doc ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 text-xs" aria-label={`Contents of ${doc.name}`}>{doc.content}</pre> : <p className="p-3 text-sm text-muted-foreground">Select a document to read it.</p>}
        </div>
      </div>
    </div>
  );
}

export function ConnectorsApp() {
  const [items, setItems] = useState<Status[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await api<Status[]>("/api/connectors"));
      setAudit(await api<AuditRow[]>("/api/connectors/audit"));
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) setNotice(`Connected to ${params.get("connected") === "github" ? "GitHub" : "Google Drive"}.`);
    if (params.get("error")) setError(message(params.get("error") ?? undefined));
    if (params.toString()) window.history.replaceState(null, "", "/connectors");
    refresh();
  }, [refresh]);

  const connect = async (s: Status) => {
    setBusy(s.id); setError("");
    try { window.location.assign((await api<{ url: string }>(`/api/connectors/${s.id}/connect`, { method: "POST" })).url); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const disconnect = async (s: Status) => {
    if (!confirm(`Disconnect ${s.label}? Its stored access is deleted and revoked.`)) return;
    setBusy(s.id); setError("");
    try { await api(`/api/connectors/${s.id}`, { method: "DELETE" }); setNotice(`Disconnected ${s.label}.`); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const keyMissing = items?.some(i => !i.keyConfigured);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <header>
        <a href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Workspace</a>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><Link2 className="h-7 w-7 text-emerald-700" />Connectors <Badge variant="outline">Experimental</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only access to your GitHub repositories and Google Drive documents. Tokens are encrypted on this server and never sent to the browser; every access is logged.</p>
      </header>
      {notice && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {keyMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Token encryption key not set.</p>
          <p className="mt-1">Generate one with <code className="rounded bg-amber-100 px-1">node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;</code> and add <code className="rounded bg-amber-100 px-1">CONNECTOR_TOKEN_KEY=…</code> to <code className="rounded bg-amber-100 px-1">.env.local</code>, then restart.</p>
        </div>
      )}

      <div className="grid gap-4">
        {(items ?? []).map(s => (
          <section key={s.id} className="space-y-4 rounded-xl border bg-card p-5 shadow-sm" aria-label={s.label}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {s.id === "github" ? <GitBranch className="h-6 w-6" /> : <HardDrive className="h-6 w-6" />}
                <div>
                  <h2 className="font-semibold">{s.label}</h2>
                  <p className="text-xs text-muted-foreground">
                    {s.connected ? `Connected as ${s.account}` : !s.configured ? "Not configured" : "Not connected"}
                  </p>
                </div>
              </div>
              {s.connected
                ? <Button variant="outline" disabled={busy === s.id} onClick={() => disconnect(s)}><Unplug className="h-4 w-4" />Disconnect</Button>
                : <Button disabled={!s.configured || !s.keyConfigured || !s.enabled || busy === s.id} onClick={() => connect(s)}>{busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Connect</Button>}
            </div>
            {!s.configured && (
              <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                Add {s.requiredEnv.map(v => <code key={v} className="mx-0.5 rounded bg-muted px-1">{v}</code>)} to .env.local. Callback URL for the OAuth app: <code className="rounded bg-muted px-1">{`${typeof window === "undefined" ? "" : window.location.origin}/api/connectors/${s.id}/callback`}</code>
                {s.id === "github" && " (use a GitHub App with Contents: Read-only for read-only private repository access)."}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{s.connected ? "Granted:" : "Requests:"} {(s.connected && s.grantedScopes.length ? s.grantedScopes : s.scopes).map(x => <code key={x} className="rounded bg-muted px-1">{x}</code>)}</p>
            {s.connected && (s.id === "github" ? <GitHubBrowser /> : <DriveBrowser />)}
          </section>
        ))}
      </div>

      <section aria-label="Connector activity">
        <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
        {audit.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-2">When</th><th className="p-2">Provider</th><th className="p-2">Action</th><th className="p-2">Item</th><th className="p-2">Outcome</th></tr></thead>
              <tbody>{audit.map((a, i) => <tr key={i} className="border-t"><td className="p-2">{new Date(a.created_at).toLocaleString()}</td><td className="p-2">{a.provider}</td><td className="p-2 font-mono">{a.action}</td><td className="max-w-xs truncate p-2">{a.resource ?? "—"}</td><td className="p-2">{a.outcome}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-xs text-muted-foreground">No connector activity yet.</p>}
      </section>
    </main>
  );
}
