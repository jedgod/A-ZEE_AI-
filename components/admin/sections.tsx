import Link from "next/link";
import { CreateRecord, Decide, Remove, RequestApproval, UpdateField } from "@/components/admin/admin-actions";
import { Metric, PageHeader, Section, Status, Table, when } from "@/components/admin/admin-ui";
import { ActivityFeed } from "@/components/live/activity-feed";
import { loadActivity } from "@/lib/admin/live";
import { UsersConsole } from "@/components/admin/users-console";
import { tagsByUser } from "@/lib/admin/user-tools";
import { liveProviders, members, overview, records, tenants, usage } from "@/lib/admin/console";
import type { PayloadMap } from "@/lib/admin/contracts";
import { can, permissionsFor, ROLE_ORDER, type Actor } from "@/lib/admin/security";

// The nine 15_ADMIN sections, on real data. Layouts follow the 15_ADMIN mock pages; their
// sample rows are replaced by tenant-scoped queries (lib/admin/console.ts), and their buttons by
// controls that call /api/admin (components/admin/admin-actions.tsx).

const P = (payload: unknown) => payload as Record<string, unknown>;

export async function Dashboard({ actor }: { actor: Actor }) {
  const [o, activity] = await Promise.all([overview(actor), loadActivity(actor, { kinds: ["admin", "pipeline", "feedback"], limit: 8 }).catch(() => null)]);
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · dashboard" title="Governance dashboard"
        description="Live counts for this tenant. Pipeline figures are the last 24 hours of request metadata (no prompts or answers)."
        actions={<><Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href="/api/insights?days=1&download=1">Export metadata</Link>
          {can(actor, "approvals.write") && <Link className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" href="/admin/approvals">Approval queue</Link>}</>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Requests (24h)" value={o.requests} note={`${o.failed} failed`} />
        <Metric label="Active members" value={o.members} />
        <Metric label="Policy blocks (24h)" value={o.blocked} note="rejected by the safety checks" />
        <Metric label="Approval queue" value={o.pending_approvals} note="pending decisions" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title="Operational overview" note="last 24h">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric label="Model calls" value={o.model_calls} note="all provider attempts" />
            <Metric label="Enabled policies" value={o.enabled_policies} />
            <Metric label="Paid plans" value={o.subscriptions.active} note={`${o.subscriptions.pending} awaiting payment`} />
          </div>
          <Section title="Live activity" note="admin changes, pipeline events, feedback">
            <ActivityFeed compact initial={activity} />
          </Section>
        </Section>
        <Section title="Open incidents" note={`${o.open_incidents} open`}>
          <div className="space-y-3">
            {o.incidents.length ? o.incidents.map(i => (
              <Link key={i.id} href="/admin/incidents" className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50">
                <div><p className="font-medium">{i.payload.title}</p><p className="text-xs text-muted-foreground">{i.payload.status}</p></div>
                <Status value={i.payload.severity} />
              </Link>
            )) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No open incidents.</p>}
          </div>
        </Section>
      </div>
    </>
  );
}

export async function Tenants({ actor }: { actor: Actor }) {
  const rows = await tenants(actor);
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · tenants" title="Workspace control"
        description={actor.platformAdmin ? "All tenants on this server." : "Your tenant. Platform administrators see every tenant here."} />
      <div className="space-y-4">
        {rows.map(t => (
          <div key={t.id} className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-medium">{t.name}{t.id === actor.tenantId && <span className="ml-2 text-xs text-muted-foreground">(this tenant)</span>}</h2>
              <p className="text-sm text-muted-foreground">Owner: {t.owner} · {t.members} active member{t.members === 1 ? "" : "s"} · since {when(t.createdAt)}</p>
            </div>
            <Status value={t.status} />
          </div>
        ))}
      </div>
    </>
  );
}

const USER_VIEWS = [
  { id: "all", name: "All users" },
  { id: "active", name: "Active" },
  { id: "suspended", name: "Suspended" },
  { id: "admins", name: "Admins" },
  { id: "online", name: "Signed in now" },
] as const;

