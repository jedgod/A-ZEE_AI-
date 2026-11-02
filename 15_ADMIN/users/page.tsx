const users = [
  { name: "Alicia Brooks", role: "Owner", tenant: "Northwind Labs", sessions: 8 },
  { name: "Daniel Lee", role: "Admin", tenant: "Cedar Health", sessions: 5 },
  { name: "Priya Nair", role: "Reviewer", tenant: "Qubit Works", sessions: 3 },
];

export default function UsersPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6 border-b pb-4">
        <p className="font-mono text-xs text-muted-foreground">USERS</p>
        <h1 className="mt-2 text-3xl font-semibold">Access registry</h1>
      </header>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3">Person</th>
              <th className="p-3">Role</th>
              <th className="p-3">Tenant</th>
              <th className="p-3">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.name} className="border-t">
                <td className="p-3">{user.name}</td>
                <td className="p-3">{user.role}</td>
                <td className="p-3">{user.tenant}</td>
                <td className="p-3">{user.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
