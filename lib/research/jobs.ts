import "server-only";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import type { RequestActor } from "@/lib/pipeline/actor";
import { openSession, type AiSession } from "@/lib/search/session";
import { saveSources, type StoredSource } from "@/lib/search/store";
import { SEARCH_PROVIDER, searchConfigured, SearchNotConfiguredError, webSearch } from "@/lib/search/tavily";
import { freshness, quoteFound } from "@/lib/search/verify";

// A-Zee Deep Research: durable multi-step investigations.
//   plan → investigate (one checkpoint per sub-question) → synthesize → done
// Every step is saved to research_jobs before the next starts, so a job interrupted by a restart
// resumes from its last checkpoint (resumeStale) instead of starting over. Findings are only
// counted as verified when their quote is present in the retrieved source text.

export class ResearchError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

type Finding = { id: string; claim: string; sourceId: string; quote: string; verified: boolean };
type Step = { question: string; sources: string[]; findings: Finding[]; error?: string };
export type ResearchReport = {
  title: string; question: string; summary: string;
  evidence: { claim: string; source: number; quote: string; verified: boolean }[];
  conflicts: { topic: string; positions: { claim: string; sources: number[] }[] }[];
  gaps: string[];
  references: { n: number; id: string; title: string; url: string; domain: string; publishedAt: string | null; retrievedAt: string; freshness: string }[];
  verification: { verified: number; unverified: number; total: number };
  model: string | null; provider: string; generatedAt: string;
};

const running = new Map<string, AbortController>();
const STALE_MS = 90_000;
const MAX_SUBQUESTIONS = 5;

const view = (r: Record<string, unknown>) => {
  const steps = (r.steps as Step[]) ?? [];
  const plan = (r.plan as string[]) ?? [];
  return {
    id: r.id as string, question: r.question as string, status: r.status as string, phase: r.phase as string,
    plan, progress: { done: steps.length, total: plan.length },
    steps: steps.map(s => ({ question: s.question, sources: s.sources.length, findings: s.findings.length, verified: s.findings.filter(f => f.verified).length, ...(s.error ? { error: s.error } : {}) })),
    error: (r.error as string) ?? null, model: (r.model as string) ?? null, hasReport: !!r.report,
    createdAt: new Date(r.created_at as string).toISOString(), updatedAt: new Date(r.updated_at as string).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
  };
};
export type JobView = ReturnType<typeof view>;

async function load(ownerId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ResearchError(404, "NOT_FOUND");
  const { rows } = await pool.query(`SELECT * FROM research_jobs WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
  if (!rows.length) throw new ResearchError(404, "NOT_FOUND");
  return rows[0];
}

async function save(id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 2}${["plan", "steps", "report"].includes(k) ? "::jsonb" : ""}`);
  const values = keys.map(k => (["plan", "steps", "report"].includes(k) ? JSON.stringify(patch[k]) : patch[k]));
  await pool.query(`UPDATE research_jobs SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $1`, [id, ...values]);
}

export async function createJob(ownerId: string, actor: RequestActor, rawQuestion: unknown, fetchImpl: typeof fetch = fetch): Promise<JobView> {
  const question = z.string().trim().min(3).max(2000).parse(rawQuestion);
  if (!searchConfigured()) throw new SearchNotConfiguredError();
  // Plan limits, policy check and routing are checked now (the session is reopened by the runner).
  const session = await openSession(actor, question, ["messages", "research"], fetchImpl);
  let row;
  try {
    ({ rows: [row] } = await pool.query(`INSERT INTO research_jobs (owner_id, question, status) VALUES ($1, $2, 'running') RETURNING *`, [ownerId, question]));
  } catch (error) {
    await session.close(false);
    if ((error as { code?: string })?.code === "23505") throw new ResearchError(409, "JOB_ALREADY_RUNNING");
    throw error;
  }
  void run(ownerId, row.id, session, fetchImpl);
  return view(row);
}

export async function getJob(ownerId: string, id: string, actor: RequestActor, fetchImpl: typeof fetch = fetch): Promise<JobView> {
  await resumeStale(ownerId, id, actor, fetchImpl);
  return view(await load(ownerId, id));
}

export async function listJobs(ownerId: string) {
  const { rows } = await pool.query(`SELECT * FROM research_jobs WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 50`, [ownerId]);
  return rows.map(view);
}

export async function cancelJob(ownerId: string, id: string): Promise<JobView> {
  const row = await load(ownerId, id);
  if (row.status === "running" || row.status === "queued") {
    running.get(id)?.abort();
    await save(id, { status: "cancelled", finished_at: new Date().toISOString() });
  }
  return view(await load(ownerId, id));
}

