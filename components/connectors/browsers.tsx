"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Folder, Loader2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/lib/connectors/types";

// Read-only browsers for a connected GitHub, Google Drive or Gmail account, over /api/connectors.

export type Status = {
  id: ProviderId; label: string; scopes: string[]; requiredEnv: string[];
  keyConfigured: boolean; configured: boolean; enabled: boolean; connected: boolean; account: string | null; grantedScopes: string[]; connectedAt: string | null;
};
type Repo = { fullName: string; private: boolean; defaultBranch: string; description: string | null; updatedAt: string };
type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string | null; size: number | null; webViewLink: string | null; readable: boolean };
export type AuditRow = { provider: string; action: string; resource: string | null; outcome: string; created_at: string };

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
  PLUGIN_DISABLED: "This plugin is switched off. Turn it on in its settings.",
  STAFF_REQUIRED: "Only a staff admin can change skills.",
  STAFF_SIGN_IN_REQUIRED: "Sign in with a staff admin account to change skills.",
  NOT_FOUND: "Not found.",
};
export const message = (code?: string) => (code ? ERRORS[code] ?? code : "Request failed.");

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  if (r.status === 204) return undefined as T;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(message(d.error));
  return d.data as T;
}

export function GitHubBrowser() {
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

export function DriveBrowser() {
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


type Mail = { id: string; from: string; subject: string; date: string | null; snippet: string; unread: boolean };

export function GmailBrowser() {
  const [mail, setMail] = useState<Mail[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (query = "") => {
    setError("");
    try { setMail((await api<{ messages: Mail[] }>(`/api/connectors/gmail/messages${query ? `?q=${encodeURIComponent(query)}` : ""}`)).messages); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const search = (e: FormEvent) => { e.preventDefault(); setMail(null); load(q); };
  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <Input aria-label="Search Gmail" placeholder="Search mail (e.g. is:unread, from:ana)" value={q} onChange={e => setQ(e.target.value)} />
        <Button type="submit" variant="outline">Search</Button>
        <Button type="button" variant="ghost" onClick={() => { setQ("is:unread"); setMail(null); load("is:unread"); }}>Unread</Button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <ul className="max-h-80 divide-y overflow-auto rounded-lg border" aria-label="Messages">
        {mail === null ? <li className="p-3 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading…</li> : mail.map(m => (
          <li key={m.id} className="space-y-0.5 px-3 py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("truncate", m.unread && "font-semibold")}>{m.from}</span>
              {m.date && <time className="shrink-0 text-xs text-muted-foreground">{new Date(m.date).toLocaleDateString()}</time>}
            </div>
            <p className={cn("truncate", m.unread && "font-medium")}>{m.subject}</p>
            <p className="truncate text-xs text-muted-foreground">{m.snippet}</p>
          </li>
        ))}
        {mail?.length === 0 && <li className="p-3 text-sm text-muted-foreground">No messages.</li>}
      </ul>
    </div>
  );
}
