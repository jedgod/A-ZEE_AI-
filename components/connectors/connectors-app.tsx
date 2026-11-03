"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarDays, GitBranch, HardDrive, Landmark, Loader2, Lock, Mail, Megaphone, Palette, Search,
  ShieldCheck, ShoppingBag, Triangle, Unplug, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CATALOG, providerName, type CatalogDetail, type CatalogEntry } from "@/lib/connectors/catalog";
import { PluginsPage } from "@/components/plugins-page";
import type { Plugin } from "@/lib/plugins/service";
import { api, DriveBrowser, GitHubBrowser, GmailBrowser, message, type AuditRow, type Status } from "./browsers";

// Plugins: the sidebar's destination. Connectors tab = the catalog (row -> detail dialog -> Connect,
// which runs the real OAuth flow in /api/connectors). Skills tab = the governed extensions (/extensions).

const ICONS: Record<string, LucideIcon> = {
  gmail: Mail, google_drive: HardDrive, github: GitBranch, finance: Landmark, google_calendar: CalendarDays,
  canva: Palette, shopify: ShoppingBag, vercel: Triangle, x_ads: Megaphone,
};
const DETAIL_ICONS: Record<CatalogDetail["icon"], LucideIcon> = { search: Search, lock: Lock, shield: ShieldCheck };

function Tile({ id, className }: { id: string; className?: string }) {
  const Icon = ICONS[id] ?? Search;
  return <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background", className)}><Icon className="h-5 w-5" aria-hidden="true" /></span>;
}

function Settings({ plugin, busy, onToggle, onSave }: {
  plugin: Plugin; busy: boolean; onToggle: (enabled: boolean) => void; onSave: (values: Record<string, string | boolean | null>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const value = (k: string) => draft[k] ?? plugin.settings[k];
  const dirty = Object.keys(draft).length > 0;
  return (
    <section aria-label={`${plugin.name} settings`} className="space-y-3 rounded-xl border p-4">
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        <span>Enabled<span className="block text-xs font-normal text-muted-foreground">When off, this plugin is hidden from Chat, Automations and project tools.</span></span>
        <input type="checkbox" role="switch" className="h-5 w-9 accent-emerald-700" checked={plugin.enabled} disabled={busy} onChange={e => onToggle(e.target.checked)} />
      </label>
      {plugin.fields.map(f => (
        <label key={f.key} className="block space-y-1 text-sm">
          <span className="font-medium">{f.label}</span>
          {f.type === "boolean"
            ? <input type="checkbox" className="ml-2" checked={Boolean(value(f.key))} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.checked }))} />
            : f.type === "select"
              ? <select className="block w-full rounded-md border bg-background p-2" value={String(value(f.key))} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}>{f.options?.map(o => <option key={o}>{o}</option>)}</select>
              : <Input type={f.type === "secret" ? "password" : "text"} autoComplete="off" maxLength={f.max}
                placeholder={f.type === "secret" && (plugin.settings[f.key] as { set?: boolean }).set ? "Saved. Type to replace." : undefined}
                value={f.type === "secret" ? String(draft[f.key] ?? "") : String(value(f.key))} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))} />}
          {f.help && <span className="block text-xs text-muted-foreground">{f.help}</span>}
        </label>
      ))}
      {plugin.fields.length > 0 && <Button size="sm" disabled={busy || !dirty} onClick={() => { onSave(draft); setDraft({}); }}>Save settings</Button>}
    </section>
  );
}

