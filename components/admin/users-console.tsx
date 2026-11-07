"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Download, MessageSquare, Plus, Shield, Trash2, UserCheck, UserX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Client side of /admin/users: row selection, tags, notes, bulk actions, promotion and saved views.
// All writes go to /api/admin/* which enforces sign-in, same-origin, permissions, rate limits and audit.

export type UserRow = {
  userId: string; name: string; email: string; role: string; status: string; sessions: number;
  tags: { id: string; name: string; color: string }[]; isSelf: boolean;
};
type SavedView = { id: string; name: string; filters: { view?: string; q?: string } };

const MESSAGES: Record<string, string> = {
  FORBIDDEN: "Your role doesn't allow this.", INVALID_ORIGIN: "Origin check failed. Check APP_ORIGIN.",
  RATE_LIMITED: "Too many changes. Wait a minute.", NO_VALID_TARGETS: "Nothing to change (you can't act on yourself).",
  NOT_ELIGIBLE: "No selected user is eligible.", ALREADY_ADMIN: "That user is already an admin.",
  SELF_MEMBERSHIP_CHANGE_DENIED: "You can't change your own role.", INVALID_INPUT: "Some input is invalid.",
  TOO_MANY_VIEWS: "You have reached the saved-view limit.", USER_NOT_FOUND: "User not found.",
};

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(MESSAGES[data.error] ?? data.error ?? `Request failed (${res.status})`);
  return data;
}

