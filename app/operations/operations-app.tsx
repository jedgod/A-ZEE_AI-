"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, BadgeCheck, Check, ClipboardList, CreditCard, MessageSquareWarning, Settings2, ThumbsDown, Download, Inbox, KeyRound, LayoutGrid, LogOut, Menu, MoreHorizontal,
  Plus, Search, ShieldCheck, Undo2, UserPlus, Users, X,
} from "lucide-react";
import { AwaitingPayment } from "@/components/awaiting-payment";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types mirroring the /api/operations responses

type Role = "admin" | "staff" | "viewer";
type Status = "open" | "in_progress" | "pending_review" | "resolved";
type Priority = "low" | "medium" | "high";
type Me = { id: string; name: string; email: string; role: Role };
type Complaint = {
  id: string; display: string; subject: string; customerName: string; customerContact: string | null; category: string; source: string;
  priority: Priority; status: Status; assignedTo: string | null; assigneeName: string | null; resolution: string | null;
  reviewNote: string | null; version: number; createdAt: string; updatedAt: string;
};
type Detail = Complaint & { body: string; events: { actor: string; action: string; detail: Record<string, unknown>; at: string }[] };
type StaffMember = { id: string; email: string; name: string; role: string; status: string; active: number; mustChangePassword: boolean };
type ActivityItem = { actor: string; action: string; detail: Record<string, unknown>; complaint: string | null; at: string };
type Dashboard = { counts: { total: number; unassigned: number; pending: number; resolved: number }; team: StaffMember[]; activity: ActivityItem[] };
type View = "overview" | "complaints" | "approvals" | "team" | "activity" | "feedback" | "payments";
type FeedbackItem = { requestId: string; rating: number | null; correction: string | null; mode: string | null; provider: string | null; at: string; queued: boolean };

const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", pending_review: "In review", resolved: "Resolved" };
const STATUS_STYLE: Record<Status, string> = {
  open: "bg-[#edf2ff] text-[#4a6bc8]", in_progress: "bg-[#fff4dd] text-[#a67b23]",
  pending_review: "bg-[#f0eafd] text-[#8561bd]", resolved: "bg-[#e8f5ed] text-[#3c8a67]",
};
const PRIORITY_STYLE: Record<Priority, string> = { high: "text-[#d27465]", medium: "text-[#b68b39]", low: "text-[#719486]" };
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Administrator", operator: "Staff", reviewer: "Staff (reviewer)", viewer: "Viewer" };
const ERROR_TEXT: Record<string, string> = {
  VERSION_CONFLICT: "Someone else changed this complaint. It has been reloaded.",
  ACTION_NOT_ALLOWED: "You can't do that at this stage.",
  RESOLUTION_REQUIRED: "Add a resolution note first.",
  NOTE_REQUIRED: "Add a note telling staff what to change.",
  ASSIGNEE_NOT_ACTIVE_STAFF: "Pick an active staff member.",
  ALREADY_A_MEMBER: "That person is already on this team.",
  CANNOT_CHANGE_OWN_ACCESS: "Ask another administrator to change your own access.",
  SIGN_IN_REQUIRED: "Your session ended. Sign in again.",
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const when = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; message?: string; status: number }> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    const json = await response.json().catch(() => ({}));
    if (response.status === 401) window.location.assign("/login?next=/operations");
    return response.ok ? { ok: true, data: json.data } : { ok: false, error: json.error ?? "ERROR", message: json.message, status: response.status };
  } catch {
    return { ok: false, error: "OFFLINE", message: "You appear to be offline.", status: 0 };
  }
}

const errorText = (r: { error: string; message?: string }) => r.message ?? ERROR_TEXT[r.error] ?? "Something went wrong. Try again.";

// ---------------------------------------------------------------------------