function ConnectorDialog({ entry, status, plugin, busy, onConnect, onDisconnect, onToggle, onSave, onClose }: {
  entry: CatalogEntry; status?: Status; plugin?: Plugin; busy: boolean; onConnect: () => void; onDisconnect: () => void;
  onToggle: (enabled: boolean) => void; onSave: (values: Record<string, string | boolean | null>) => void; onClose: () => void;
}) {
  const connected = !!status?.connected;
  const unavailable = !entry.provider ? "Coming soon" : !status ? null
    : !status.enabled ? "Connectors are switched off"
    : !status.keyConfigured ? "Set CONNECTOR_TOKEN_KEY in .env.local"
    : !status.configured ? "Set the OAuth credentials in .env.local" : null;
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className={cn("gap-5 rounded-2xl p-6", connected ? "w-[min(760px,calc(100vw-32px))]" : "w-[min(540px,calc(100vw-32px))]")}>
        <div className="flex items-center justify-between gap-4 pr-8">
          <div className="flex items-center gap-3">
            <Tile id={entry.id} />
            <div>
              <DialogTitle>{entry.name}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">{entry.category}</p>
            </div>
          </div>
          {connected
            ? <Button variant="outline" disabled={busy} onClick={onDisconnect}><Unplug className="h-4 w-4" />Disconnect</Button>
            : <Button disabled={busy || !!unavailable || !status} onClick={onConnect} className="rounded-full px-5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{entry.provider ? "Connect" : "Coming soon"}
            </Button>}
        </div>
        <DialogDescription>{connected ? `Connected as ${status?.account}.` : entry.intro}</DialogDescription>

        {connected && plugin && <Settings key={plugin.id} plugin={plugin} busy={busy} onToggle={onToggle} onSave={onSave} />}

        {connected && entry.provider && plugin?.enabled !== false && (
          <div className="min-w-0">
            {entry.provider === "gmail" ? <GmailBrowser /> : entry.provider === "github" ? <GitHubBrowser /> : <DriveBrowser />}
          </div>
        )}

        {entry.details && (
          <section aria-label={`About ${entry.name}`} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">About this Connector</h3>
            <ul className="space-y-4 rounded-xl border bg-muted/30 p-4">
              {entry.details.map(d => {
                const Icon = DETAIL_ICONS[d.icon];
                return (
                  <li key={d.title} className="flex gap-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div><p className="text-sm font-medium">{d.title}</p><p className="mt-0.5 text-sm text-muted-foreground">{d.body}</p></div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {unavailable && entry.provider && status && (
          <p role="status" className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {unavailable}.
            {status.configured ? null : <> Needs {status.requiredEnv.map(v => <code key={v} className="mx-0.5 rounded bg-muted px-1">{v}</code>)}; the OAuth callback URL is <code className="rounded bg-muted px-1">{`${window.location.origin}/api/connectors/${status.id}/callback`}</code>.</>}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Third-party connectors are not built or maintained by AZ_AI. Use caution when granting access to external services. Review the permissions before connecting
          {status ? <>: <span>{(connected && status.grantedScopes.length ? status.grantedScopes : status.scopes).map(s => s.replace("https://www.googleapis.com/auth/", "")).join(", ")}</span>.</> : "."}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectorsApp() {
  const [tab, setTab] = useState<"connectors" | "skills">("connectors");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Status[] | null>(null);
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    api<Plugin[]>("/api/plugins").then(setPlugins).catch(() => setPlugins([]));
    try {
      setItems(await api<Status[]>("/api/connectors"));
      setAudit(await api<AuditRow[]>("/api/connectors/audit"));
    } catch (e) { setError((e as Error).message); setItems(i => i ?? []); }
  }, []);
  // Returning from a provider's consent page: reopen that connector's dialog with the result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected"), provider = params.get("provider");
    if (params.get("tab") === "skills") setTab("skills");
    if (connected) { setNotice(`Connected to ${providerName(connected)}.`); setOpen(connected); }
    if (params.get("error")) { setError(message(params.get("error") ?? undefined)); if (provider) setOpen(provider); }
    if (params.toString()) window.history.replaceState(null, "", "/connectors");
    refresh();
  }, [refresh]);

  const statusOf = (e: CatalogEntry) => items?.find(s => s.id === e.provider);
  const entry = CATALOG.find(c => c.id === open) ?? null;
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

  const patchPlugin = async (id: string, change: { enabled?: boolean; settings?: Record<string, unknown> }, done: string) => {
    setBusy(id); setError("");
    try {
      await api(`/api/plugins/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      setNotice(done); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const togglePlugin = (p: Plugin, enabled: boolean) => {
    if (p.kind === "skill" && enabled && !confirm(`Approve ${p.name} v${p.version} with permissions: ${p.permissions?.join(", ") || "none"}?`)) return;
    patchPlugin(p.id, { enabled }, `${p.name} ${enabled ? "enabled" : "disabled"}.`);
  };
  const pluginOf = (e: CatalogEntry) => plugins?.find(p => p.kind === "connector" && p.id === e.provider);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = CATALOG.filter(c => !q || `${c.name} ${c.summary} ${c.category}`.toLowerCase().includes(q));
    return (["Featured", "Advertising"] as const).map(name => ({ name, entries: shown.filter(c => c.section === name) })).filter(s => s.entries.length);
  }, [query]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <a href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Workspace</a>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Plugins" className="flex gap-1 rounded-full bg-muted/60 p-1">
          {(["connectors", "skills"] as const).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("rounded-full px-4 py-1.5 text-sm font-medium capitalize text-muted-foreground", tab === t && "bg-background text-foreground shadow-sm")}>{t}</button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label={`Search ${tab}`} placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} className="rounded-full pl-9" />
        </div>
      </div>

      {notice && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {tab === "skills" ? <PluginsPage plugins={(plugins ?? []).filter(p => p.kind !== "connector")} loaded={plugins !== null} query={query} busy={busy} onToggle={togglePlugin} /> : (
        <>
          {sections.map(section => (
            <section key={section.name} aria-label={section.name}>
              <h2 className="mb-2 text-lg font-semibold">{section.name}</h2>
              <ul>
                {section.entries.map(e => {
                  const connected = !!statusOf(e)?.connected;
                  const off = connected && pluginOf(e)?.enabled === false;
                  return (
                    <li key={e.id} className="flex items-center gap-4 rounded-xl py-3 hover:bg-muted/40">
                      <button type="button" onClick={() => setOpen(e.id)} aria-label={`${e.name}: ${e.summary}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-xl px-2 text-left">
                        <Tile id={e.id} />
                        <span className="min-w-0"><span className="block font-medium">{e.name}</span><span className="block truncate text-sm text-muted-foreground">{e.summary}</span></span>
                      </button>
                      {connected
                        ? <Badge variant="secondary" className="mr-2">{off ? "Disabled" : "Connected"}</Badge>
                        : <Button variant="secondary" size="sm" className="mr-2" onClick={() => setOpen(e.id)} aria-label={`Add ${e.name}`}>Add</Button>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!sections.length && <p className="text-sm text-muted-foreground">No connectors match “{query}”.</p>}

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
        </>
      )}

      {entry && (
        <ConnectorDialog entry={entry} status={statusOf(entry)} plugin={pluginOf(entry)} busy={busy === entry.provider && !!entry.provider}
          onConnect={() => { const s = statusOf(entry); if (s) connect(s); }}
          onDisconnect={() => { const s = statusOf(entry); if (s) disconnect(s); }}
          onToggle={enabled => patchPlugin(entry.provider!, { enabled }, `${entry.name} ${enabled ? "enabled" : "disabled"}.`)}
          onSave={settings => patchPlugin(entry.provider!, { settings }, `${entry.name} settings saved.`)}
          onClose={() => setOpen(null)} />
      )}
    </main>
  );
}
