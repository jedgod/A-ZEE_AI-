const registry = [
  { name: "gpt-4o", version: "2024-08", approval: "Approved", owner: "Core ML" },
  { name: "gemini-1.5-pro", version: "2025-02", approval: "Pending", owner: "Research" },
  { name: "grok-3-beta", version: "2025-03", approval: "Restricted", owner: "Ops" },
];

export default function RegistryPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">REGISTRY</p>
        <h1 className="mt-2 text-3xl font-semibold">Model and version review</h1>
      </header>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3">Model</th>
              <th className="p-3">Version</th>
              <th className="p-3">Approval</th>
              <th className="p-3">Owner</th>
            </tr>
          </thead>
          <tbody>
            {registry.map((item) => (
              <tr key={item.name} className="border-t">
                <td className="p-3">{item.name}</td>
                <td className="p-3">{item.version}</td>
                <td className="p-3">{item.approval}</td>
                <td className="p-3">{item.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
