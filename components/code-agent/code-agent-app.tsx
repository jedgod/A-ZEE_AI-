"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, Check, FileCode2, GitBranch, History, Loader2, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// AI Code Agent: plan → proposed changes → diff review (approve, apply) → history (rollback, audit).
// Files only change after approving the exact patch hash shown here.

type Status = { enabled: boolean; readiness: string; configured: boolean; repos: string[]; execution: { enabled: boolean; readiness: string; blockedBy: string | null } };
type PlanFile = { path: string; action: "create" | "modify" | "delete"; reason: string };
type Warning = { severity: "block" | "high" | "medium"; code: string; path: string; message: string };
type Task = {
  id: string; repo: string; instruction: string; status: string; explanation: string | null; review: Warning[]; patchHash: string | null; patchVersion: number;
  approved: boolean; error: string | null; model: string | null; createdAt: string; appliedAt: string | null; rolledBackAt: string | null;
  plan: { summary: string; files: PlanFile[]; steps: string[]; tests: string[]; refused?: { path: string; reason: string }[] } | null;
  changes?: { path: string; action: string; additions: number; deletions: number }[];
};
type Diff = { patchHash: string | null; review: Warning[]; explanation: string | null; files: { path: string; action: string; additions: number; deletions: number; diff: string }[]; totals: { files: number; additions: number; deletions: number } };
type Git = { branch: string | null; upstream: string | null; ahead: number; behind: number; changes: { status: string; path: string }[] } | null;
type AuditRow = { action: string; outcome: string; patch_hash: string | null; detail: string | null; created_at: string };

const ERRORS: Record<string, string> = {
  WORKSPACE_NOT_CONFIGURED: "No workspace is configured. Set CODE_AGENT_WORKSPACE_ROOT and CODE_AGENT_REPOS on the server.",
  REPO_NOT_AUTHORIZED: "This repository isn't authorized for the agent.",
  CSRF_HEADER_REQUIRED: "Request refused (missing request header).",
  STALE_PATCH: "Files changed after this patch was generated. Generate it again and review the new patch.",
  PATCH_CHANGED: "The patch changed since you reviewed it. Review it again.",
  PATCH_BLOCKED: "This patch adds what looks like a secret and can't be approved.",
  RISK_ACKNOWLEDGEMENT_REQUIRED: "Confirm you've reviewed the high-risk warnings first.",
  ROLLBACK_CONFLICT: "Some files were edited after the agent applied its changes; rollback was refused and nothing changed.",
  APPROVAL_REQUIRED: "Approve the patch before applying it.",
  PLAN_EMPTY: "The plan had no files the agent may change.",
  EDIT_NOT_FOUND: "The model's edit didn't match the file. Generate again.",
  EDIT_AMBIGUOUS: "The model's edit matched more than one place. Generate again.",
  CHANGE_NOT_IN_PLAN: "The model tried to change a file outside the plan. Generate again.",
  CONTEXT_TOO_LARGE: "The planned files are too large to send to the model. Narrow the task.",
  AI_PROVIDER_NOT_CONFIGURED: "No AI provider is configured.",
  AI_PROVIDER_UNAVAILABLE: "The AI provider didn't respond. Try again.",
  AI_INVALID_OUTPUT: "The model returned an invalid plan or patch. Try again.",
  MANUAL_RECOVERY_REQUIRED: "A rollback didn't finish; restore the listed files manually before continuing.",
  INVALID_STATE: "That step isn't available for this task right now.",
};

