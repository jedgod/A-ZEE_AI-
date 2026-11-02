import { Badge } from "@/components/ui/badge";

const tenants = [
  { name: "Northwind Labs", owner: "A. Ortega", plan: "Enterprise", status: "Active" },
  { name: "Cedar Health", owner: "M. Shah", plan: "Team", status: "Review" },
  { name: "Qubit Works", owner: "R. Green", plan: "Pro", status: "Active" },
];

export default function TenantsPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">TENANTS</p>
        <h1 className="mt-2 text-3xl font-semibold">Workspace control</h1>
      </header>

      <div className="space-y-4">
        {tenants.map((tenant) => (
          <div key={tenant.name} className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-medium">{tenant.name}</h2>
              <p className="text-sm text-muted-foreground">Owner: {tenant.owner}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">{tenant.plan}</Badge>
              <Badge variant={tenant.status === "Active" ? "default" : "secondary"}>{tenant.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
