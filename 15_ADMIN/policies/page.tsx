const policies = [
  { name: "PII redaction", scope: "All tenants", status: "Enforced" },
  { name: "Model compatibility", scope: "Production", status: "Review" },
  { name: "Extension permissions", scope: "Tenant-scoped", status: "Enforced" },
];

export default function PoliciesPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">POLICIES</p>
        <h1 className="mt-2 text-3xl font-semibold">Policy center</h1>
      </header>

      <div className="space-y-4">
        {policies.map((policy) => (
          <div key={policy.name} className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-medium">{policy.name}</h2>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">{policy.status}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Scope: {policy.scope}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