function download(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function Tags({ user, canWrite, run }: { user: UserRow; canWrite: boolean; run: (work: () => Promise<unknown>) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {user.tags.map(t => (
        <Badge key={t.id} variant="secondary" className="gap-1">
          <span style={{ color: t.color }} aria-hidden>●</span>{t.name}
          {canWrite && <button aria-label={`Remove tag ${t.name}`} className="rounded hover:bg-muted"
            onClick={() => run(() => api(`/api/admin/user-tags?userId=${user.userId}&tagId=${t.id}`, "DELETE"))}><X className="h-3 w-3" /></button>}
        </Badge>
      ))}
      {canWrite && (adding ? (
        <form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; run(() => api("/api/admin/user-tags", "POST", { userId: user.userId, name })); setName(""); setAdding(false); }}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="tag" aria-label="New tag" className="h-7 w-24 text-xs" />
          <Button type="submit" size="sm" className="h-7 px-2">Add</Button>
        </form>
      ) : <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Add tag" onClick={() => setAdding(true)}><Plus className="h-3 w-3" /></Button>)}
    </div>
  );
}

function Notes({ user, canWrite, isOwner }: { user: UserRow; canWrite: boolean; isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<{ id: string; content: string; author: string; createdAt: string }[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const load = () => api(`/api/admin/user-notes?userId=${user.userId}`, "GET").then(d => setNotes(d.notes)).catch(e => setError((e as Error).message));
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (work: () => Promise<unknown>) => { setError(""); try { await work(); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}><MessageSquare className="mr-1 h-3 w-3" />Notes</Button>
      {open && (
        <div className="mt-2 w-72 space-y-2 rounded-md border p-3">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {notes.length ? notes.map(n => (
              <div key={n.id} className="flex items-start justify-between gap-2 text-sm">
                <div><p className="whitespace-pre-wrap break-words">{n.content}</p>
                  <p className="text-xs text-muted-foreground">{n.author} · {new Date(n.createdAt).toLocaleString()}</p></div>
                {canWrite && <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Delete note" onClick={() => act(() => api(`/api/admin/user-notes?id=${n.id}`, "DELETE"))}><Trash2 className="h-3 w-3" /></Button>}
              </div>
            )) : <p className="text-xs text-muted-foreground">No notes yet.</p>}
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <Textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="Add a note" aria-label="New note" className="min-h-[56px] text-sm" />
              <Button size="sm" disabled={!text.trim()} onClick={() => act(async () => { await api("/api/admin/user-notes", "POST", { userId: user.userId, content: text }); setText(""); })}>Add</Button>
            </div>
          )}
          {isOwner && <p className="text-[11px] text-muted-foreground">Owners can delete any note; others can delete their own.</p>}
        </div>
      )}
    </div>
  );
}

function SavedViews({ current }: { current: { view: string; q: string } }) {
  const router = useRouter();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const load = () => api("/api/admin/saved-views", "GET").then(d => setViews(d.views)).catch(() => undefined);
  useEffect(() => { load(); }, []);
  const go = (f: SavedView["filters"]) => router.push(`/admin/users?view=${encodeURIComponent(f.view ?? "all")}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`);
  const act = async (work: () => Promise<unknown>) => { setError(""); try { await work(); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {views.map(v => (
        <span key={v.id} className="flex items-center">
          <Button size="sm" variant="outline" className="gap-1" onClick={() => go(v.filters)}><Bookmark className="h-3 w-3" />{v.name}</Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Delete view ${v.name}`} onClick={() => act(() => api(`/api/admin/saved-views?id=${v.id}`, "DELETE"))}><X className="h-3 w-3" /></Button>
        </span>
      ))}
      {naming ? (
        <form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (!name.trim()) return; act(() => api("/api/admin/saved-views", "POST", { name, filters: { view: current.view, ...(current.q ? { q: current.q } : {}) } })); setName(""); setNaming(false); }}>
          <Input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="View name" aria-label="View name" className="h-8 w-36" />
          <Button type="submit" size="sm">Save</Button>
        </form>
      ) : <Button size="sm" variant="ghost" onClick={() => setNaming(true)}><Plus className="mr-1 h-3 w-3" />Save current view</Button>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

function PromoteDialog({ targets, open, onClose, onDone }: { targets: UserRow[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const bulk = targets.length > 1;
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setPhrase(""); setError(""); } }, [open]);
  const ready = !busy && (!bulk || phrase === "PROMOTE");
  const submit = async () => {
    setBusy(true); setError("");
    try {
      if (bulk) await api("/api/admin/users/bulk-promote", "POST", { ids: targets.map(t => t.userId), confirmPhrase: "PROMOTE" });
      else await api("/api/admin/users/promote", "POST", { userId: targets[0].userId, confirm: true });
      onDone(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bulk ? `Promote ${targets.length} users to admin` : "Promote to admin"}</DialogTitle>
          <DialogDescription>
            {bulk ? "These users get admin access to the console, including user management and billing. Every change is audited."
              : `${targets[0]?.name} (${targets[0]?.email}) will get admin access to the console, including user management and billing. This is audited.`}
          </DialogDescription>
        </DialogHeader>
        {bulk && <Input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder="Type PROMOTE to confirm" aria-label="Type PROMOTE to confirm" autoFocus />}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={!ready} onClick={submit}>{busy ? "Promoting…" : "Confirm promotion"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersConsole({ users, canWrite, isOwner, current }: { users: UserRow[]; canWrite: boolean; isOwner: boolean; current: { view: string; q: string } }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [promote, setPromote] = useState<UserRow[] | null>(null);
  // Self and owners can't be bulk-changed; keep them out of the selectable set.
  const selectable = users.filter(u => !u.isSelf && u.role !== "owner");
  const chosen = users.filter(u => selected.includes(u.userId));
  const eligible = chosen.filter(u => !["owner", "admin"].includes(u.role));

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const bulk = (action: "suspend" | "unsuspend" | "export") => run(async () => {
    const data = await api("/api/admin/users/bulk", "POST", { ids: selected, action });
    if (action === "export") download(data.csv); else setSelected([]);
  });

  return (
    <>
      <SavedViews current={current} />
      {error && <p role="alert" className="mb-3 rounded-md border border-destructive/40 p-2 text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {canWrite && <th className="w-10 p-3"><input type="checkbox" aria-label="Select all" checked={selectable.length > 0 && selected.length === selectable.length}
                onChange={e => setSelected(e.target.checked ? selectable.slice(0, 100).map(u => u.userId) : [])} /></th>}
              {["Person", "Role", "Status", "Tags", "Sessions", ""].map(h => <th key={h} className="whitespace-nowrap p-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={7} className="p-6 text-muted-foreground">No users match this view.</td></tr>}
            {users.map(u => {
              const pickable = !u.isSelf && u.role !== "owner";
              return (
                <tr key={u.userId} className="border-t align-top">
                  {canWrite && <td className="p-3"><input type="checkbox" aria-label={`Select ${u.name}`} disabled={!pickable} checked={selected.includes(u.userId)}
                    onChange={e => setSelected(e.target.checked ? [...selected, u.userId] : selected.filter(id => id !== u.userId))} /></td>}
                  <td className="p-3"><p className="font-medium">{u.name}{u.isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</p><p className="text-xs text-muted-foreground">{u.email}</p></td>
                  <td className="p-3"><Badge variant={u.role === "owner" || u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></td>
                  <td className="p-3"><Badge variant={u.status === "suspended" ? "destructive" : "default"}>{u.status}</Badge></td>
                  <td className="p-3"><Tags user={u} canWrite={canWrite} run={run} /></td>
                  <td className="p-3">{u.sessions}</td>
                  <td className="space-y-1 p-3">
                    <Notes user={u} canWrite={canWrite} isOwner={isOwner} />
                    {isOwner && pickable && !["owner", "admin"].includes(u.role) && u.status === "active" &&
                      <Button variant="ghost" size="sm" onClick={() => setPromote([u])}><Shield className="mr-1 h-3 w-3" />Promote</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && selected.length > 0 && (
        <div role="toolbar" aria-label="Bulk actions" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border bg-background px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => bulk("suspend")}><UserX className="mr-1 h-3 w-3" />Suspend</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => bulk("unsuspend")}><UserCheck className="mr-1 h-3 w-3" />Unsuspend</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => bulk("export")}><Download className="mr-1 h-3 w-3" />Export CSV</Button>
          {isOwner && <Button size="sm" variant="outline" disabled={busy || eligible.length === 0 || eligible.length > 20} onClick={() => setPromote(eligible)}><Shield className="mr-1 h-3 w-3" />Promote to admin</Button>}
          <Button size="icon" variant="ghost" aria-label="Clear selection" onClick={() => setSelected([])}><X className="h-4 w-4" /></Button>
        </div>
      )}

      <PromoteDialog targets={promote ?? []} open={!!promote?.length} onClose={() => setPromote(null)} onDone={() => { setSelected([]); router.refresh(); }} />
    </>
  );
}
