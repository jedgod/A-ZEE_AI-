"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, Empty, ErrorLine, RailShell, useUserGate } from "./shell";

// The four rail pages. Each one sends guests to sign-in first; every call goes to an
// authenticated /api route that only returns the signed-in user's own rows.

function useList<T>(url: string, ready: boolean) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setItems(await api<T[]>(url)); setError(""); } catch (e) { setError((e as Error).message); setItems(a => a ?? []); }
  }, [url]);
  useEffect(() => { if (ready) load(); }, [ready, load]);
  return { items, error, setError, load };
}
const when = (iso: string) => new Date(iso).toLocaleString();

// ---------------------------------------------------------------- favorites
type Fav = { id: string; title: string; mode: string; updatedAt: string };
export function FavoritesPage() {
  const user = useUserGate();
  const { items, error, setError, load } = useList<Fav>("/api/favorites", !!user);
  if (!user) return null;
  const remove = async (id: string) => { try { await api(`/api/favorites?chatId=${id}`, "DELETE"); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <RailShell title="Favorites" description="Chats you've starred. Star a chat from the sidebar's chat menu, or add one here by id from Recent.">
      <ErrorLine message={error} />
      {items === null ? <Empty>Loading…</Empty> : !items.length ? <Empty>No favorites yet.</Empty> : (
        <ul className="divide-y rounded-xl border">
          {items.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/?chat=${encodeURIComponent(c.id)}`} className="min-w-0 flex-1">
                <p className="truncate font-medium"><Star className="mr-1.5 inline h-3.5 w-3.5 fill-current text-amber-500" />{c.title}</p>
                <p className="text-xs text-muted-foreground">{c.mode} · updated {when(c.updatedAt)}</p>
              </Link>
              <Button variant="ghost" size="icon" aria-label={`Remove ${c.title} from favorites`} onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <RecentPicker onAdded={load} />
    </RailShell>
  );
}

function RecentPicker({ onAdded }: { onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Fav[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { api<Fav[]>(`/api/chats/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const add = async (id: string) => { try { await api("/api/favorites", "POST", { chatId: id }); setError(""); onAdded(); } catch (e) { setError((e as Error).message); } };
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold">Find a chat to favorite</h2>
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search your chats by title" aria-label="Search your chats" maxLength={100} />
      <ErrorLine message={error} />
      {q.trim() && (
        <ul className="mt-2 divide-y rounded-xl border">
          {results.length ? results.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="truncate">{c.title}</span>
              <Button size="sm" variant="outline" onClick={() => add(c.id)}><Star className="mr-1 h-3 w-3" />Favorite</Button>
            </li>
          )) : <li className="p-3 text-sm text-muted-foreground">No chats match.</li>}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------ notifications
type Note = { id: string; title: string; body: string | null; read: boolean; createdAt: string };
export function NotificationsPage() {
  const user = useUserGate();
  const { items, error, setError, load } = useList<Note>("/api/notifications", !!user);
  if (!user) return null;
  const act = async (body: unknown) => { try { await api("/api/notifications", "PATCH", body); await load(); window.dispatchEvent(new Event("az:notifications")); } catch (e) { setError((e as Error).message); } };
  const unread = items?.filter(n => !n.read).length ?? 0;
  return (
    <RailShell title="Notifications" description={unread ? `${unread} unread` : "You're all caught up."}
      actions={unread > 0 ? <Button variant="outline" size="sm" onClick={() => act({ all: true })}>Mark all read</Button> : undefined}>
      <ErrorLine message={error} />
      {items === null ? <Empty>Loading…</Empty> : !items.length ? <Empty>No notifications.</Empty> : (
        <ul className="divide-y rounded-xl border">
          {items.map(n => (
            <li key={n.id} className={`flex items-start justify-between gap-3 p-3 ${n.read ? "" : "bg-primary/5"}`}>
              <div className="min-w-0">
                <p className="font-medium">{!n.read && <span aria-label="Unread" className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" />}{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{when(n.createdAt)}</p>
              </div>
              {!n.read && <Button variant="ghost" size="sm" onClick={() => act({ id: n.id })}>Mark read</Button>}
            </li>
          ))}
        </ul>
      )}
    </RailShell>
  );
}

// ------------------------------------------------------------------ library
type Prompt = { id: string; title: string; content: string; createdAt: string };
export function LibraryPage() {
  const user = useUserGate();
  const { items, error, setError, load } = useList<Prompt>("/api/prompts", !!user);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    setBusy(true);
    try { await api("/api/prompts", "POST", { title: data.get("title"), content: data.get("content") }); form.reset(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { try { await api(`/api/prompts?id=${id}`, "DELETE"); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <RailShell title="Prompt library" description="Prompts you reuse. Open one to start a chat with it.">
      <form onSubmit={add} className="mb-6 space-y-2 rounded-xl border p-4">
        <Input name="title" required maxLength={80} placeholder="Title" aria-label="Prompt title" />
        <Textarea name="content" required maxLength={4000} placeholder="The prompt text" aria-label="Prompt text" className="min-h-[96px]" />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save prompt"}</Button>
      </form>
      <ErrorLine message={error} />
      {items === null ? <Empty>Loading…</Empty> : !items.length ? <Empty>Your library is empty. Save a prompt above.</Empty> : (
        <ul className="space-y-3">
          {items.map(p => (
            <li key={p.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium">{p.title}</h2>
                <Button variant="ghost" size="icon" aria-label={`Delete ${p.title}`} onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{p.content}</p>
              <Link href={`/?prompt=${encodeURIComponent(p.content.slice(0, 1500))}`} className="mt-2 inline-block text-sm underline underline-offset-2">Use in a new chat</Link>
            </li>
          ))}
        </ul>
      )}
    </RailShell>
  );
}

// ----------------------------------------------------------------- projects
type Project = { id: string; name: string };
export function ProjectsPage() {
  const user = useUserGate();
  const { items, error, setError, load } = useList<Project>("/api/projects", !!user);
  const [name, setName] = useState("");
  if (!user) return null;
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try { await api("/api/projects", "POST", { name }); setName(""); await load(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <RailShell title="Projects" description="Group chats and give them shared instructions.">
      <form onSubmit={add} className="mb-6 flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="New project name" aria-label="New project name" />
        <Button type="submit" disabled={!name.trim()}>Create</Button>
      </form>
      <ErrorLine message={error} />
      {items === null ? <Empty>Loading…</Empty> : !items.length ? <Empty>No projects yet.</Empty> : (
        <ul className="divide-y rounded-xl border">
          {items.map(p => <li key={p.id}><Link href={`/?project=${encodeURIComponent(p.id)}`} className="block p-3 font-medium hover:bg-muted/50">{p.name}</Link></li>)}
        </ul>
      )}
    </RailShell>
  );
}
