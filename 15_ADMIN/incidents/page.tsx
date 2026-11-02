const incidents = [
  { id: "INC-2041", title: "AI policy block spike", status: "Investigating" },
  { id: "INC-2029", title: "Latency regression in production", status: "Mitigated" },
  { id: "INC-2015", title: "Tenant approval queue backlog", status: "Open" },
];

export default function IncidentsPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">INCIDENTS</p>
        <h1 className="mt-2 text-3xl font-semibold">Operational response</h1>
      </header>

      <div className="space-y-4">
        {incidents.map((incident) => (
          <div key={incident.id} className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <p className="font-medium">{incident.id}</p>
              <p className="text-sm text-muted-foreground">{incident.title}</p>
            </div>
            <span className="rounded-full bg-muted px-2 py-1 text-xs">{incident.status}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
