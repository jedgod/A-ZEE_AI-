import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocalHeaders } from "@/lib/pipeline/actor";
import { canViewInsights, INSIGHT_DAYS, loadInsights, parseDays } from "@/lib/pipeline/insights";
import styles from "./insights.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights · AZ_AI" };

const label = (days: number) => (days === 1 ? "24 hours" : `${days} days`);
const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "—");

/** 14_OBSERVABILITY + 13_FEEDBACK summary. The local user or a staff admin (see canViewInsights). */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string; window?: string }> }) {
  if (!await canViewInsights(isLocalHeaders(await headers()))) notFound();
  const query = await searchParams;
  // ?window=<hours> is the older link format.
  const days = parseDays(query.days) ?? parseDays(Number(query.window) / 24) ?? 1;
  const data = await loadInsights(days * 24).catch(() => null);
  const total = data ? data.requests.success + data.requests.failure : 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}>← Workspace</Link>
          <h1>Insights</h1>
          <p>How requests moved through the pipeline stages. Metadata only: no prompts or answers are stored.</p>
        </div>
        <nav className={styles.windows} aria-label="Time window">
          {INSIGHT_DAYS.map(d => (
            <Link key={d} href={`/insights?days=${d}`} aria-current={d === days ? "page" : undefined}>{label(d)}</Link>
          ))}
        </nav>
      </header>

      {!data ? (
        <p className={styles.empty}>Insights need the PostgreSQL database (DATABASE_URL) and the 006 migration.</p>
      ) : total === 0 ? (
        <p className={styles.empty}>No requests in the last {label(days)} yet. Send a message in the workspace and come back.</p>
      ) : (
        <>
          <section className={styles.summary} aria-label="Summary">
            <div><span>Requests</span><strong>{total}</strong><small>{pct(data.requests.success, total)} answered</small></div>
            <div><span>Typical time</span><strong>{ms(data.requests.p50Ms)}</strong><small>p95 {ms(data.requests.p95Ms)}</small></div>
            <div><span>Feedback</span><strong>{data.feedback.up} 👍 · {data.feedback.down} 👎</strong><small>{data.feedback.corrections} corrections</small></div>
            <div><span>With attachments</span><strong>{data.attachments}</strong><small>of {total} requests</small></div>
          </section>

          <section>
            <h2>Providers <small>04 routing · 05 model layer</small></h2>
            <table>
              <thead><tr><th>Provider</th><th>Attempts</th><th>Succeeded</th><th>Avg</th><th>p95</th></tr></thead>
              <tbody>
                {data.providers.map(p => (
                  <tr key={p.id}><td>{p.id}</td><td>{p.attempts}</td><td>{pct(p.successes, p.attempts)}</td><td>{ms(p.avgMs)}</td><td>{ms(p.p95Ms)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Stages <small>14 traces</small></h2>
            <table>
              <thead><tr><th>Stage</th><th>Runs</th><th>Avg</th><th>Errors</th></tr></thead>
              <tbody>
                {data.stages.map(s => (
                  <tr key={s.operation}><td>{s.operation}</td><td>{s.count}</td><td>{ms(s.avgMs)}</td><td>{s.errors}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className={styles.split}>
            <section>
              <h2>Tasks <small>01 intake · 04 classifier</small></h2>
              <table>
                <thead><tr><th>Task type</th><th>Requests</th></tr></thead>
                <tbody>{data.tasks.map(t => <tr key={t.type}><td>{t.type.replace(/_/g, " ")}</td><td>{t.count}</td></tr>)}</tbody>
              </table>
            </section>
            <section>
              <h2>Errors <small>13 error logs</small></h2>
              {data.errors.length ? (
                <table>
                  <thead><tr><th>Category</th><th>Count</th></tr></thead>
                  <tbody>{data.errors.map(e => <tr key={e.category}><td>{e.category}</td><td>{e.count}</td></tr>)}</tbody>
                </table>
              ) : <p className={styles.muted}>No errors.</p>}
            </section>
          </div>

          <div className={styles.split}>
            <section>
              <h2>Structure score vs ratings <small>10 quality · 13 feedback</small></h2>
              <p className={styles.muted}>
                Rubric {data.quality.rubric}: visible structure only, not accuracy. {data.quality.scored} answers scored.
                Uncalibrated until each band has enough rated answers.
              </p>
              <table>
                <thead><tr><th>Score</th><th>Rated answers</th><th>Helpful</th></tr></thead>
                <tbody>
                  {data.quality.buckets.map(b => (
                    <tr key={b.low}>
                      <td>{b.low}–{b.high === 100 ? 100 : b.high - 1}</td>
                      <td>{b.count}</td>
                      <td>{b.helpfulRate === null ? "—" : `${Math.round(b.helpfulRate * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h2>Answer styles <small>09 style control</small></h2>
              {data.styles.length ? (
                <table>
                  <thead><tr><th>Style</th><th>Requests</th></tr></thead>
                  <tbody>{data.styles.map(s => <tr key={s.style}><td>{s.style}</td><td>{s.count}</td></tr>)}</tbody>
                </table>
              ) : <p className={styles.muted}>No styled requests yet.</p>}
            </section>
          </div>
        </>
      )}

      {data && (
        <footer className={styles.footer}>
          <span>Metadata only: counts, timings and ratings.</span>
          <a href={`/api/insights?days=${days}&download=1`} download>Export metadata ↓</a>
        </footer>
      )}
    </main>
  );
}