export function OperationsApp({ me, team }: { me: Me; team: string }) {
  const [view, setView] = useState<View>("overview");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"" | Priority>("");
  const [assignee, setAssignee] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const admin = me.role === "admin";
  const canCreate = me.role !== "viewer";

  const notify = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(t => (t === text ? "" : t)), 3500);
  }, []);

  const load = useCallback(async () => {
    const [list, overview] = await Promise.all([api<Complaint[]>("/api/operations/complaints"), api<Dashboard>("/api/operations/dashboard")]);
    if (list.ok) setComplaints(list.data);
    if (overview.ok) setDash(overview.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pending = complaints.filter(c => c.status === "pending_review");
  const activeStaff = (dash?.team ?? []).filter(s => s.status === "active" && s.role !== "viewer");
  const staffName = useCallback((id: unknown) => dash?.team.find(s => s.id === id)?.name ?? "a team member", [dash]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return complaints.filter(c =>
      (status === "all" || c.status === status) &&
      (!priority || c.priority === priority) &&
      (!assignee || (assignee === "unassigned" ? !c.assignedTo : c.assignedTo === assignee)) &&
      (!q || [c.subject, c.customerName, c.display].some(v => v.toLowerCase().includes(q))));
  }, [complaints, status, priority, assignee, query]);

  function go(next: View) {
    setView(next);
    setStatus(next === "approvals" ? "pending_review" : "all");
    setNavOpen(false);
  }

  async function signOut() {
    await fetch("/api/staff/session", { method: "DELETE" }).catch(() => {});
    window.location.assign("/login");
  }

  const counts = dash?.counts ?? { total: 0, unassigned: 0, pending: 0, resolved: 0 };
  const titles: Record<View, [string, string]> = {
    overview: ["Operations overview", admin ? "Your team, your queue, and what needs your attention." : "Your assigned complaints and what to do next."],
    complaints: ["Complaints", admin ? "Every complaint for this team." : "Complaints assigned to you."],
    approvals: ["Approvals", "Resolutions waiting for an administrator's review."],
    team: ["Staff & assignments", admin ? "Add staff, set roles, and see workload." : "Who's on the team."],
    activity: ["Activity log", "Every change, newest first. Complaint text is never logged."],
    payments: ["Awaiting payment", "Paid plans chosen by users. Activate one once its payment has been received."],
    feedback: ["Answer feedback", "Unhelpful answers and corrections from users. Queue them for review to improve prompts and routing."],
  };

  const nav: { view: View; label: string; icon: React.ReactNode; count?: number; show: boolean }[] = [
    { view: "overview", label: "Overview", icon: <LayoutGrid className="h-4 w-4" />, show: true },
    { view: "complaints", label: "Complaints", icon: <Inbox className="h-4 w-4" />, count: complaints.length, show: true },
    { view: "approvals", label: "Approvals", icon: <BadgeCheck className="h-4 w-4" />, count: pending.length, show: admin },
    { view: "team", label: "Staff & assignments", icon: <Users className="h-4 w-4" />, show: true },
    { view: "activity", label: "Activity log", icon: <Activity className="h-4 w-4" />, show: admin },
    { view: "feedback", label: "Answer feedback", icon: <MessageSquareWarning className="h-4 w-4" />, show: admin },
    { view: "payments", label: "Awaiting payment", icon: <CreditCard className="h-4 w-4" />, show: admin },
  ];

  return (
    <div className="min-h-dvh bg-[#f6f7f9] text-[#1d2637] md:grid md:grid-cols-[236px_minmax(0,1fr)]" style={{ fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', sans-serif" }}>
      {/* Sidebar */}
      <aside className={cn(
        "flex-col bg-[#172033] px-4 py-6 text-[#a5afc2] md:sticky md:top-0 md:flex md:h-dvh",
        navOpen ? "fixed inset-y-0 left-0 z-50 flex w-[236px] shadow-2xl" : "hidden",
      )}>
        <a href="/" className="mb-8 flex items-center gap-2.5 px-3 text-xl font-extrabold tracking-tight text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#6885ff] text-base">a</span> AZ_AI <span className="text-xs font-medium text-[#70819f]">ops</span>
        </a>
        <div className="mb-6 flex items-center gap-2.5 rounded-md border border-[#354058] p-2.5 text-xs">
          <span className="rounded bg-[#334158] px-1.5 py-1 font-semibold text-[#d9e3ff]">{initials(team)}</span>
          <div className="min-w-0"><b className="block truncate text-[#e4e9f3]">{team}</b><small className="text-[10px]">{admin ? "Administrator workspace" : "Staff workspace"}</small></div>
        </div>
        <nav aria-label="Operations navigation" className="grid gap-0.5">
          <div className="mb-2 px-3 text-[9px] font-bold tracking-[1.8px] text-[#718096]">WORKSPACE</div>
          {nav.filter(n => n.show).map(n => (
            <button key={n.view} onClick={() => go(n.view)} aria-current={view === n.view ? "page" : undefined}
              className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs transition-colors hover:bg-[#25314a] hover:text-white", view === n.view && "bg-[#315fe9] text-white hover:bg-[#315fe9]")}>
              {n.icon}{n.label}
              {n.count !== undefined && <span className="ml-auto rounded bg-white/10 px-1.5 text-[10px]">{n.count}</span>}
            </button>
          ))}
          <div className="mb-2 mt-5 px-3 text-[9px] font-bold tracking-[1.8px] text-[#718096]">LINKS</div>
          <a href="/" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-xs hover:bg-[#25314a] hover:text-white"><ClipboardList className="h-4 w-4" />Back to AZ_AI</a>
          {admin && <a href="/insights" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-xs hover:bg-[#25314a] hover:text-white"><Activity className="h-4 w-4" />Pipeline insights</a>}
          {admin && <a href="/admin" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-xs hover:bg-[#25314a] hover:text-white"><Settings2 className="h-4 w-4" />Admin console</a>}
        </nav>
        <div className="mt-auto">
          <div className="mt-8 rounded-md border border-[#354158] bg-[#222d42] p-4 text-[11px]">
            <b className="mb-1 block text-white">How work flows</b>
            Intake → {admin ? "you assign" : "admin assigns"} → staff resolve → admin approves → customer sees the resolution.
          </div>
          <div className="mt-6 flex items-center gap-2.5 border-t border-[#344057] pt-5 text-[11px]">
            <Avatar className="h-8 w-8"><AvatarFallback className="bg-[#d9c9b7] text-[10px] font-bold text-[#765b3f]">{initials(me.name)}</AvatarFallback></Avatar>
            <div className="min-w-0"><b className="block truncate text-white">{me.name}</b>{ROLE_LABEL[me.role === "staff" ? "operator" : me.role] ?? me.role}</div>
            <button onClick={signOut} aria-label="Sign out" title="Sign out" className="ml-auto rounded p-1.5 hover:bg-[#25314a] hover:text-white"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="min-w-0">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between gap-3 border-b border-[#e7eaf0] bg-white px-4 md:h-[77px] md:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded p-1.5 md:hidden" onClick={() => setNavOpen(o => !o)} aria-label="Toggle navigation" aria-expanded={navOpen}><Menu className="h-5 w-5" /></button>
            <div className="text-xs text-[#788292]">Workspace <span className="mx-3 text-[#c0c6d0]">/</span><strong className="font-medium text-[#1d2637]">{titles[view][0]}</strong></div>
          </div>
          <div className="flex items-center gap-4">
            <label className="hidden items-center gap-2 text-xs text-[#788292] lg:flex">
              <Search className="h-4 w-4" />
              <input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); if (view === "team" || view === "activity") go("complaints"); }}
                placeholder="Search complaints…" aria-label="Search complaints" className="w-44 bg-transparent outline-none" />
              <kbd className="rounded border border-[#e7eaf0] px-1.5 text-[10px]">Ctrl K</kbd>
            </label>
            {admin && (
              <button onClick={() => go("approvals")} className="relative rounded p-1.5 text-[#6c7688] hover:bg-[#f1f4f9]" aria-label={`${pending.length} resolutions awaiting approval`}>
                <ShieldCheck className="h-5 w-5" />
                {pending.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#315fe9] px-1 text-[9px] text-white">{pending.length}</span>}
              </button>
            )}
            <Avatar className="h-8 w-8"><AvatarFallback className="bg-[#e4eafc] text-[10px] font-bold text-[#4a62a6]">{initials(me.name)}</AvatarFallback></Avatar>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight md:text-[28px]">{titles[view][0]}</h1>
              <p className="text-xs text-[#788292]">{titles[view][1]}</p>
            </div>
            <div className="flex gap-2">
              {admin && <Button variant="outline" size="sm" asChild><a href="/api/operations/export"><Download />Export CSV</a></Button>}
              {canCreate && <Button size="sm" onClick={() => setCreating(true)} className="bg-[#315fe9] text-white hover:bg-[#244dcc]"><Plus />New complaint</Button>}
            </div>
          </div>

          {(view === "overview" || view === "complaints" || view === "approvals") && (
            <>
              {view === "overview" && (
                <section aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                  <Metric label={admin ? "Total complaints" : "Assigned to you"} value={counts.total} note="All sources" />
                  <Metric label="Awaiting assignment" value={admin ? counts.unassigned : 0} note={admin ? "Assign to staff" : "Admins assign work"} warn={admin && counts.unassigned > 0} />
                  <Metric label="Pending approval" value={counts.pending} note={admin ? "Your review required" : "Waiting on an admin"} warn={counts.pending > 0} />
                  <Metric label="Resolved" value={counts.resolved} note={`${counts.total ? Math.round((counts.resolved / counts.total) * 100) : 0}% resolution rate`} good />
                </section>
              )}
              <div className={cn("grid gap-5", view === "overview" && admin && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
                <div className="min-w-0">
                  <Queue
                    complaints={shown} total={complaints.length} loading={loading} status={status} setStatus={setStatus}
                    query={query} setQuery={setQuery} priority={priority} setPriority={setPriority}
                    assignee={assignee} setAssignee={setAssignee} staff={activeStaff} admin={admin} onOpen={setOpenId}
                    counts={{ all: complaints.length, open: complaints.filter(c => c.status === "open").length, in_progress: complaints.filter(c => c.status === "in_progress").length, pending_review: pending.length, resolved: complaints.filter(c => c.status === "resolved").length }}
                  />
                  {view === "overview" && <TeamCard team={dash?.team ?? []} className="mt-5" />}
                </div>
                {view === "overview" && admin && (
                  <div className="grid content-start gap-5">
                    <ApprovalsCard pending={pending} onOpen={setOpenId} me={me} onDone={() => { load(); notify("Resolution approved. The customer can now see it."); }} onError={notify} />
                    <ActivityCard items={(dash?.activity ?? []).slice(0, 6)} staffName={staffName} />
                  </div>
                )}
              </div>
            </>
          )}

          {view === "team" && <StaffManager team={dash?.team ?? []} admin={admin} me={me} onChanged={load} notify={notify} />}
          {view === "activity" && <ActivityCard items={dash?.activity ?? []} staffName={staffName} full />}
          {view === "feedback" && <FeedbackView notify={notify} onChanged={load} />}
          {/* Authorized by the staff session cookie; the component's bearer token is not used. */}
          {view === "payments" && <AwaitingPayment token="" />}

          <footer className="mt-6 flex flex-wrap justify-between gap-2 text-[10px] text-[#919aaa]">
            <span>AZ_AI operations · {team}</span>
            <span>Signed in as {me.email} · refreshes every 30 seconds</span>
          </footer>
        </main>
      </div>

      {openId && (
        <ComplaintDialog id={openId} me={me} staff={activeStaff} onClose={() => setOpenId(null)}
          onChanged={(message) => { load(); if (message) notify(message); }} />
      )}
      {creating && <NewComplaintDialog admin={admin} staff={activeStaff} onClose={() => setCreating(false)} onCreated={(c) => { load(); notify(`${c.display} created.`); }} />}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-md bg-[#172033] px-5 py-3 text-xs text-white shadow-lg">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Metric({ label, value, note, warn, good }: { label: string; value: number; note: string; warn?: boolean; good?: boolean }) {
  return (
    <Card className="rounded-lg border-[#e7eaf0] shadow-none">
      <CardContent className="p-4 md:p-5">
        <div className="text-[11px] text-[#747e90]">{label}</div>
        <div className="mt-2 text-[28px] font-extrabold tracking-tight md:text-[31px]">{value}</div>
        <div className={cn("mt-1 text-[10px] text-[#788292]", warn && "text-[#c1882c]", good && "text-[#24836c]")}>{note}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

function Queue(props: {
  complaints: Complaint[]; total: number; loading: boolean; status: "all" | Status; setStatus: (s: "all" | Status) => void;
  query: string; setQuery: (q: string) => void; priority: "" | Priority; setPriority: (p: "" | Priority) => void;
  assignee: string; setAssignee: (a: string) => void; staff: StaffMember[]; admin: boolean; onOpen: (id: string) => void;
  counts: Record<"all" | Status, number>;
}) {
  const { complaints } = props;
  return (
    <Card className="overflow-hidden rounded-lg border-[#e7eaf0] shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-[15px]">Complaint queue</CardTitle><CardDescription>{props.admin ? "Assign, follow, and approve resolutions." : "Work on what's assigned to you."}</CardDescription></div>
        <span className="inline-flex items-center gap-1.5 rounded bg-[#e9f5ef] px-2 py-1 text-[10px] text-[#24836c]"><span className="h-1.5 w-1.5 rounded-full bg-current" />Live</span>
      </CardHeader>
      <Tabs value={props.status} onValueChange={v => props.setStatus(v as "all" | Status)}>
        <TabsList className="w-full justify-start px-5" aria-label="Complaint status">
          {(["all", "open", "in_progress", "pending_review", "resolved"] as const).map(s => (
            <TabsTrigger key={s} value={s}>{s === "all" ? "All" : STATUS_LABEL[s]}<span className="rounded bg-[#eff2f8] px-1.5 text-[9px] font-normal text-[#788292]">{props.counts[s]}</span></TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5">
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border border-[#e7eaf0] px-2.5 py-1.5 text-[#788292]">
          <Search className="h-3.5 w-3.5" />
          <input value={props.query} onChange={e => props.setQuery(e.target.value)} placeholder="Search by subject, customer, or ID…" aria-label="Filter complaints" className="w-full bg-transparent text-xs outline-none" />
        </label>
        <select value={props.priority} onChange={e => props.setPriority(e.target.value as "" | Priority)} aria-label="Filter by priority" className="rounded-md border border-[#e7eaf0] bg-white px-2 py-1.5 text-xs text-[#687385]">
          <option value="">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        {props.admin && (
          <select value={props.assignee} onChange={e => props.setAssignee(e.target.value)} aria-label="Filter by staff" className="rounded-md border border-[#e7eaf0] bg-white px-2 py-1.5 text-xs text-[#687385]">
            <option value="">All staff</option><option value="unassigned">Unassigned</option>
            {props.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left">
          <thead>
            <tr className="border-y border-[#e7eaf0] bg-[#fafbfc] text-[10px] font-medium text-[#8a94a4]">
              <th className="px-5 py-2.5 font-medium">ID</th><th className="px-3 font-medium">Complaint / customer</th><th className="px-3 font-medium">Status</th>
              <th className="px-3 font-medium">Priority</th><th className="px-3 font-medium">Assigned to</th><th className="px-3 font-medium">Updated</th><th />
            </tr>
          </thead>
          <tbody>
            {complaints.map(c => (
              <tr key={c.id} className="border-b border-[#e7eaf0] text-xs hover:bg-[#f9fbff]">
                <td className="px-5 py-3.5 font-mono text-[10px] text-[#8a94a4]">{c.display}</td>
                <td className="max-w-[320px] px-3">
                  <button onClick={() => props.onOpen(c.id)} className="block max-w-full truncate text-left text-[12px] font-semibold text-[#313d52] hover:text-[#315fe9]">{c.subject}</button>
                  <div className="mt-0.5 text-[10px] text-[#9098a7]">{c.customerName} · {c.category}{c.source !== "staff" ? ` · via ${c.source}` : ""}</div>
                </td>
                <td className="px-3"><StatusBadge status={c.status} /></td>
                <td className={cn("px-3 text-[11px] capitalize", PRIORITY_STYLE[c.priority])}>● {c.priority}</td>
                <td className="px-3 text-[11px] text-[#748094]">
                  {c.assigneeName ? <span className="flex items-center gap-1.5"><Avatar className="h-6 w-6"><AvatarFallback className="bg-[#e4eafc] text-[8px] font-bold text-[#4a62a6]">{initials(c.assigneeName)}</AvatarFallback></Avatar>{c.assigneeName}</span> : "Unassigned"}
                </td>
                <td className="px-3 text-[10px] text-[#8a94a4]">{when(c.updatedAt)}</td>
                <td className="px-3"><button onClick={() => props.onOpen(c.id)} aria-label={`Manage ${c.display}`} className="rounded p-1 text-[#8993a3] hover:bg-[#eef1f6]"><MoreHorizontal className="h-4 w-4" /></button></td>
              </tr>
            ))}
            {!complaints.length && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-[#788292]">{props.loading ? "Loading…" : props.total ? "No complaints match your filters." : "No complaints yet. They'll appear here when users report issues."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 text-[10px] text-[#8993a3]">Showing {complaints.length} of {props.total}</div>
    </Card>
  );
}

function ApprovalsCard({ pending, onOpen, me, onDone, onError }: { pending: Complaint[]; onOpen: (id: string) => void; me: Me; onDone: () => void; onError: (m: string) => void }) {
  async function approve(c: Complaint) {
    const result = await api<Complaint>(`/api/operations/complaints/${c.id}`, { method: "POST", body: JSON.stringify({ action: "approve", version: c.version }) });
    if (result.ok) onDone(); else onError(errorText(result));
  }
  return (
    <Card className="rounded-lg border-[#e7eaf0] shadow-none">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[15px]">Awaiting your approval <Badge variant="secondary">{pending.length}</Badge></CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {pending.slice(0, 4).map(c => (
          <div key={c.id} className="border-t border-[#e7eaf0] pt-3 first:border-0 first:pt-0">
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7"><AvatarFallback className="bg-[#e4eafc] text-[9px] font-bold text-[#4a62a6]">{initials(c.assigneeName ?? "?")}</AvatarFallback></Avatar>
              <div className="min-w-0"><b className="block truncate text-xs">{c.assigneeName}</b><p className="text-[10px] text-[#788292]">{c.display} · {c.subject}</p></div>
            </div>
            <p className="my-2 line-clamp-3 text-[11px] text-[#6e7a8c]">{c.resolution}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 border-[#e3eaff] bg-[#eef3ff] text-[#315fe9]" disabled={c.assignedTo === me.id} title={c.assignedTo === me.id ? "Another admin must approve your own work" : undefined} onClick={() => approve(c)}><Check />Approve</Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onOpen(c.id)}>Review</Button>
            </div>
          </div>
        ))}
        {!pending.length && <p className="py-4 text-center text-xs text-[#788292]">You're all caught up.</p>}
      </CardContent>
    </Card>
  );
}

function describe(item: { actor: string; action: string; detail: Record<string, unknown>; complaint?: string | null }, staffName: (id: unknown) => string) {
  const c = item.complaint ? ` ${item.complaint}` : "";
  switch (item.action) {
    case "created": return `${item.actor} opened${c}${item.detail.source && item.detail.source !== "staff" ? ` (via ${item.detail.source})` : ""}.`;
    case "assign": return `${item.actor} assigned${c} to ${staffName(item.detail.assignedTo)}.`;
    case "submit": return `${item.actor} submitted a resolution for${c}.`;
    case "approve": return `${item.actor} approved${c}; it is resolved.`;
    case "return": return `${item.actor} sent${c} back for changes.`;
    case "reprioritize": return `${item.actor} set${c} to ${item.detail.priority} priority.`;
    case "reopen": return `${item.actor} reopened${c}.`;
    case "staff_added": return `${item.actor} added ${staffName(item.detail.userId)} as ${ROLE_LABEL[String(item.detail.role)] ?? item.detail.role}.`;
    case "staff_updated": return `${item.actor} updated access for ${staffName(item.detail.userId)}.`;
    case "subscription_activated": return `${item.actor} activated a ${String(item.detail.planId)} subscription after payment.`;
    case "feedback_queued": return `${item.actor} queued answer feedback for review.`;
    case "audit:policy_change": return `${item.actor} ${item.detail.outcome === "denied" ? "was denied a" : "made an"} access change for ${staffName(item.detail.resourceId)}.`;
    default: return `${item.actor}: ${item.action}${c}.`;
  }
}

function ActivityCard({ items, staffName, full }: { items: ActivityItem[]; staffName: (id: unknown) => string; full?: boolean }) {
  return (
    <Card className="rounded-lg border-[#e7eaf0] shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-[15px]">{full ? "All activity" : "Recent activity"}</CardTitle><span className="text-[10px] text-[#788292]">Audit trail</span></CardHeader>
      <CardContent>
        <ol className="grid gap-4">
          {items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#eff3fc] text-[#6680c5]"><Activity className="h-3 w-3" /></span>
              <div><p className="text-[11px] text-[#5d687a]">{describe(item, staffName)}</p><small className="text-[10px] text-[#a0a8b4]">{when(item.at)}</small></div>
            </li>
          ))}
          {!items.length && <li className="py-4 text-center text-xs text-[#788292]">No activity yet.</li>}
        </ol>
      </CardContent>
    </Card>
  );
}

function TeamCard({ team, className }: { team: StaffMember[]; className?: string }) {
  const active = team.filter(s => s.status === "active");
  return (
    <Card className={cn("rounded-lg border-[#e7eaf0] shadow-none", className)}>
      <CardHeader><CardTitle className="text-[15px]">Your team</CardTitle><CardDescription>Open assignments per person.</CardDescription></CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {active.map(s => (
          <div key={s.id} className="flex items-center gap-3">
            <Avatar className="h-9 w-9"><AvatarFallback className="bg-[#e4eafc] text-[10px] font-bold text-[#4a62a6]">{initials(s.name)}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <b className="block truncate text-xs">{s.name}</b>
              <p className="text-[10px] text-[#788292]">{ROLE_LABEL[s.role] ?? s.role} · {s.active} open</p>
              <div className="mt-1.5 h-1 w-24 rounded bg-[#edf0f5]"><i className="block h-full rounded bg-[#8aa2f1]" style={{ width: `${Math.min(100, s.active * 20)}%` }} /></div>
            </div>
          </div>
        ))}
        {!active.length && <p className="text-xs text-[#788292]">No active staff yet.</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ComplaintDialog({ id, me, staff, onClose, onChanged }: { id: string; me: Me; staff: StaffMember[]; onClose: () => void; onChanged: (message?: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [resolution, setResolution] = useState("");
  const [note, setNote] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = me.role === "admin";

  const fetchDetail = useCallback(async () => {
    const result = await api<Detail>(`/api/operations/complaints/${id}`);
    if (result.ok) { setDetail(result.data); setResolution(result.data.resolution ?? ""); setAssignTo(result.data.assignedTo ?? ""); }
    else setError(errorText(result));
  }, [id]);
  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  async function act(action: string, extra: Record<string, unknown> = {}, message?: string) {
    if (!detail) return;
    setBusy(true); setError("");
    const result = await api<Complaint>(`/api/operations/complaints/${id}`, { method: "POST", body: JSON.stringify({ action, version: detail.version, ...extra }) });
    setBusy(false);
    if (!result.ok) { setError(errorText(result)); if (result.error === "VERSION_CONFLICT") fetchDetail(); return; }
    onChanged(message);
    await fetchDetail();
    if (action === "approve" || action === "submit") onClose();
  }

  const c = detail;
  const mine = c?.assignedTo === me.id;
  const canSubmit = c && c.status === "in_progress" && mine;
  const canAssign = c && admin && (c.status === "open" || c.status === "in_progress");

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{c ? `${c.display} · ${c.subject}` : "Loading…"}</DialogTitle>
          {c && <DialogDescription className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /><span className="capitalize">{c.priority} priority</span>· {c.category} · from {c.customerName}{c.customerContact ? ` <${c.customerContact}>` : ""}</DialogDescription>}
        </DialogHeader>
        {c && (
          <div className="grid gap-5">
            <section><h3 className="mb-1 text-xs font-semibold text-muted-foreground">Complaint</h3><p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{c.body}</p></section>

            {c.reviewNote && c.status === "in_progress" && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>Returned by an administrator:</b> {c.reviewNote}</p>
            )}

            {canAssign && (
              <section className="grid gap-2">
                <Label htmlFor="assign">Assign to</Label>
                <div className="flex gap-2">
                  <select id="assign" value={assignTo} onChange={e => setAssignTo(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="">Choose a staff member…</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.active} open)</option>)}
                  </select>
                  <Button disabled={busy || !assignTo || assignTo === c.assignedTo} onClick={() => act("assign", { assigneeId: assignTo }, `${c.display} assigned.`)}>{c.assignedTo ? "Reassign" : "Assign"}</Button>
                </div>
              </section>
            )}

            {admin && c.status !== "resolved" && (
              <section className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Priority</span>
                {(["low", "medium", "high"] as const).map(p => (
                  <Button key={p} size="sm" variant={c.priority === p ? "default" : "outline"} disabled={busy || c.priority === p} className="capitalize" onClick={() => act("reprioritize", { priority: p })}>{p}</Button>
                ))}
              </section>
            )}

            {(canSubmit || c.resolution) && (
              <section className="grid gap-2">
                <Label htmlFor="resolution">{canSubmit ? "Resolution (what you did and what the customer should know)" : "Resolution"}</Label>
                {canSubmit
                  ? <Textarea id="resolution" rows={4} maxLength={5000} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="The customer sees this once an administrator approves it." />
                  : <p id="resolution" className="whitespace-pre-wrap rounded-md border p-3 text-sm">{c.resolution}</p>}
                {canSubmit && <div className="flex justify-end"><Button disabled={busy || !resolution.trim()} onClick={() => act("submit", { resolution }, `${c.display} sent for approval.`)} className="bg-[#315fe9] text-white hover:bg-[#244dcc]">Submit for approval</Button></div>}
              </section>
            )}

            {admin && c.status === "pending_review" && (
              <section className="grid gap-2 rounded-md border p-3">
                <h3 className="text-sm font-semibold">Review</h3>
                {mine && <p className="text-xs text-muted-foreground">This is your own submission, so another administrator must approve it.</p>}
                <Textarea aria-label="Note for staff (required to send back)" rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Note for staff if sending back…" />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" disabled={busy || !note.trim()} onClick={() => act("return", { note }, `${c.display} sent back to staff.`)}><Undo2 />Send back</Button>
                  <Button disabled={busy || mine} onClick={() => act("approve", {}, `${c.display} approved and resolved.`)} className="bg-[#24836c] text-white hover:bg-[#1c6b58]"><Check />Approve resolution</Button>
                </div>
              </section>
            )}

            {admin && c.status === "resolved" && (
              <div className="flex justify-end"><Button variant="outline" disabled={busy} onClick={() => act("reopen", {}, `${c.display} reopened.`)}>Reopen</Button></div>
            )}

            {!admin && !mine && <p className="text-xs text-muted-foreground">Read-only: this complaint isn't assigned to you.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <section>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">History</h3>
              <ol className="grid gap-1.5 text-xs">
                {c.events.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{describe({ ...e, complaint: null }, sid => staff.find(s => s.id === sid)?.name ?? "a team member")}</span><span className="shrink-0 text-muted-foreground">{when(e.at)}</span></li>
                ))}
              </ol>
            </section>
          </div>
        )}
        {!c && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function NewComplaintDialog({ admin, staff, onClose, onCreated }: { admin: boolean; staff: StaffMember[]; onClose: () => void; onCreated: (c: Complaint) => void }) {
  const [form, setForm] = useState({ subject: "", customerName: "", customerContact: "", body: "", category: "support", priority: "medium", assigneeId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { assigneeId, ...rest } = form;
    const result = await api<Complaint>("/api/operations/complaints", { method: "POST", body: JSON.stringify({ ...rest, ...(admin && assigneeId ? { assigneeId } : {}) }) });
    setBusy(false);
    if (!result.ok) return setError(errorText(result));
    onCreated(result.data); onClose();
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New complaint</DialogTitle><DialogDescription>Log a complaint received by phone, email, or in person.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-3.5">
          <div className="grid gap-1.5"><Label htmlFor="nc-subject">Subject</Label><Input id="nc-subject" required maxLength={150} value={form.subject} onChange={set("subject")} /></div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="nc-name">Customer name</Label><Input id="nc-name" required maxLength={100} value={form.customerName} onChange={set("customerName")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-contact">Customer email (optional)</Label><Input id="nc-contact" type="email" maxLength={254} value={form.customerContact} onChange={set("customerContact")} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="nc-body">Details</Label><Textarea id="nc-body" required maxLength={5000} rows={4} value={form.body} onChange={set("body")} /></div>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="nc-category">Category</Label>
              <select id="nc-category" value={form.category} onChange={set("category")} className="h-9 rounded-md border border-input bg-background px-2 text-sm"><option value="support">Support</option><option value="bug">Bug</option><option value="feedback">Feedback</option><option value="other">Other</option></select></div>
            <div className="grid gap-1.5"><Label htmlFor="nc-priority">Priority</Label>
              <select id="nc-priority" value={form.priority} onChange={set("priority")} className="h-9 rounded-md border border-input bg-background px-2 text-sm"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div>
            {admin && <div className="grid gap-1.5"><Label htmlFor="nc-assignee">Assign to</Label>
              <select id="nc-assignee" value={form.assigneeId} onChange={set("assigneeId")} className="h-9 rounded-md border border-input bg-background px-2 text-sm"><option value="">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} className="bg-[#315fe9] text-white hover:bg-[#244dcc]">Create complaint</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StaffManager({ team, admin, me, onChanged, notify }: { team: StaffMember[]; admin: boolean; me: Me; onChanged: () => void; notify: (m: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "operator" });
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const result = await api<{ temporaryPassword: string | null }>("/api/operations/staff", { method: "POST", body: JSON.stringify(form) });
    if (!result.ok) return setError(errorText(result));
    setAdding(false); onChanged();
    if (result.data.temporaryPassword) setSecret({ email: form.email, password: result.data.temporaryPassword });
    else notify(`${form.name} added. They already have a password.`);
    setForm({ name: "", email: "", role: "operator" });
  }

  async function update(member: StaffMember, change: Record<string, unknown>, message: string) {
    const result = await api<{ temporaryPassword: string | null }>(`/api/operations/staff/${member.id}`, { method: "PATCH", body: JSON.stringify(change) });
    if (!result.ok) return notify(errorText(result));
    onChanged();
    if (result.data.temporaryPassword) setSecret({ email: member.email, password: result.data.temporaryPassword }); else notify(message);
  }

  return (
    <Card className="overflow-hidden rounded-lg border-[#e7eaf0] shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle className="text-[15px]">Team members</CardTitle><CardDescription>{admin ? "Staff resolve assigned complaints; administrators assign and approve." : "Contact an administrator to change access."}</CardDescription></div>
        {admin && <Button size="sm" onClick={() => setAdding(true)} className="bg-[#315fe9] text-white hover:bg-[#244dcc]"><UserPlus />Add staff</Button>}
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-xs">
          <thead><tr className="border-y border-[#e7eaf0] bg-[#fafbfc] text-[10px] text-[#8a94a4]"><th className="px-5 py-2.5 font-medium">Name</th><th className="px-3 font-medium">Role</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Open work</th>{admin && <th className="px-3 font-medium">Actions</th>}</tr></thead>
          <tbody>
            {team.map(m => (
              <tr key={m.id} className="border-b border-[#e7eaf0]">
                <td className="px-5 py-3"><div className="flex items-center gap-2.5"><Avatar className="h-8 w-8"><AvatarFallback className="bg-[#e4eafc] text-[10px] font-bold text-[#4a62a6]">{initials(m.name)}</AvatarFallback></Avatar><div><b>{m.name}{m.id === me.id && " (you)"}</b><p className="text-[10px] text-[#8a94a4]">{m.email}{m.mustChangePassword ? " · password not set yet" : ""}</p></div></div></td>
                <td className="px-3">
                  {admin && m.id !== me.id && m.role !== "owner" ? (
                    <select aria-label={`Role for ${m.name}`} value={m.role} onChange={e => update(m, { role: e.target.value }, `${m.name} is now ${ROLE_LABEL[e.target.value]}.`)} className="rounded-md border border-[#e7eaf0] bg-white px-2 py-1 text-xs">
                      {["admin", "operator", "reviewer", "viewer"].map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[m.role] ?? m.role}
                </td>
                <td className="px-3"><span className={cn("rounded px-2 py-0.5 text-[10px]", m.status === "active" ? "bg-[#e8f5ed] text-[#3c8a67]" : "bg-[#f3f4f6] text-[#6b7280]")}>{m.status === "active" ? "Active" : "Suspended"}</span></td>
                <td className="px-3">{m.active}</td>
                {admin && (
                  <td className="px-3">
                    {m.id !== me.id && m.role !== "owner" && (
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => update(m, { status: m.status === "active" ? "suspended" : "active" }, m.status === "active" ? `${m.name} suspended and signed out.` : `${m.name} reactivated.`)}>{m.status === "active" ? "Suspend" : "Reactivate"}</Button>
                        <Button size="sm" variant="outline" onClick={() => update(m, { resetPassword: true }, "")}><KeyRound />Reset password</Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add staff</DialogTitle><DialogDescription>They get a one-time password to sign in at /login and must choose their own.</DialogDescription></DialogHeader>
          <form onSubmit={add} className="grid gap-3.5">
            <div className="grid gap-1.5"><Label htmlFor="st-name">Name</Label><Input id="st-name" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="st-email">Email</Label><Input id="st-email" type="email" required maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="st-role">Role</Label>
              <select id="st-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="operator">Staff: resolves assigned complaints</option><option value="reviewer">Staff (reviewer)</option><option value="admin">Administrator: assigns and approves</option><option value="viewer">Viewer: read-only</option>
              </select></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" className="bg-[#315fe9] text-white hover:bg-[#244dcc]">Add</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!secret} onOpenChange={o => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>One-time password</DialogTitle><DialogDescription>Give this to {secret?.email} privately. It's shown only now; they'll set their own password at first sign-in.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-2">
            <code data-testid="temporary-password" className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm">{secret?.password}</code>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard?.writeText(secret?.password ?? ""); notify("Copied."); }}>Copy</Button>
          </div>
          <DialogFooter><Button onClick={() => setSecret(null)}><X />Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function FeedbackView({ notify, onChanged }: { notify: (m: string) => void; onChanged: () => void }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const load = useCallback(async () => {
    const result = await api<FeedbackItem[]>("/api/operations/feedback");
    if (result.ok) setItems(result.data); else notify(errorText(result));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  async function queue(item: FeedbackItem) {
    const result = await api("/api/operations/feedback", { method: "POST", body: JSON.stringify({ requestId: item.requestId }) });
    if (!result.ok) return notify(errorText(result));
    notify("Queued for review.");
    load(); onChanged();
  }

  return (
    <Card className="overflow-hidden rounded-lg border-[#e7eaf0] shadow-none">
      <CardHeader><CardTitle className="text-[15px]">Unhelpful answers · last 30 days</CardTitle><CardDescription>Personal data in corrections is masked before storage. Answer text itself is never stored.</CardDescription></CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-y border-[#e7eaf0] bg-[#fafbfc] text-[10px] text-[#8a94a4]"><th className="px-5 py-2.5 font-medium">When</th><th className="px-3 font-medium">Rating</th><th className="px-3 font-medium">Correction</th><th className="px-3 font-medium">Mode · provider</th><th className="px-3 font-medium" /></tr></thead>
          <tbody>
            {(items ?? []).map(item => (
              <tr key={item.requestId} className="border-b border-[#e7eaf0] align-top">
                <td className="whitespace-nowrap px-5 py-3 text-[10px] text-[#8a94a4]">{when(item.at)}</td>
                <td className="px-3 py-3">{item.rating !== null && item.rating <= 2 ? <span className="inline-flex items-center gap-1 text-[#d27465]"><ThumbsDown className="h-3.5 w-3.5" />Not helpful</span> : <span className="text-[#8a94a4]">—</span>}</td>
                <td className="max-w-[420px] px-3 py-3 text-[#313d52]">{item.correction ?? <span className="text-[#8a94a4]">No correction given</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 capitalize text-[#748094]">{item.mode ?? "—"} · {item.provider ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-3">{item.queued ? <Badge variant="secondary">Queued</Badge> : <Button size="sm" variant="outline" onClick={() => queue(item)}>Queue for review</Button>}</td>
              </tr>
            ))}
            {items && !items.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-[#788292]">No unhelpful answers in the last 30 days.</td></tr>}
            {!items && <tr><td colSpan={5} className="px-5 py-10 text-center text-[#788292]">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
