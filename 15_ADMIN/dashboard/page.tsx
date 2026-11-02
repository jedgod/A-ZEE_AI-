"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const metrics = [
  { label: "Requests / day", value: "42.6k", trend: "+12.4%" },
  { label: "Active tenants", value: "184", trend: "+9" },
  { label: "Policy blocks", value: "63", trend: "-5.1%" },
  { label: "Approval queue", value: "11", trend: "3 urgent" },
];

const incidents = [
  { name: "Model latency threshold", severity: "High", owner: "Platform" },
  { name: "Extension policy drift", severity: "Medium", owner: "Security" },
  { name: "Billing anomaly", severity: "Low", owner: "Finance" },
];

export default function AdminDashboardPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6">
      <header className="flex flex-col gap-3 border-b pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs text-muted-foreground">15_ADMIN</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Governance dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">Export audit</Button>
          <Button>New approval</Button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">{metric.label}</p>
            <div className="mt-4 flex items-end justify-between">
              <span className="text-3xl font-semibold">{metric.value}</span>
              <Badge variant="secondary">{metric.trend}</Badge>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Operational overview</h2>
            <Badge variant="outline">Last 24h</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Model usage</p>
              <p className="mt-2 text-2xl font-semibold">68%</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Failed validations</p>
              <p className="mt-2 text-2xl font-semibold">14</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Extension activity</p>
              <p className="mt-2 text-2xl font-semibold">9 enabled</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="text-xl font-semibold">Open incidents</h2>
          <div className="mt-4 space-y-3">
            {incidents.map((incident) => (
              <div key={incident.name} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{incident.name}</p>
                  <p className="text-xs text-muted-foreground">{incident.owner}</p>
                </div>
                <Badge variant={incident.severity === "High" ? "destructive" : "secondary"}>{incident.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