class ApiError extends Error { constructor(readonly code: string, readonly detail?: unknown) { super(ERRORS[code] ?? code); } }

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const mutation = init?.method && init.method !== "GET";
  const r = await fetch(url, {
    cache: "no-store", ...init,
    headers: { ...(mutation ? { "X-AZee-Request": "1", "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.error ?? "REQUEST_FAILED", d.detail);
  return d.data as T;
}

const errorText = (e: unknown) => {
  if (!(e instanceof ApiError)) return (e as Error)?.message ?? "Request failed.";
  const files = (e.detail as { files?: string[] } | undefined)?.files;
  return files?.length ? `${e.message} (${files.join(", ")})` : e.message;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", planned: "Planned", review: "Awaiting review", approved: "Approved", applying: "Applying…", applied: "Applied",
  rolling_back: "Rolling back…", rolled_back: "Rolled back", stale: "Stale — regenerate", failed: "Failed",
};
const SEVERITY = { block: "border-red-300 bg-red-50 text-red-900", high: "border-amber-300 bg-amber-50 text-amber-900", medium: "border-sky-200 bg-sky-50 text-sky-900" };

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-[28rem] overflow-auto text-xs leading-5">
      {diff.split("\n").map((line, i) => (
        <div key={i} className={cn("whitespace-pre px-3",
          line.startsWith("+") && !line.startsWith("+++") && "bg-emerald-50 text-emerald-900",
          line.startsWith("-") && !line.startsWith("---") && "bg-red-50 text-red-900",
          line.startsWith("@@") && "bg-muted text-muted-foreground")}>{line || " "}</div>
      ))}
    </pre>
  );
}

export function CodeAgentApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [repo, setRepo] = useState("");
  const [git, setGit] = useState<Git>(null);
  const [tree, setTree] = useState<{ path: string; size: number }[]>([]);
  const [instruction, setInstruction] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [current, setCurrent] = useState<Task | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [ack, setAck] = useState(false);
  const [tab, setTab] = useState("planning");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const loadTasks = useCallback(async () => setTasks(await api<Task[]>("/api/code-agent/tasks")), []);
  const openTask = useCallback(async (id: string) => {
    const t = await api<Task>(`/api/code-agent/tasks/${id}`);
    setCurrent(t); setAck(false);
    setDiff(t.patchHash ? await api<Diff>(`/api/code-agent/tasks/${id}/diff`) : null);
    setAuditRows(await api<AuditRow[]>(`/api/code-agent/tasks/${id}/audit`));
  }, []);

  useEffect(() => {
    run("load", async () => {
      const s = await api<Status>("/api/code-agent");
      setStatus(s);
      if (s.repos[0]) setRepo(s.repos[0]);
      if (s.configured) await loadTasks();
    });
  }, [loadTasks]);
  useEffect(() => {
    if (!repo) return;
    setGit(null); setTree([]);
    api<Git>(`/api/code-agent/repos/${repo}/git`).then(setGit).catch(() => {});
    api<{ files: { path: string; size: number }[] }>(`/api/code-agent/repos/${repo}/tree`).then(t => setTree(t.files)).catch(e => setError(errorText(e)));
  }, [repo]);

  const refresh = async (id: string) => { await openTask(id); await loadTasks(); };
  const start = () => run("plan", async () => {
    const t = await api<Task>("/api/code-agent/tasks", { method: "POST", json: { repo, instruction } });
    setCurrent(t);
    try { await api(`/api/code-agent/tasks/${t.id}/plan`, { method: "POST" }); } finally { await refresh(t.id); }
  });
  const replan = (t: Task) => run("plan", async () => { try { await api(`/api/code-agent/tasks/${t.id}/plan`, { method: "POST" }); } finally { await refresh(t.id); } });
  const generate = (t: Task) => run("generate", async () => {
    try { await api(`/api/code-agent/tasks/${t.id}/generate`, { method: "POST" }); setTab("changes"); } finally { await refresh(t.id); }
  });
  const approve = (t: Task) => run("approve", async () => {
    try { await api(`/api/code-agent/tasks/${t.id}/approve`, { method: "POST", json: { patchHash: diff?.patchHash, acknowledgeRisks: ack } }); setNotice("Patch approved. Nothing has been written yet."); }
    finally { await refresh(t.id); }
  });
  const applyPatch = (t: Task) => run("apply", async () => {
    try { await api(`/api/code-agent/tasks/${t.id}/apply`, { method: "POST", json: { patchHash: diff?.patchHash } }); setNotice(`Applied ${diff?.totals.files ?? 0} file change(s) to ${t.repo}.`); }
    finally { await refresh(t.id); if (repo) api<Git>(`/api/code-agent/repos/${repo}/git`).then(setGit).catch(() => {}); }
  });
  const rollback = (t: Task) => run("rollback", async () => {
    if (!confirm("Roll back this task's changes? Only the agent's files are restored, and only if nobody edited them since.")) return;
    try { await api(`/api/code-agent/tasks/${t.id}/rollback`, { method: "POST" }); setNotice("Rolled back."); }
    finally { await refresh(t.id); }
  });

  const highRisk = useMemo(() => diff?.review.some(w => w.severity === "high") ?? false, [diff]);
  const blocked = useMemo(() => diff?.review.some(w => w.severity === "block") ?? false, [diff]);

  if (status && !status.enabled) return null;
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 md:px-6">
      <header>
        <a href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Workspace</a>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><Bot className="h-7 w-7 text-emerald-700" />AI Code Agent <Badge variant="outline">Experimental</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">Inspects an authorized repository, plans a change, proposes a patch for your review, and applies it only after you approve. Every applied task can be rolled back.</p>
      </header>

      {status && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800" role="note">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Code execution: Infrastructure blocked.</strong> {status.execution.blockedBy} The agent doesn&apos;t run commands or tests; run the planned tests yourself.</p>
        </div>
      )}
      {status && !status.configured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">No workspace configured.</p>
          <p className="mt-1">An administrator sets <code className="rounded bg-amber-100 px-1">CODE_AGENT_WORKSPACE_ROOT</code> (a folder of repositories) and <code className="rounded bg-amber-100 px-1">CODE_AGENT_REPOS</code> (the folder names the agent may use) on the server.</p>
        </div>
      )}
      {notice && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {status?.configured && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="planning"><Bot className="h-3.5 w-3.5" />Planning</TabsTrigger>
            <TabsTrigger value="changes"><FileCode2 className="h-3.5 w-3.5" />Proposed Changes</TabsTrigger>
            <TabsTrigger value="review"><ShieldAlert className="h-3.5 w-3.5" />Diff Review</TabsTrigger>
            <TabsTrigger value="history"><History className="h-3.5 w-3.5" />History</TabsTrigger>
          </TabsList>

          <TabsContent value="planning" className="mt-4 grid gap-4 md:grid-cols-[280px_1fr]">
            <aside className="space-y-3">
              <label className="block text-xs font-medium">Repository
                <select aria-label="Repository" value={repo} onChange={e => setRepo(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm">
                  {status.repos.map(r => <option key={r}>{r}</option>)}
                </select>
              </label>
              <div className="rounded-lg border p-3 text-xs" aria-label="Git status">
                <p className="flex items-center gap-1 font-medium"><GitBranch className="h-3.5 w-3.5" />{git ? `${git.branch ?? "detached"}${git.upstream ? ` → ${git.upstream}` : ""}` : "Not a git repository"}</p>
                {git && <p className="mt-1 text-muted-foreground">{git.changes.length ? `${git.changes.length} uncommitted change(s)` : "Working tree clean"}{git.ahead ? ` · ${git.ahead} ahead` : ""}{git.behind ? ` · ${git.behind} behind` : ""}</p>}
              </div>
              <ul aria-label="Repository files" className="max-h-80 overflow-auto rounded-lg border p-2 font-mono text-[11px]">
                {tree.slice(0, 400).map(f => <li key={f.path} className="truncate">{f.path}</li>)}
                {tree.length > 400 && <li className="text-muted-foreground">…{tree.length - 400} more</li>}
              </ul>
            </aside>
            <section className="space-y-4">
              <div className="space-y-2">
                <Textarea aria-label="Task" rows={4} placeholder="Describe the change, e.g. “Add input validation to the signup handler and a unit test for it.”" value={instruction} onChange={e => setInstruction(e.target.value)} />
                <Button disabled={!repo || instruction.trim().length < 3 || busy !== null} onClick={start}>{busy === "plan" && <Loader2 className="h-4 w-4 animate-spin" />}Create plan</Button>
              </div>
              {current?.plan && (
                <div className="space-y-3 rounded-xl border p-4" aria-label="Plan">
                  <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Plan</h2><Badge variant="outline">{STATUS_LABEL[current.status] ?? current.status}</Badge></div>
                  <p className="text-sm">{current.plan.summary}</p>
                  <div><h3 className="text-xs font-semibold uppercase text-muted-foreground">Affected files</h3>
                    <ul className="mt-1 space-y-1 text-sm">{current.plan.files.map(f => <li key={f.path}><Badge variant="outline" className="mr-2">{f.action}</Badge><code>{f.path}</code> <span className="text-muted-foreground">— {f.reason}</span></li>)}</ul></div>
                  {!!current.plan.refused?.length && <p className="text-xs text-amber-800">Refused: {current.plan.refused.map(r => `${r.path} (${r.reason})`).join(", ")}</p>}
                  {!!current.plan.steps.length && <div><h3 className="text-xs font-semibold uppercase text-muted-foreground">Steps</h3><ol className="mt-1 list-decimal pl-5 text-sm">{current.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
                  {!!current.plan.tests.length && <div><h3 className="text-xs font-semibold uppercase text-muted-foreground">Expected tests (not run)</h3><ul className="mt-1 list-disc pl-5 text-sm">{current.plan.tests.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
                  <div className="flex gap-2">
                    <Button disabled={busy !== null || !["planned", "review", "stale", "failed"].includes(current.status)} onClick={() => generate(current)}>{busy === "generate" && <Loader2 className="h-4 w-4 animate-spin" />}Generate patch</Button>
                    <Button variant="outline" disabled={busy !== null || ["approved", "applied", "applying", "rolling_back"].includes(current.status)} onClick={() => replan(current)}>Re-plan</Button>
                  </div>
                </div>
              )}
              {current?.error && <p className="text-xs text-red-700">Last error: {current.error}</p>}
            </section>
          </TabsContent>

          <TabsContent value="changes" className="mt-4 space-y-3">
            {!diff ? <p className="text-sm text-muted-foreground">No patch yet. Create a plan and generate a patch.</p> : (
              <>
                <p className="text-sm">{diff.explanation}</p>
                <p className="text-sm" aria-label="Patch totals"><strong>{diff.totals.files}</strong> file(s), <span className="text-emerald-700">+{diff.totals.additions}</span> <span className="text-red-700">−{diff.totals.deletions}</span></p>
                <ul className="divide-y rounded-lg border" aria-label="Proposed changes">
                  {diff.files.map(f => (
                    <li key={f.path} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <Badge variant="outline">{f.action}</Badge><code className="flex-1 truncate">{f.path}</code>
                      <span className="text-emerald-700">+{f.additions}</span><span className="text-red-700">−{f.deletions}</span>
                      {diff.review.some(w => w.path === f.path) && <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Has warnings" />}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" onClick={() => setTab("review")}>Review the diff</Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="review" className="mt-4 space-y-3">
            {!diff || !current ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : (
              <>
                {diff.review.length ? (
                  <ul className="space-y-2" aria-label="Risk warnings">
                    {diff.review.map((w, i) => <li key={i} className={cn("rounded-lg border p-2 text-sm", SEVERITY[w.severity])}><strong className="uppercase">{w.severity}</strong> · <code>{w.path}</code> — {w.message}</li>)}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">No risk warnings.</p>}
                {diff.files.map(f => (
                  <section key={f.path} className="overflow-hidden rounded-lg border" aria-label={`Diff of ${f.path}`}>
                    <h3 className="border-b bg-muted/40 px-3 py-1.5 font-mono text-xs">{f.path} <span className="text-emerald-700">+{f.additions}</span> <span className="text-red-700">−{f.deletions}</span></h3>
                    <DiffView diff={f.diff} />
                  </section>
                ))}
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Patch <code>{diff.patchHash?.slice(0, 12)}</code> · status <strong>{STATUS_LABEL[current.status] ?? current.status}</strong></p>
                  {highRisk && current.status === "review" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I&apos;ve reviewed the high-risk warnings</label>}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy !== null || current.status !== "review" || blocked || (highRisk && !ack)} onClick={() => approve(current)}><Check className="h-4 w-4" />Approve patch</Button>
                    <Button variant="outline" disabled={busy !== null || current.status !== "approved"} onClick={() => applyPatch(current)}>{busy === "apply" && <Loader2 className="h-4 w-4 animate-spin" />}Apply approved patch</Button>
                    {current.status === "stale" && <Button variant="outline" onClick={() => generate(current)}><RotateCcw className="h-4 w-4" />Regenerate</Button>}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
            <ul className="divide-y rounded-lg border" aria-label="Task history">
              {tasks.map(t => (
                <li key={t.id}>
                  <button onClick={() => run("open", () => openTask(t.id))} className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted", current?.id === t.id && "bg-muted")}>
                    <span className="block truncate font-medium">{t.instruction}</span>
                    <span className="text-xs text-muted-foreground">{t.repo} · {STATUS_LABEL[t.status] ?? t.status} · {new Date(t.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
              {!tasks.length && <li className="p-3 text-sm text-muted-foreground">No tasks yet.</li>}
            </ul>
            <div className="space-y-3">
              {current && (
                <div className="rounded-lg border p-3 text-sm" aria-label="Selected task">
                  <p className="font-medium">{current.instruction}</p>
                  <p className="text-xs text-muted-foreground">{STATUS_LABEL[current.status] ?? current.status}{current.model ? ` · ${current.model}` : ""}</p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setTab("review")}>Open review</Button>
                    <Button variant="outline" size="sm" disabled={busy !== null || current.status !== "applied"} onClick={() => rollback(current)}><Undo2 className="h-4 w-4" />Roll back</Button>
                  </div>
                </div>
              )}
              {current && (
                <div className="overflow-x-auto rounded-lg border" aria-label="Task audit">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-2">When</th><th className="p-2">Action</th><th className="p-2">Outcome</th><th className="p-2">Detail</th></tr></thead>
                    <tbody>{auditRows.map((a, i) => <tr key={i} className="border-t"><td className="p-2">{new Date(a.created_at).toLocaleTimeString()}</td><td className="p-2 font-mono">{a.action}</td><td className="p-2">{a.outcome}</td><td className="max-w-[14rem] truncate p-2">{a.detail ?? (a.patch_hash ? a.patch_hash.slice(0, 12) : "—")}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
