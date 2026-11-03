import Link from "next/link";
import { ArrowDown, ArrowLeft, Bot, Code2, Copy, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { platformState, type Status } from "@/lib/platform/modules";

export const dynamic = "force-dynamic";
export const metadata = { title: "A-Zee AI platform · AZ_AI", description: "The A-Zee AI architecture and the live status of all 25 modules." };

const LABEL: Record<Status, string> = { live: "Live", partial: "Partial", "needs-setup": "Needs setup", planned: "Planned" };
const TONE: Record<Status, string> = {
  live: "bg-emerald-100 text-emerald-800", partial: "bg-sky-100 text-sky-800",
  "needs-setup": "bg-amber-100 text-amber-900", planned: "bg-slate-100 text-slate-600",
};
const ICONS = [Globe, Code2, Sparkles, Bot, Copy, ShieldCheck];

function Pill({ status }: { status: Status }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[status]}`}>{LABEL[status]}</span>;
}

/** A-Zee AI: the blueprint's architecture with the real state of each part in this application. */
export default function PlatformPage() {
  const s = platformState();
  const pillarStatus = (ids: number[]): Status => {
    const st = ids.map(id => s.modules[id - 1].status);
    return st.every(x => x === "live") ? "live" : st.some(x => x === "live" || x === "partial") ? "partial" : st.includes("needs-setup") ? "needs-setup" : "planned";
  };
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 md:px-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-3.5 w-3.5" />Workspace</Link>

      <section className="rounded-2xl border bg-card p-6 shadow-sm md:p-8" aria-labelledby="arch">
        <div className="text-center">
          <h1 id="arch" className="text-3xl font-semibold tracking-tight">A-Zee AI</h1>
          <p className="mt-1 text-muted-foreground">Unified AI Intelligence &amp; Engineering Platform</p>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {s.pillars.map((p, i) => {
            const Icon = ICONS[i];
            const body = (
              <>
                <div className="flex items-center justify-between"><Icon className="h-5 w-5" /><Pill status={pillarStatus(p.modules)} /></div>
                <h2 className="mt-2 text-lg">{p.name}</h2>
                <p className="text-sm text-muted-foreground">{p.detail}</p>
              </>
            );
            return p.href
              ? <Link key={p.name} href={p.href} className="rounded-xl p-3 hover:bg-muted/50">{body}</Link>
              : <div key={p.name} className="rounded-xl p-3">{body}</div>;
          })}
        </div>
        <ArrowDown className="mx-auto my-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div className="rounded-xl border p-4 text-center">
          <h2 className="text-lg font-medium">A-Zee Orchestration Engine</h2>
          <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {s.engine.map(e => <span key={e.name} className="inline-flex items-center gap-1.5">{e.name} <Pill status={e.status} /></span>)}
          </p>
        </div>
        <ArrowDown className="mx-auto my-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div className="text-center">
          <h2 className="text-lg font-medium">Execution and Infrastructure</h2>
          <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {s.infrastructure.map(e => <span key={e.name} className="inline-flex items-center gap-1.5">{e.name} <Pill status={e.status} /></span>)}
          </p>
        </div>
      </section>

      <section aria-labelledby="modules">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="modules" className="text-xl font-semibold">Twenty-five capabilities</h2>
            <p className="text-sm text-muted-foreground">What each module does in this application today, and what comes next.</p>
          </div>
          <p className="flex flex-wrap gap-2 text-xs">{(Object.keys(LABEL) as Status[]).map(k => <span key={k} className="inline-flex items-center gap-1"><Pill status={k} /> {s.counts[k] ?? 0}</span>)}</p>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3">#</th><th className="p-3">Module</th><th className="p-3">Status</th><th className="p-3">In this app</th><th className="p-3">Next</th></tr></thead>
            <tbody>
              {s.modules.map(m => (
                <tr key={m.n} className="border-t align-top">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{String(m.n).padStart(2, "0")}</td>
                  <td className="p-3"><span className="font-medium">{m.href ? <Link href={m.href} className="hover:underline">{m.name}</Link> : m.name}</span><span className="block text-xs text-muted-foreground">{m.summary}</span></td>
                  <td className="p-3"><Pill status={m.status} /></td>
                  <td className="p-3 text-muted-foreground">{m.inApp}</td>
                  <td className="p-3 text-xs text-muted-foreground">{m.next ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="acceptance">
        <h2 id="acceptance" className="text-xl font-semibold">Release acceptance criteria</h2>
        <p className="text-sm text-muted-foreground">Evidence required before a subsystem is called production-ready, and where it stands.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3">System</th><th className="p-3">Requirement</th><th className="p-3">Status</th><th className="p-3">Current evidence</th></tr></thead>
            <tbody>{s.acceptance.map(a => (
              <tr key={a.system} className="border-t align-top"><td className="p-3 font-medium">{a.system}</td><td className="p-3">{a.requirement}</td><td className="p-3"><Pill status={a.status} /></td><td className="p-3 text-muted-foreground">{a.evidence}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">A-Zee AI distinguishes generated, executed, tested, reviewed and deployed: nothing here is reported as working because instructions for it were generated.</p>
      </section>
    </main>
  );
}
