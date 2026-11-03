"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleHelp, Download, ExternalLink, Globe, Loader2, Microscope, Scale, ShieldCheck, Square } from "lucide-react";
import { MessageContent } from "@/components/message-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// A-Zee Search: Smart Search, Deep Research, Compare and Verify claims, over /api/v1/search/* and
// /api/v1/research/*. Every claim shows whether its quote was found in the cited source.

type Source = { n: number; id: string; title: string; url: string; domain: string; publishedAt: string | null; retrievedAt: string; relevance: number | null; freshness: { label: string; ageDays: number | null } };
type Citation = { n: number; quote: string; found: boolean };
type Claim = { text: string; citations: Citation[]; status: "verified" | "unverified" | "uncited" };
type Verification = { verified: number; unverified: number; uncited?: number; total: number };
type SearchResult = { id: string; query: string; answer: string; sources: Source[]; claims: Claim[]; verification: Verification; unknownCitations: number[]; model: string | null; provider: string; retrievedAt: string };
type Job = { id: string; question: string; status: string; phase: string; plan: string[]; progress: { done: number; total: number }; steps: { question: string; sources: number; findings: number; verified: number; error?: string }[]; error: string | null; model: string | null; hasReport: boolean; createdAt: string };
type Report = {
  title: string; question: string; summary: string; gaps: string[];
  evidence: { claim: string; source: number; quote: string; verified: boolean }[];
  conflicts: { topic: string; positions: { claim: string; sources: number[] }[] }[];
  references: { n: number; title: string; url: string; domain: string; publishedAt: string | null; retrievedAt: string; freshness: string }[];
  verification: Verification; model: string | null; provider: string; generatedAt: string;
};
type CompareResult = { a: string; b: string; summary: string; rows: { aspect: string; a: Claim; b: Claim }[]; sources: Source[]; verification: Verification; model: string | null; retrievedAt: string };
type VerifyResult = { results: { claim: string; verdict: "supported" | "contradicted" | "not_found" | "unverified"; explanation: string; citations: Citation[]; sources: Source[] }[]; model: string | null; retrievedAt: string };

const MESSAGES: Record<string, string> = {
  SEARCH_NOT_CONFIGURED: "Live web search isn't set up yet. Add TAVILY_API_KEY to .env.local and restart the server.",
  SEARCH_UNAVAILABLE: "The search provider didn't respond. Try again in a moment.",
  AI_PROVIDER_UNAVAILABLE: "The AI providers are unavailable right now. Try again shortly.",
  AI_INVALID_OUTPUT: "The model returned an unusable answer twice. Try again or rephrase.",
  INPUT_BLOCKED: "This request was blocked by the safety check. Rephrase it.",
  OUTPUT_BLOCKED: "The answer was withheld by the safety check.",
  JOB_ALREADY_RUNNING: "A research job is already running. Wait for it to finish or cancel it.",
  PLAN_LIMIT_REACHED: "You've reached this month's limit on your plan. See /pricing.",
  UPGRADE_REQUIRED: "Research is included with a higher plan. See /pricing.",
  SIGN_IN_REQUIRED: "A-Zee Search is available to this computer's signed-in account.",
  NOT_PERMITTED: "Live search isn't enabled on this server.",
  INVALID_INPUT: "Check the input and try again.",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(MESSAGES[data.error] ?? data.error ?? `Request failed (${response.status})`);
  return data.data as T;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "date unknown");
const FRESH: Record<string, string> = { fresh: "bg-emerald-100 text-emerald-800", recent: "bg-sky-100 text-sky-800", older: "bg-amber-100 text-amber-800", unknown: "bg-slate-100 text-slate-600" };

function Status({ claim }: { claim: Pick<Claim, "status"> }) {
  return claim.status === "verified"
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Verified</span>
    : claim.status === "unverified"
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><CircleAlert className="h-3.5 w-3.5" />Quote not found</span>
      : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><CircleHelp className="h-3.5 w-3.5" />No citation</span>;
}

