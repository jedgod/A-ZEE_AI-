const roleMatrix = [
  { role: "Owner", permissions: ["manage tenants", "approve policies", "billing access"] },
  { role: "Admin", permissions: ["user management", "approval actions", "extension toggles"] },
  { role: "Reviewer", permissions: ["view logs", "approve content", "reject changes"] },
  { role: "Operator", permissions: ["run workflows", "read metrics", "respond to incidents"] },
  { role: "Viewer", permissions: ["read dashboards", "audit exports", "limited reports"] },
];

export default function RolesPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">ROLES</p>
        <h1 className="mt-2 text-3xl font-semibold">Permission matrix</h1>
      </header>

      <div className="grid gap-4">
        {roleMatrix.map((row) => (
          <div key={row.role} className="rounded-xl border p-4">
            <h2 className="text-xl font-medium">{row.role}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {row.permissions.map((permission) => (
                <span key={permission} className="rounded-full bg-muted px-2 py-1 text-xs">{permission}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
