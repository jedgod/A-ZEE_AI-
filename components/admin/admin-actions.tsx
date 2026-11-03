"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Write controls for /admin. They call the existing /api/admin routes, which enforce role
// permissions, same-origin, optimistic revisions, rate limits and the audit log.

const MESSAGES: Record<string, string> = {
  FORBIDDEN: "Your role doesn't allow this.",
  OWNER_REQUIRED: "Only the tenant owner can do this.",
  SELF_APPROVAL_DENIED: "You can't approve your own request.",
  REVISION_CONFLICT: "Someone changed this first. Reload and try again.",
  APPROVAL_ALREADY_CHANGED: "This approval was already decided.",
  STALE_RESOURCE: "The item changed after the approval was requested.",
  INVALID_ORIGIN: "Origin check failed. Check APP_ORIGIN.",
  INVALID_INPUT: "Some fields are invalid.",
  RATE_LIMITED: "Too many changes. Wait a minute.",
};

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return;
  const data = await response.json().catch(() => ({}));
  throw new Error(MESSAGES[data.error] ?? data.error ?? `Request failed (${response.status})`);
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); router.refresh(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

export type Field =
  | { name: string; label: string; kind: "text" | "textarea" | "number"; required?: boolean; placeholder?: string }
  | { name: string; label: string; kind: "select"; options: string[] }
  | { name: string; label: string; kind: "checkbox" }
  | { name: string; label: string; kind: "lines"; placeholder?: string };

/** Create form for one admin module. `fixed` adds server-meaningful values (e.g. owner = me). */
export function CreateRecord({ module, title, fields, fixed = {} }: { module: string; title: string; fields: Field[]; fixed?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { ...fixed };
    for (const f of fields) {
      const raw = form.get(f.name);
      if (f.kind === "checkbox") payload[f.name] = raw === "on";
      else if (f.kind === "number") payload[f.name] = Number(raw);
      else if (f.kind === "lines") payload[f.name] = String(raw ?? "").split("\n").map(s => s.trim()).filter(Boolean);
      else if (String(raw ?? "").trim()) payload[f.name] = String(raw).trim();
    }
    if (await run(() => call(`/api/admin/${module}`, "POST", payload))) setOpen(false);
  }

  if (!open) return <Button onClick={() => setOpen(true)}>{title}</Button>;
  return (
    <form onSubmit={submit} className="w-full space-y-3 rounded-xl border bg-card p-4 md:w-96">
      <p className="font-medium">{title}</p>
      {fields.map(f => (
        <div key={f.name} className="space-y-1">
          {f.kind === "checkbox" ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={f.name} /> {f.label}</label>
          ) : (
            <>
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.kind === "select" ? (
                <select id={`f-${f.name}`} name={f.name} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.kind === "textarea" || f.kind === "lines" ? (
                <Textarea id={`f-${f.name}`} name={f.name} rows={3} placeholder={f.placeholder} maxLength={4000} />
              ) : (
                <Input id={`f-${f.name}`} name={f.name} type={f.kind === "number" ? "number" : "text"} step="any" min={f.kind === "number" ? 0 : undefined}
                  required={f.required} placeholder={f.placeholder} maxLength={f.kind === "text" ? 200 : undefined} />
              )}
            </>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

/** Replace one field of a record's payload (status changes, enable toggles). */
export function UpdateField({ module, id, revision, payload, field, options, label }: {
  module: string; id: string; revision: number; payload: Record<string, unknown>; field: string; options: (string | boolean)[]; label: string;
}) {
  const { busy, error, run } = useAction();
  const current = String(payload[field]);
  return (
    <span className="inline-flex flex-col gap-1">
      <select aria-label={label} disabled={busy} value={current} className="h-8 rounded-md border bg-background px-2 text-xs"
        onChange={e => {
          const value = options.find(o => String(o) === e.target.value);
          run(() => call(`/api/admin/${module}/${id}`, "PATCH", { revision, payload: { ...payload, [field]: value } }));
        }}>
        {options.map(o => <option key={String(o)} value={String(o)}>{typeof o === "boolean" ? (o ? "enabled" : "disabled") : o}</option>)}
      </select>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function Decide({ id, revision }: { id: string; revision: number }) {
  const { busy, error, run } = useAction();
  const decide = (decision: "approved" | "rejected") => run(() => call(`/api/admin/approvals/${id}/decision`, "POST", { revision, decision }));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => decide("approved")}>Approve</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("rejected")}>Reject</Button>
      </span>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function Remove({ module, id, revision, label = "Remove" }: { module: string; id: string; revision: number; label?: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="ghost" disabled={busy}
        onClick={() => { if (confirm(`${label}? This is recorded in the audit log.`)) run(() => call(`/api/admin/${module}/${id}?revision=${revision}`, "DELETE")); }}>
        {label}
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Request approval for a policy, registry or billing change (reviewers decide in Approvals). */
export function RequestApproval({ id, revision, requestedBy, title }: { id: string; revision: number; requestedBy: string; title: string }) {
  const { busy, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="outline" disabled={busy}
        onClick={() => {
          const reason = prompt(`Why should "${title}" be approved?`);
          if (reason?.trim()) run(() => call("/api/admin/approvals", "POST", { resourceId: id, resourceRevision: revision, requestedBy, reason: reason.trim(), title: `Review: ${title}`.slice(0, 200) }));
        }}>
        Request approval
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
