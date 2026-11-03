import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

// Presentational pieces shared by the /admin pages (server-renderable).

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function Table({ head, rows, empty = "Nothing here yet." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>{head.map(h => <th key={h} className="whitespace-nowrap p-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>{rows.map((cells, i) => <tr key={i} className="border-t align-top">{cells.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default", enforced: "default", approved: "default", resolved: "secondary", connected: "default",
  enabled: "default", pending: "outline", review: "outline", open: "outline", investigating: "outline", partial: "outline",
  warning: "outline", suspended: "destructive", rejected: "destructive", blocked: "destructive", critical: "destructive",
  high: "destructive", paused: "secondary", disabled: "secondary", not_connected: "secondary", medium: "outline", low: "secondary",
};

export function Status({ value }: { value: string }) {
  return <Badge variant={TONE[value.toLowerCase()] ?? "secondary"}>{value.replace(/_/g, " ")}</Badge>;
}

export const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