export async function getReport(ownerId: string, id: string): Promise<ResearchReport> {
  const row = await load(ownerId, id);
  if (!row.report) throw new ResearchError(409, row.status === "failed" ? "JOB_FAILED" : "REPORT_NOT_READY");
  return row.report as ResearchReport;
}

/** A job left "running" by a stopped server continues from its last checkpoint. */
async function resumeStale(ownerId: string, id: string, actor: RequestActor, fetchImpl: typeof fetch) {
  const row = await load(ownerId, id);
  if (row.status !== "running" || running.has(id) || Date.now() - Date.parse(row.updated_at) < STALE_MS) return;
  await save(id, {});   // claim it (heartbeat) before restarting
  try {
    const session = await openSession(actor, row.question, ["messages"], fetchImpl);
    void run(ownerId, id, session, fetchImpl);
  } catch (error) {
    await save(id, { status: "failed", error: `Couldn't resume: ${(error as Error).message}`.slice(0, 500), finished_at: new Date().toISOString() });
  }
}

const sourceNumbering = (sources: StoredSource[]) => new Map(sources.map((s, i) => [s.id, i + 1]));

async function run(ownerId: string, id: string, session: AiSession, fetchImpl: typeof fetch) {
  const abort = new AbortController();
  running.set(id, abort);
  let ok = false;
  try {
    let row = await load(ownerId, id);
    const cancelled = async () => abort.signal.aborted || (await load(ownerId, id)).status === "cancelled";

    // 1. Plan: sub-questions.
    let plan: string[] = row.plan;
    if (!plan.length) {
      const out = await session.json(
        `Break the research question into ${MAX_SUBQUESTIONS - 2}-${MAX_SUBQUESTIONS} focused sub-questions that together answer it. Each must be answerable by a web search. Shape: {"subquestions": string[]}`,
        { question: row.question }, z.object({ subquestions: z.array(z.string().min(3).max(300)).min(1).max(8) }));
      plan = out.subquestions.slice(0, MAX_SUBQUESTIONS);
      await save(id, { plan, phase: "investigate", model: session.model() });
    }

    // 2. Investigate: one checkpoint per sub-question.
    let steps: Step[] = (await load(ownerId, id)).steps;
    for (let i = steps.length; i < plan.length; i++) {
      if (await cancelled()) return;
      const question = plan[i];
      let step: Step;
      try {
        const sources = await saveSources(ownerId, await webSearch(question, { maxResults: 5, depth: "advanced" }, fetchImpl), SEARCH_PROVIDER);
        const numbered = sources.map((s, n) => ({ n: n + 1, title: s.title, url: s.url, published: s.publishedAt?.slice(0, 10) ?? "unknown", text: s.content.slice(0, 3_000) }));
        const out = sources.length ? await session.json(
          "Extract the key findings that answer the sub-question from the numbered sources. Each finding: one factual claim, its source number, and an EXACT quote (copied word for word, 8–40 words) from that source. Shape: {\"findings\": [{\"claim\": string, \"n\": number, \"quote\": string}]}",
          { overallQuestion: row.question, subQuestion: question, sources: numbered },
          z.object({ findings: z.array(z.object({ claim: z.string().min(3).max(800), n: z.number().int().min(1).max(10), quote: z.string().min(1).max(600) })).max(8) }),
        ) : { findings: [] };
        step = {
          question, sources: sources.map(s => s.id),
          findings: out.findings.filter(f => sources[f.n - 1]).map((f, k) => ({
            id: `F${i + 1}.${k + 1}`, claim: f.claim, sourceId: sources[f.n - 1].id, quote: f.quote,
            verified: quoteFound(f.quote, sources[f.n - 1].content),
          })),
        };
      } catch (error) {
        if (error instanceof SearchNotConfiguredError) throw error;
        step = { question, sources: [], findings: [], error: "This step couldn't be completed (search or model unavailable)." };
      }
      steps = [...steps, step];
      await save(id, { steps });
    }
    if (await cancelled()) return;

    // 3. Synthesize: summary, conflicting claims and gaps, from verified findings first.
    await save(id, { phase: "synthesize" });
    const sourceIds = [...new Set(steps.flatMap(s => s.sources))];
    const { rows: sourceRows } = await pool.query(`SELECT * FROM search_sources WHERE owner_id = $1 AND id = ANY($2::uuid[])`, [ownerId, sourceIds]);
    const sources: StoredSource[] = sourceIds.map(sid => sourceRows.find(r => r.id === sid)).filter(Boolean).map(r => ({
      id: r.id, url: r.url, domain: r.domain, title: r.title, content: r.excerpt, provider: r.provider,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null, relevance: r.relevance === null ? null : Number(r.relevance),
      retrievedAt: new Date(r.retrieved_at).toISOString(),
    }));
    const number = sourceNumbering(sources);
    const findings = steps.flatMap(s => s.findings);
    const out = findings.length ? await session.json(
      [
        "Write the research report from the findings. Use only the findings; cite sources inline as [n] using each finding's source number.",
        "summary: Markdown, organized with short headings, answering the question; say clearly where evidence is thin.",
        "conflicts: places where findings disagree (reference finding ids). gaps: what the evidence doesn't answer and should be researched next.",
        'Shape: {"title": string, "summary": string, "conflicts": [{"topic": string, "positions": [{"claim": string, "findingIds": string[]}]}], "gaps": string[]}',
      ].join("\n"),
      { question: row.question, findings: findings.map(f => ({ id: f.id, claim: f.claim, source: number.get(f.sourceId), verified: f.verified })) },
      z.object({
        title: z.string().min(1).max(200), summary: z.string().min(1).max(30_000),
        conflicts: z.array(z.object({ topic: z.string().max(300), positions: z.array(z.object({ claim: z.string().max(800), findingIds: z.array(z.string().max(20)).max(10) })).max(6) })).max(8),
        gaps: z.array(z.string().max(500)).max(10),
      }), 6000,
    ) : { title: row.question.slice(0, 200), summary: "No findings could be gathered for this question. Check the steps for errors, or try rephrasing it.", conflicts: [], gaps: [] };
    await session.checkOutput(out.summary);

    const byId = new Map(findings.map(f => [f.id, f]));
    const report: ResearchReport = {
      title: out.title, question: row.question, summary: out.summary,
      evidence: findings.map(f => ({ claim: f.claim, source: number.get(f.sourceId) ?? 0, quote: f.quote, verified: f.verified })),
      conflicts: out.conflicts.map(c => ({
        topic: c.topic,
        positions: c.positions.map(p => ({ claim: p.claim, sources: [...new Set(p.findingIds.map(fid => byId.get(fid)).filter(Boolean).map(f => number.get(f!.sourceId) ?? 0))] })),
      })),
      gaps: out.gaps,
      references: sources.map((s, i) => ({ n: i + 1, id: s.id, title: s.title, url: s.url, domain: s.domain, publishedAt: s.publishedAt, retrievedAt: s.retrievedAt, freshness: freshness(s.publishedAt).label })),
      verification: { verified: findings.filter(f => f.verified).length, unverified: findings.filter(f => !f.verified).length, total: findings.length },
      model: session.model(), provider: SEARCH_PROVIDER, generatedAt: new Date().toISOString(),
    };
    await save(id, { report, phase: "done", status: "completed", finished_at: new Date().toISOString(), model: session.model() });
    ok = true;
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as Error).message;
    await save(id, { status: "failed", error: String(code).slice(0, 500), finished_at: new Date().toISOString() }).catch(() => {});
  } finally {
    running.delete(id);
    await session.close(ok).catch(() => {});
  }
}

