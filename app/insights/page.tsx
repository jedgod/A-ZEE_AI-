import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeProviders } from "@/lib/admin/provider-access";
import { LiveInsights } from "@/components/live/live-insights";
import { isLocalHeaders } from "@/lib/pipeline/actor";
import { canViewInsights, INSIGHT_DAYS, loadInsights, parseDays } from "@/lib/pipeline/insights";
import styles from "./insights.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights · AZ_AI" };

const label = (days: number) => (days === 1 ? "24 hours" : `${days} days`);

/** 14_OBSERVABILITY + 13_FEEDBACK dashboard. The local user or a staff admin (see canViewInsights). */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string; window?: string }> }) {
  if (!await canViewInsights(isLocalHeaders(await headers()))) notFound();
  const query = await searchParams;
  // ?window=<hours> is the older link format.
  const days = parseDays(query.days) ?? parseDays(Number(query.window) / 24) ?? 1;
  const initial = await loadInsights(days * 24, { providers: await canSeeProviders() }).catch(() => null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}>← Workspace</Link>
          <h1>Insights</h1>
          <p>How requests move through the pipeline. Metadata only: no prompts or answers are stored.</p>
        </div>
        <nav className={styles.windows} aria-label="Time window">
          {INSIGHT_DAYS.map(d => (
            <Link key={d} href={`/insights?days=${d}`} aria-current={d === days ? "page" : undefined}>{label(d)}</Link>
          ))}
        </nav>
      </header>

      {/* key: switching the window remounts, so the new period never shows the old one's data. */}
      <LiveInsights key={days} days={days} initial={initial} />

      <footer className={styles.footer}>
        <span>Refreshes every 15 seconds while this tab is open.</span>
        <a href={`/api/insights?days=${days}&download=1`} download>Export metadata ↓</a>
      </footer>
    </main>
  );
}
