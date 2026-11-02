const approvals = [
  { title: "Enable model registry update", actor: "Ops", risk: "High" },
  { title: "Approve extension: analytics-pro", actor: "Security", risk: "Medium" },
  { title: "Release policy override", actor: "Compliance", risk: "High" },
];

export default function ApprovalsPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">APPROVALS</p>
        <h1 className="mt-2 text-3xl font-semibold">Workflow queue</h1>
      </header>

      <div className="space-y-4">
        {approvals.map((item) => (
          <div key={item.title} className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-lg font-medium">{item.title}</h2>
              <p className="text-sm text-muted-foreground">Requested by {item.actor}</p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">{item.risk}</span>
              <button className="rounded-md border bg-background px-3 py-2 text-sm">Review</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
