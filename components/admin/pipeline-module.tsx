import Link from "next/link";
import { notFound } from "next/navigation";
import { DryRun } from "@/components/admin/dry-run";
import { PageHeader, Section, Status, Table } from "@/components/admin/admin-ui";
import { PipelineFlow } from "@/components/live/pipeline-flow";
import { consoleActor } from "@/lib/admin/console";
import { ProvidersPanel } from "@/components/live/providers-panel";
import { loadProviders } from "@/lib/admin/providers";
import { can } from "@/lib/admin/security";
import { loadStageLive } from "@/lib/admin/live";
import { configView, recordsView, type ViewBlock } from "@/lib/admin/pipeline";
import { CATALOG, findModule, STAGE_NAMES } from "@/lib/admin/pipeline-catalog";

// Production views for the stage modules (replacing the standalone page.tsx demos).

function Block({ block }: { block: ViewBlock }) {
  return (
    <Section title={block.heading}>
      {"text" in block ? <pre className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-sm leading-6">{block.text}</pre>
        : "json" in block ? <pre className="max-h-[480px] overflow-auto rounded-xl border bg-muted/30 p-4 font-mono text-xs">{JSON.stringify(block.json, null, 2)}</pre>
        : <Table head={block.table.head} rows={block.table.rows} empty="No records yet." />}
    </Section>
  );
}

export async function PipelineModulePage({ slug }: { slug: string }) {
  const actor = await consoleActor();
  const entry = findModule(slug);
  if (!entry) notFound();
  const blocks = entry.view.kind === "config" ? configView(entry.view.source)
    : entry.view.kind === "records" && process.env.DATABASE_URL ? await recordsView(entry.view.module) : [];
  const canRun = actor.role === "owner" || actor.role === "admin";

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/pipeline" className="text-sm text-muted-foreground hover:underline">← Pipeline stages</Link>
      <PageHeader eyebrow={`${entry.folder} / ${entry.module}`} title={entry.title} description={entry.summary} actions={<Status value={entry.status} />} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4 text-sm">
          <p className="font-medium">Used in</p>
          {entry.usedIn.length ? <ul className="mt-2 space-y-1">{entry.usedIn.map(f => <li key={f}><code className="text-xs">{f}</code></li>)}</ul>
            : <p className="mt-2 text-muted-foreground">Not called by the app.</p>}
        </div>
        <div className="rounded-xl border p-4 text-sm">
          <p className="font-medium">{entry.status === "connected" ? "Notes" : "What it needs"}</p>
          <p className="mt-2 text-muted-foreground">{entry.needs ?? "Fully connected."}</p>
        </div>
      </div>
      {entry.dryRun && (
        <div className="mt-8">
          {canRun ? <DryRun slug={entry.slug} example={entry.dryRun.example} hint={entry.dryRun.hint} />
            : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Owners and admins can dry-run this module.</p>}
        </div>
      )}
      {blocks.map(block => <Block key={block.heading} block={block} />)}
    </div>
  );
}

export async function PipelineIndexPage() {
  const actor = await consoleActor();
  const initial = await loadStageLive(actor).catch(() => null);
  const showProviders = can(actor, "users.write");
  const providers = showProviders ? await loadProviders(actor, 1).catch(() => null) : null;
  const count = (s: string) => CATALOG.filter(m => m.status === s).length;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Pipeline · stage modules" title="Pipeline stages"
        description={`${CATALOG.length} modules: ${count("connected")} connected, ${count("partial")} partly, ${count("not_connected")} not connected. Each stage shows its last 24 hours live; open a stage to reach its modules, live configuration, recent metadata and dry runs.`} />
      {showProviders && <ProvidersPanel initial={providers} />}
      <PipelineFlow initial={initial} />
    </div>
  );
}