export async function Users({ actor, query = {} }: { actor: Actor; query?: Record<string, string | string[] | undefined> }) {
  const [all, tags] = await Promise.all([members(actor), tagsByUser(actor)]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const view = USER_VIEWS.some(v => v.id === one(query.view)) ? one(query.view) : "all";
  const q = one(query.q).trim().toLowerCase().slice(0, 100);
  const filters: Record<string, (u: (typeof all)[number]) => boolean> = {
    all: () => true, active: u => u.status === "active", suspended: u => u.status === "suspended",
    admins: u => u.role === "owner" || u.role === "admin", online: u => u.sessions > 0,
  };
  const rows = all.filter(filters[view]).filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const href = (v: string) => `/admin/users?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · users" title="Users and clientele"
        description="Everyone with a membership in this tenant, with live sign-in sessions. Add or reset staff sign-ins in Operations → Team."
        actions={<Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href="/operations">Operations → Team</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="Total users" value={all.length} />
        <Metric label="Active" value={all.filter(filters.active).length} />
        <Metric label="Suspended" value={all.filter(filters.suspended).length} />
        <Metric label="Signed in now" value={all.filter(filters.online).length} note="live sessions" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {USER_VIEWS.map(v => (
          <Link key={v.id} href={href(v.id)} aria-current={view === v.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${view === v.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{v.name}</Link>
        ))}
        <form action="/admin/users" className="ml-auto flex gap-2">
          <input type="hidden" name="view" value={view} />
          <input name="q" defaultValue={q} placeholder="Search name or email" aria-label="Search users" maxLength={100}
            className="w-56 rounded-md border bg-background px-3 py-1.5 text-sm" />
          <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Search</button>
        </form>
      </div>
      <UsersConsole canWrite={can(actor, "users.write")} isOwner={can(actor, "roles.write")} current={{ view, q }}
        users={rows.map(u => ({ ...u, tags: tags.get(u.userId) ?? [], isSelf: u.userId === actor.userId }))} />
    </>
  );
}

export function Roles() {
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · roles" title="Permission matrix"
        description="The grants every /api/admin request is checked against (lib/admin/security.ts). Read-only here: changing them is a code change." />
      <div className="grid gap-4">
        {ROLE_ORDER.map(role => (
          <div key={role} className="rounded-xl border p-4">
            <h2 className="text-xl font-medium capitalize">{role}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {permissionsFor(role).map(p => <span key={p} className="rounded-full bg-muted px-2 py-1 font-mono text-xs">{p}</span>)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export async function Approvals({ actor }: { actor: Actor }) {
  const rows = await records(actor, "approvals");
  const reviewer = can(actor, "approvals.review");
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · approvals" title="Workflow queue"
        description="Requests to approve policy, registry and billing changes. A request can't be approved by the person who made it, and goes stale if the item changes." />
      {!reviewer && <p className="mb-4 rounded-lg border bg-muted/40 p-3 text-sm">Your role can request approvals; reviewers and owners decide them.</p>}
      <div className="space-y-4">
        {rows.length ? rows.map(item => (
          <div key={item.id} className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-lg font-medium">{item.payload.title ?? "Approval request"}</h2>
              <p className="text-sm text-muted-foreground">{item.payload.reason}</p>
              <p className="mt-1 text-xs text-muted-foreground">Requested {when(item.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Status value={item.decision ?? "pending"} />
              {reviewer && (item.decision ?? "pending") === "pending" && <Decide id={item.id} revision={item.revision} />}
            </div>
          </div>
        )) : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No approval requests. Use “Request approval” on a policy, registry or billing item.</p>}
      </div>
    </>
  );
}

function builtInPolicies() {
  const moderation = process.env.OPENAI_API_KEY && process.env.AZ_MODERATION !== "off";
  return [
    { name: "PII redaction", scope: "Every chat request", status: "enforced", how: "02 preprocess redacts emails, phones, cards, IDs before any provider call" },
    { name: "Content moderation", scope: "Input and answer", status: moderation ? "enforced" : "partial", how: moderation ? "Local filter + OpenAI moderation" : "Local phrase filter only (no OPENAI_API_KEY or AZ_MODERATION=off)" },
    { name: "Plan access rules", scope: "Web chat", status: process.env.DATABASE_URL ? "enforced" : "disabled", how: "Features and monthly limits from plan_entitlements" },
    { name: "Extension permissions", scope: "Tenant-scoped", status: "enforced", how: "Hooks only get permissions their manifest declares" },
    { name: "Local single-user rule", scope: "This machine", status: process.env.LOCAL_SINGLE_USER === "false" ? "disabled" : "enforced", how: "Loopback requests count as the signed-in local user" },
    { name: "Billing webhook", scope: "Payments", status: (process.env.BILLING_WEBHOOK_SECRET?.length ?? 0) >= 32 ? "enforced" : "disabled", how: "HMAC-signed, 5-minute replay window" },
  ];
}

export async function Policies({ actor }: { actor: Actor }) {
  const rows = await records(actor, "policies");
  const write = can(actor, "policies.write");
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · policies" title="Policy center"
        description="Built-in policies are enforced in code. Tenant policies are your organisation's documented rules; changes can go through an approval."
        actions={write && <CreateRecord module="policies" title="New policy" fields={[
          { name: "name", label: "Name", kind: "text", required: true },
          { name: "target", label: "Applies to", kind: "select", options: ["tenant", "registry", "extensions", "billing"] },
          { name: "description", label: "Description", kind: "textarea" },
          { name: "rules", label: "Rules (one per line)", kind: "lines" },
          { name: "enabled", label: "Enabled", kind: "checkbox" },
        ]} />} />
      <Section title="Built-in" note="read-only · from server configuration">
        <Table head={["Policy", "Scope", "Status", "How"]} rows={builtInPolicies().map(p => [<span key="n" className="font-medium">{p.name}</span>, p.scope, <Status key="s" value={p.status} />, <span key="h" className="text-muted-foreground">{p.how}</span>])} />
      </Section>
      <Section title="Tenant policies">
        <div className="space-y-4">
          {rows.length ? rows.map(r => {
            const p = r.payload as PayloadMap["policies"];
            return (
              <div key={r.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-medium">{p.name}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {write ? <UpdateField module="policies" id={r.id} revision={r.revision} payload={P(p)} field="enabled" options={[true, false]} label={`${p.name} status`} />
                      : <Status value={p.enabled ? "enabled" : "disabled"} />}
                    {can(actor, "approvals.write") && <RequestApproval id={r.id} revision={r.revision} requestedBy={actor.userId} title={p.name} />}
                    {write && <Remove module="policies" id={r.id} revision={r.revision} />}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Applies to: {p.target}{p.description ? ` · ${p.description}` : ""}</p>
                {!!p.rules.length && <ul className="mt-2 list-disc pl-5 text-sm">{p.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>}
              </div>
            );
          }) : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No tenant policies yet.</p>}
        </div>
      </Section>
    </>
  );
}

export async function Registry({ actor }: { actor: Actor }) {
  const rows = await records(actor, "registry");
  const live = liveProviders();
  const write = can(actor, "registry.write");
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · registry" title="Model and version review"
        description="Live providers are what chat routes to right now. The review list records models, tools, prompts and datasets your team has assessed."
        actions={write && <CreateRecord module="registry" title="Add for review" fields={[
          { name: "name", label: "Name", kind: "text", required: true, placeholder: "llama-3.3-70b" },
          { name: "version", label: "Version", kind: "text", required: true },
          { name: "kind", label: "Kind", kind: "select", options: ["model", "tool", "prompt", "dataset"] },
          { name: "sourceUrl", label: "Source URL (https)", kind: "text" },
          { name: "enabled", label: "Approved for use", kind: "checkbox" },
        ]} />} />
      <Section title="Live providers" note="05 model layer · 04 routing">
        <Table head={["Provider", "Model", "Routing"]} empty="No provider keys configured."
          rows={[
            ...live.configured.map(p => [<span key="l" className="font-medium">{p.label}</span>, <code key="m" className="text-xs">{p.model}</code>, <Status key="s" value={p.coolingDown ? "cooling down" : "active"} />]),
            ...live.disabled.map(id => [<span key="l" className="font-medium">{id}</span>, "—", <Status key="s" value="disabled" />]),
          ]} />
        {!!live.disabled.length && <p className="mt-2 text-xs text-muted-foreground">Disabled by AZ_DISABLED_PROVIDERS in .env.local.</p>}
      </Section>
      <Section title="Review list">
        <Table head={["Name", "Version", "Kind", "Approval", ""]} empty="Nothing under review."
          rows={rows.map(r => {
            const p = r.payload as PayloadMap["registry"];
            return [
              <span key="n" className="font-medium">{p.sourceUrl ? <a className="underline" href={p.sourceUrl} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}</span>,
              p.version, p.kind,
              write ? <UpdateField key="e" module="registry" id={r.id} revision={r.revision} payload={P(p)} field="enabled" options={[true, false]} label={`${p.name} approval`} />
                : <Status key="e" value={p.enabled ? "approved" : "pending"} />,
              <span key="a" className="flex gap-1">{can(actor, "approvals.write") && <RequestApproval id={r.id} revision={r.revision} requestedBy={actor.userId} title={`${p.name} ${p.version}`} />}{write && <Remove module="registry" id={r.id} revision={r.revision} />}</span>,
            ];
          })} />
      </Section>
    </>
  );
}

export async function Billing({ actor }: { actor: Actor }) {
  const [rows, use] = await Promise.all([records(actor, "billing"), usage()]);
  const write = can(actor, "billing.write");
  const totalCalls = use.calls.reduce((n, c) => n + c.calls, 0);
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · billing" title="Usage and limits"
        description="Plan subscriptions and provider usage are measured. Budgets are amounts your team sets and tracks; no payment provider is connected."
        actions={write && <CreateRecord module="billing" title="New budget" fields={[
          { name: "label", label: "Label", kind: "text", required: true, placeholder: "AI providers – monthly" },
          { name: "currency", label: "Currency", kind: "text", required: true, placeholder: "USD" },
          { name: "budget", label: "Budget", kind: "number", required: true },
          { name: "spend", label: "Spend so far", kind: "number" },
        ]} />} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Paid subscriptions" value={use.plans.reduce((n, p) => n + (p.name === "Free" ? 0 : p.active), 0)} />
        <Metric label="Awaiting payment" value={use.plans.reduce((n, p) => n + p.pending, 0)} note="activate in Operations → Payments" />
        <Metric label="Provider calls (30d)" value={totalCalls} />
        <Metric label="Output tokens (30d)" value={use.calls.reduce((n, c) => n + (c.output_tokens ?? 0), 0).toLocaleString()} note="estimated from answer length" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Subscriptions by plan">
          <Table head={["Plan", "Active", "Pending"]} rows={use.plans.map(p => [p.name, p.active, p.pending])} />
        </Section>
        <Section title="Provider usage" note="last 30 days">
          <Table head={["Provider", "Calls", "Input tokens", "Output tokens"]} empty="No provider calls yet."
            rows={use.calls.map(c => [c.provider, c.calls, (c.input_tokens ?? 0).toLocaleString(), (c.output_tokens ?? 0).toLocaleString()])} />
        </Section>
      </div>
      <Section title="Budgets">
        <Table head={["Budget", "Spend", "Used", "Status", ""]} empty="No budgets yet."
          rows={rows.map(r => {
            const p = r.payload as PayloadMap["billing"];
            const pct = p.budget ? Math.round((100 * p.spend) / p.budget) : 0;
            const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: p.currency });
            return [
              <span key="l" className="font-medium">{p.label}<span className="block text-xs text-muted-foreground">{money(p.budget)}</span></span>,
              money(p.spend), `${pct}%`,
              write ? <UpdateField key="s" module="billing" id={r.id} revision={r.revision} payload={P(p)} field="status" options={["active", "warning", "paused"]} label={`${p.label} status`} /> : <Status key="s" value={p.status} />,
              <span key="a" className="flex gap-1">{can(actor, "approvals.write") && <RequestApproval id={r.id} revision={r.revision} requestedBy={actor.userId} title={p.label} />}{write && <Remove module="billing" id={r.id} revision={r.revision} />}</span>,
            ];
          })} />
      </Section>
    </>
  );
}

export async function Incidents({ actor }: { actor: Actor }) {
  const [rows, people] = await Promise.all([records(actor, "incidents"), members(actor)]);
  const write = can(actor, "incidents.write");
  const name = (id: string) => people.find(p => p.userId === id)?.name ?? "former member";
  return (
    <>
      <PageHeader eyebrow="15_ADMIN · incidents" title="Operational response"
        description="Track outages, policy spikes and other operational problems. Every change is audited."
        actions={write && <CreateRecord module="incidents" title="Report incident" fixed={{ ownerUserId: actor.userId }} fields={[
          { name: "title", label: "Title", kind: "text", required: true },
          { name: "severity", label: "Severity", kind: "select", options: ["medium", "low", "high", "critical"] },
          { name: "summary", label: "Summary", kind: "textarea" },
        ]} />} />
      <div className="space-y-4">
        {rows.length ? rows.map(r => {
          const p = r.payload as PayloadMap["incidents"];
          return (
            <div key={r.id} className="flex flex-col justify-between gap-3 rounded-xl border p-4 md:flex-row md:items-center">
              <div>
                <p className="font-medium">{p.title} <Status value={p.severity} /></p>
                {p.summary && <p className="text-sm text-muted-foreground">{p.summary}</p>}
                <p className="mt-1 text-xs text-muted-foreground">Owner: {name(p.ownerUserId)} · updated {when(r.updatedAt)}</p>
              </div>
              {write ? <UpdateField module="incidents" id={r.id} revision={r.revision} payload={P(p)} field="status" options={["open", "investigating", "blocked", "resolved"]} label={`${p.title} status`} />
                : <Status value={p.status} />}
            </div>
          );
        }) : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No incidents reported.</p>}
      </div>
    </>
  );
}