/** The report as a Markdown document (export). */
export function reportMarkdown(r: ResearchReport): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `# ${r.title}`, "", `> ${r.question}`, "",
    `_Generated ${r.generatedAt} · ${r.model ?? "model"} · sources via ${r.provider} · ${r.verification.verified}/${r.verification.total} findings verified against source text_`, "",
    r.summary, "",
    "## Evidence", "", "| Claim | Source | Quote | Verified |", "|---|---|---|---|",
    ...r.evidence.map(e => `| ${esc(e.claim)} | [${e.source}] | “${esc(e.quote)}” | ${e.verified ? "yes" : "no"} |`), "",
    ...(r.conflicts.length ? ["## Conflicting claims", "", ...r.conflicts.flatMap(c => [`**${c.topic}**`, ...c.positions.map(p => `- ${p.claim} ${p.sources.map(n => `[${n}]`).join("")}`), ""])] : []),
    ...(r.gaps.length ? ["## Research gaps", "", ...r.gaps.map(g => `- ${g}`), ""] : []),
    "## References", "",
    ...r.references.map(s => `${s.n}. [${s.title}](${s.url}) — ${s.domain}${s.publishedAt ? `, published ${s.publishedAt.slice(0, 10)}` : ""}, retrieved ${s.retrievedAt.slice(0, 10)}`),
    "",
  ].join("\n");
}