function VerificationBar({ v, noun = "claims" }: { v: Verification; noun?: string }) {
  if (!v.total) return null;
  const pct = Math.round((100 * v.verified) / v.total);
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm" role="status">
      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
      <span><strong>{v.verified} of {v.total}</strong> {noun} verified against the source text</span>
      <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-slate-200" aria-hidden="true"><span className="block h-full bg-emerald-600" style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2" aria-label="Sources">
      {sources.map(s => (
        <li key={s.id} id={`source-${s.n}`} className="rounded-lg border p-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-slate-900 px-1 text-[11px] font-semibold text-white">{s.n}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:underline">{s.title} <ExternalLink className="inline h-3 w-3" /></a>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{s.domain}</span>
            <span className={cn("rounded px-1.5 py-0.5", FRESH[s.freshness.label])} title={s.freshness.ageDays === null ? "Publication date unknown" : `${s.freshness.ageDays} days old`}>
              {s.publishedAt ? `Published ${day(s.publishedAt)}` : "Date unknown"}
            </span>
            {s.relevance !== null && (
              <span className="inline-flex items-center gap-1" title={`Relevance ${Math.round(s.relevance * 100)}%`}>
                Relevance <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-sky-600" style={{ width: `${Math.round(s.relevance * 100)}%` }} /></span>
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Quotes({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <ul className="mt-1 space-y-1">
      {citations.map((c, i) => (
        <li key={i} className={cn("border-l-2 pl-2 text-xs", c.found ? "border-emerald-500 text-slate-600" : "border-amber-500 text-amber-800")}>
          <a href={`#source-${c.n}`} className="font-semibold hover:underline">[{c.n}]</a> “{c.quote}” {c.found ? "" : "(not found in the source)"}
        </li>
      ))}
    </ul>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">{children}</section>;
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function SmartSearch({ onResearch }: { onResearch: (q: string) => void }) {
  const [query, setQuery] = useState("");
  const [recency, setRecency] = useState("any");
  const [result, setResult] = useState<SearchResult | null>(null);
  const { busy, error, run } = useBusy();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) run(async () => { setResult(null); setResult(await api<SearchResult>("/api/v1/search/query", { method: "POST", body: JSON.stringify({ query, recency }) })); });
  };
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Search the web" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask anything. A-Zee searches the live web and cites its sources." maxLength={500} className="h-11" />
        <select aria-label="Recency" value={recency} onChange={e => setRecency(e.target.value)} className="h-11 rounded-md border bg-background px-3 text-sm">
          <option value="any">Any time</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option>
        </select>
        <Button type="submit" disabled={busy || !query.trim()} className="h-11">{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Searching…</> : "Search"}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && (
        <Panel>
          <div className="prose-sm max-w-none"><MessageContent role="assistant" content={result.answer} /></div>
          {!!result.unknownCitations.length && <p className="text-xs text-amber-700">The answer cites [{result.unknownCitations.join("], [")}], which match no source.</p>}
          <VerificationBar v={result.verification} />
          {!!result.claims.length && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Claims</h3>
              <ul className="space-y-3">{result.claims.map((c, i) => <li key={i}><div className="flex items-start justify-between gap-3 text-sm"><span>{c.text}</span><Status claim={c} /></div><Quotes citations={c.citations} /></li>)}</ul>
            </div>
          )}
          {!!result.sources.length && <div><h3 className="mb-2 text-sm font-semibold">Sources</h3><Sources sources={result.sources} /></div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>Retrieved {new Date(result.retrievedAt).toLocaleString()} via {result.provider}{result.model ? ` · answered by ${result.model}` : ""}</span>
            <Button variant="outline" size="sm" onClick={() => onResearch(result.query)}><Microscope className="h-3.5 w-3.5" />Deep research this</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

const PHASES = ["plan", "investigate", "synthesize", "done"] as const;

function DeepResearch({ seed }: { seed: string }) {
  const [question, setQuestion] = useState(seed);
  const [job, setJob] = useState<Job | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const { busy, error, run } = useBusy();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setQuestion(seed), [seed]);

  const refreshList = useCallback(() => api<Job[]>("/api/v1/research/jobs").then(setJobs).catch(() => {}), []);
  useEffect(() => { refreshList(); return () => clearTimeout(timer.current); }, [refreshList]);

  const follow = useCallback(async (id: string) => {
    clearTimeout(timer.current);
    try {
      const next = await api<Job>(`/api/v1/research/jobs/${id}`);
      setJob(next);
      if (next.status === "running" || next.status === "queued") timer.current = setTimeout(() => follow(id), 2000);
      else {
        refreshList();
        if (next.hasReport) setReport(await api<Report>(`/api/v1/research/jobs/${id}/report`));
      }
    } catch { timer.current = setTimeout(() => follow(id), 4000); }
  }, [refreshList]);

  const start = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 3) run(async () => {
      setReport(null);
      const created = await api<Job>("/api/v1/search/deep-research", { method: "POST", body: JSON.stringify({ question }) });
      setJob(created); follow(created.id); refreshList();
    });
  };
  const cancel = () => job && run(async () => { setJob(await api<Job>(`/api/v1/research/jobs/${job.id}`, { method: "DELETE" })); clearTimeout(timer.current); refreshList(); });
  const open = (j: Job) => { setReport(null); setJob(j); follow(j.id); };
  const active = job && (job.status === "running" || job.status === "queued");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
      <div className="space-y-5">
        <form onSubmit={start} className="space-y-2">
          <Label htmlFor="research-question">Research question</Label>
          <Textarea id="research-question" value={question} onChange={e => setQuestion(e.target.value)} rows={3} maxLength={2000}
            placeholder="e.g. What does current evidence say about four-day work weeks and productivity?" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Plans sub-questions, searches each, extracts quoted evidence, then writes a referenced report. Takes about a minute.</p>
            <Button type="submit" disabled={busy || !!active || question.trim().length < 3}>Start research</Button>
          </div>
        </form>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {job && (
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><p className="text-xs text-muted-foreground">Research job</p><p className="truncate font-medium">{job.question}</p></div>
              <div className="flex items-center gap-2">
                <Badge variant={job.status === "completed" ? "default" : job.status === "failed" ? "destructive" : "outline"}>{job.status}</Badge>
                {active && <Button size="sm" variant="outline" onClick={cancel}><Square className="h-3 w-3" />Cancel</Button>}
              </div>
            </div>
            <ol className="flex flex-wrap gap-2 text-xs" aria-label="Phases">
              {PHASES.map(p => {
                const reached = PHASES.indexOf(job.phase as typeof PHASES[number]) >= PHASES.indexOf(p);
                return <li key={p} aria-current={job.phase === p ? "step" : undefined} className={cn("rounded-full border px-3 py-1 capitalize", reached ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "text-muted-foreground")}>
                  {p === "investigate" ? `Investigate ${job.progress.done}/${job.progress.total || "…"}` : p}
                </li>;
              })}
            </ol>
            {!!job.plan.length && (
              <ul className="space-y-1.5 text-sm">
                {job.plan.map((q, i) => {
                  const step = job.steps[i];
                  return <li key={i} className="flex items-start gap-2">
                    {step ? (step.error ? <CircleAlert className="mt-0.5 h-4 w-4 text-amber-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />)
                      : active && i === job.steps.length ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-slate-500" /> : <span className="mt-1.5 h-2 w-2 rounded-full bg-slate-300" />}
                    <span>{q}{step && <span className="block text-xs text-muted-foreground">{step.error ?? `${step.sources} sources · ${step.findings} findings · ${step.verified} verified`}</span>}</span>
                  </li>;
                })}
              </ul>
            )}
            {job.status === "failed" && <p role="alert" className="text-sm text-red-600">The job failed: {MESSAGES[job.error ?? ""] ?? job.error}</p>}
          </Panel>
        )}

        {report && (
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xl font-semibold">{report.title}</h2>
              <Button asChild size="sm" variant="outline"><a href={`/api/v1/research/jobs/${job?.id}/report?format=md`} download><Download className="h-3.5 w-3.5" />Export Markdown</a></Button>
            </div>
            <VerificationBar v={report.verification} noun="findings" />
            <div className="prose-sm max-w-none"><MessageContent role="assistant" content={report.summary} /></div>
            {!!report.evidence.length && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Evidence</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-2">Claim</th><th className="p-2">Source</th><th className="p-2">Quote</th><th className="p-2">Verified</th></tr></thead>
                    <tbody>{report.evidence.map((e, i) => (
                      <tr key={i} className="border-t align-top"><td className="p-2">{e.claim}</td><td className="p-2"><a href={`#ref-${e.source}`} className="hover:underline">[{e.source}]</a></td><td className="p-2 italic">“{e.quote}”</td>
                        <td className="p-2">{e.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Verified" /> : <CircleAlert className="h-4 w-4 text-amber-600" aria-label="Quote not found in source" />}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
            {!!report.conflicts.length && (
              <div><h3 className="mb-2 text-sm font-semibold">Conflicting claims</h3>
                <ul className="space-y-2 text-sm">{report.conflicts.map((c, i) => <li key={i} className="rounded-lg border p-3"><p className="font-medium">{c.topic}</p>
                  <ul className="mt-1 list-disc pl-5">{c.positions.map((p, k) => <li key={k}>{p.claim} {p.sources.map(n => <a key={n} href={`#ref-${n}`} className="text-xs font-semibold hover:underline">[{n}]</a>)}</li>)}</ul></li>)}</ul>
              </div>
            )}
            {!!report.gaps.length && <div><h3 className="mb-2 text-sm font-semibold">Research gaps</h3><ul className="list-disc space-y-1 pl-5 text-sm">{report.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>}
            <div><h3 className="mb-2 text-sm font-semibold">References</h3>
              <ol className="space-y-1 text-xs">{report.references.map(r => (
                <li key={r.n} id={`ref-${r.n}`}><span className="font-semibold">[{r.n}]</span> <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.title}</a> — {r.domain}, {r.publishedAt ? `published ${day(r.publishedAt)}` : "date unknown"}, retrieved {day(r.retrievedAt)}</li>
              ))}</ol>
            </div>
            <p className="border-t pt-3 text-xs text-muted-foreground">Generated {new Date(report.generatedAt).toLocaleString()} · sources via {report.provider}{report.model ? ` · ${report.model}` : ""}</p>
          </Panel>
        )}
      </div>

      <aside className="space-y-2">
        <h3 className="text-sm font-semibold">Your research</h3>
        {jobs.length ? jobs.map(j => (
          <button key={j.id} onClick={() => open(j)} className={cn("block w-full rounded-lg border p-2 text-left text-xs hover:bg-muted/50", job?.id === j.id && "border-emerald-600")}>
            <span className="line-clamp-2 font-medium">{j.question}</span>
            <span className="mt-1 block text-muted-foreground">{j.status} · {new Date(j.createdAt).toLocaleDateString()}</span>
          </button>
        )) : <p className="text-xs text-muted-foreground">No research jobs yet.</p>}
      </aside>
    </div>
  );
}

function Compare() {
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [focus, setFocus] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const { busy, error, run } = useBusy();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (a.trim() && b.trim()) run(async () => { setResult(null); setResult(await api<CompareResult>("/api/v1/search/compare", { method: "POST", body: JSON.stringify({ a, b, ...(focus.trim() ? { focus } : {}) }) })); });
  };
  const cell = (c: Claim) => <div><p>{c.text}</p><div className="mt-1"><Status claim={c} /></div><Quotes citations={c.citations} /></div>;
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Input aria-label="Option A" value={a} onChange={e => setA(e.target.value)} placeholder="Option A, e.g. PostgreSQL" maxLength={200} />
        <Input aria-label="Option B" value={b} onChange={e => setB(e.target.value)} placeholder="Option B, e.g. MySQL" maxLength={200} />
        <Input aria-label="Focus" value={focus} onChange={e => setFocus(e.target.value)} placeholder="Focus (optional), e.g. for analytics" maxLength={300} />
        <Button type="submit" disabled={busy || !a.trim() || !b.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Compare"}</Button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && (
        <Panel>
          <div className="prose-sm max-w-none"><MessageContent role="assistant" content={result.summary} /></div>
          <VerificationBar v={result.verification} noun="cells" />
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-2">Aspect</th><th className="p-2">{result.a}</th><th className="p-2">{result.b}</th></tr></thead>
              <tbody>{result.rows.map((r, i) => <tr key={i} className="border-t align-top"><td className="p-2 font-medium">{r.aspect}</td><td className="p-2">{cell(r.a)}</td><td className="p-2">{cell(r.b)}</td></tr>)}</tbody>
            </table>
          </div>
          <div><h3 className="mb-2 text-sm font-semibold">Sources</h3><Sources sources={result.sources} /></div>
        </Panel>
      )}
    </div>
  );
}

const VERDICT: Record<string, { label: string; tone: string }> = {
  supported: { label: "Supported", tone: "text-emerald-700" }, contradicted: { label: "Contradicted", tone: "text-red-700" },
  not_found: { label: "Not found in sources", tone: "text-slate-600" }, unverified: { label: "Unverified (quote not in source)", tone: "text-amber-700" },
};

function VerifyClaims() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const { busy, error, run } = useBusy();
  const claims = text.split("\n").map(s => s.trim()).filter(s => s.length >= 5).slice(0, 5);
  const submit = (e: FormEvent) => { e.preventDefault(); if (claims.length) run(async () => { setResult(null); setResult(await api<VerifyResult>("/api/v1/search/verify-claims", { method: "POST", body: JSON.stringify({ claims }) })); }); };
  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="claims">Claims to check (one per line, up to 5)</Label>
        <Textarea id="claims" value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={"The Eiffel Tower is 330 metres tall.\nPython 3.13 removed the GIL by default."} />
        <div className="flex justify-end"><Button type="submit" disabled={busy || !claims.length}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" />Checking…</> : `Check ${claims.length || ""} claim${claims.length === 1 ? "" : "s"}`}</Button></div>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="space-y-3">
          {result.results.map((r, i) => (
            <Panel key={i}>
              <div className="flex items-start justify-between gap-3"><p className="font-medium">{r.claim}</p><span className={cn("shrink-0 text-sm font-semibold", VERDICT[r.verdict].tone)}>{VERDICT[r.verdict].label}</span></div>
              <p className="text-sm text-muted-foreground">{r.explanation}</p>
              <Quotes citations={r.citations} />
              {!!r.sources.length && <Sources sources={r.sources} />}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchApp() {
  const [status, setStatus] = useState<{ configured: boolean; provider: string } | null>(null);
  const [blocked, setBlocked] = useState("");
  const [tab, setTab] = useState("search");
  const [seed, setSeed] = useState("");
  useEffect(() => {
    fetch("/api/v1/search/status", { cache: "no-store" })
      .then(async r => { const d = await r.json().catch(() => ({})); if (r.ok) setStatus(d.data); else setBlocked(MESSAGES[d.error] ?? "A-Zee Search is unavailable."); })
      .catch(() => setBlocked("A-Zee Search is unavailable."));
  }, []);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Workspace</a>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight"><Globe className="h-7 w-7 text-emerald-700" />A-Zee Search</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live web answers with numbered citations. Every claim is checked against the text of the source it cites.</p>
        </div>
        <a href="/platform" className="text-sm text-muted-foreground hover:underline">Platform overview →</a>
      </header>

      {blocked && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{blocked}</p>}
      {status && !status.configured && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Live web search isn't set up yet.</p>
          <p className="mt-1">Get a key at <a className="underline" href="https://tavily.com" target="_blank" rel="noopener noreferrer">tavily.com</a>, add <code className="rounded bg-amber-100 px-1">TAVILY_API_KEY=…</code> to <code className="rounded bg-amber-100 px-1">.env.local</code>, and restart the server.</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="search"><Globe className="mr-1.5 h-4 w-4" />Search</TabsTrigger>
          <TabsTrigger value="research"><Microscope className="mr-1.5 h-4 w-4" />Deep research</TabsTrigger>
          <TabsTrigger value="compare"><Scale className="mr-1.5 h-4 w-4" />Compare</TabsTrigger>
          <TabsTrigger value="verify"><ShieldCheck className="mr-1.5 h-4 w-4" />Verify claims</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-5"><SmartSearch onResearch={q => { setSeed(q); setTab("research"); }} /></TabsContent>
        <TabsContent value="research" className="mt-5"><DeepResearch seed={seed} /></TabsContent>
        <TabsContent value="compare" className="mt-5"><Compare /></TabsContent>
        <TabsContent value="verify" className="mt-5"><VerifyClaims /></TabsContent>
      </Tabs>
    </main>
  );
}
