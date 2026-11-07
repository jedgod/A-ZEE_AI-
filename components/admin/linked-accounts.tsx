"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = {
  userId: string; email: string; name: string; walled: boolean; allowed: boolean; note: string | null;
  linked: number; exhaustedLinked: number; evaluatedAt: string;
  links: { email: string; reasons: string[]; exhausted: boolean }[];
};

export function LinkedAccounts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (query = "") => {
    try {
      const res = await fetch(`/api/admin/linked-accounts?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "FORBIDDEN" ? "Your role doesn't allow this." : "Couldn't load linked accounts.");
      setRows(data.accounts); setError("");
    } catch (e) { setError((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function allow(row: Row, allowed: boolean) {
    const res = await fetch("/api/admin/linked-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: row.userId, allowed }) });
    if (!res.ok) { setError("Couldn't update that account."); return; }
    load(q);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form className="flex max-w-sm flex-1 gap-2" onSubmit={e => { e.preventDefault(); load(q); }}>
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email or name" aria-label="Search" maxLength={100} />
          <Button type="submit" size="sm" variant="outline">Search</Button>
        </form>
        <Button asChild size="sm" variant="outline"><a href={`/api/admin/linked-accounts?format=csv&q=${encodeURIComponent(q)}`} download>Export CSV</a></Button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-destructive/40 p-2 text-sm text-destructive">{error}</p>}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : !rows.length ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No linked accounts. Accounts appear here when they share a device with another account.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.userId} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{r.name} <span className="font-normal text-muted-foreground">{r.email}</span></p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {r.walled ? <Badge variant="destructive">Upgrade wall</Badge> : r.allowed ? <Badge variant="secondary">Cleared by admin</Badge> : <Badge variant="outline">Watching</Badge>}
                    {r.linked} linked · {r.exhaustedLinked} used their free allowance
                  </p>
                </div>
                {r.allowed ? <Button size="sm" variant="outline" onClick={() => allow(r, false)}>Restore automatic handling</Button>
                  : <Button size="sm" variant="outline" onClick={() => allow(r, true)}>Allow this account</Button>}
              </div>
              <ul className="mt-3 space-y-1 border-t pt-3 text-sm">
                {r.links.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{l.email}</span>
                    <span className="text-xs text-muted-foreground">{l.reasons.join(" + ")}{l.exhausted ? " · used free allowance" : ""}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted-foreground">Accounts are linked only by a shared device cookie, or a matching browser fingerprint on the same network. An IP address alone never links accounts. This only ever shows the free plan's upgrade prompt; it never bans anyone. Signals are deleted after 90 days.</p>
    </div>
  );
}
