import Link from "next/link";

export default function AdminIndexPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Administration
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900">
          15_ADMIN / Control Plane
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Tenant operations, policy enforcement, access governance, and platform configuration live here.
        </p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white hover:bg-slate-700" href="/admin/dashboard">
            Open dashboard
          </Link>
          <Link className="rounded-lg border border-slate-200 bg-white px-5 py-3 font-medium text-slate-700 hover:bg-slate-50" href="/admin/tenants">
            Manage tenants
          </Link>
        </div>
      </div>
    </main>
  );
}
