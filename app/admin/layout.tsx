import React, { type ReactNode } from "react";
import Link from "next/link";
import { requireHostActor } from "@/lib/admin/host-auth";

const ADMIN_SECTIONS = [
  ["dashboard", "Dashboard"],
  ["tenants", "Tenants"],
  ["users", "Users"],
  ["roles", "Roles"],
  ["approvals", "Approvals"],
  ["policies", "Policies"],
  ["registry", "Registry"],
  ["billing", "Billing"],
  ["incidents", "Incidents"],
  ["pipeline", "Pipeline stages"],
] as const;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireHostActor();

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-r bg-muted/30 p-6">
        <div className="mb-8">
          <p className="text-sm font-semibold">AZ_AI / Admin</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={actor.tenantId}>
            Tenant: {actor.tenantId.slice(0, 8)}
          </p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">
            Role: {actor.role}
          </p>
        </div>

        <nav aria-label="Administration" className="flex flex-col gap-1">
          {ADMIN_SECTIONS.map(([module, label]) => (
            <Link
              key={module}
              href={`/admin/${module}`}
              className="rounded px-3 py-2 text-sm hover:bg-muted"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-8 flex flex-col gap-1 border-t pt-4 text-sm">
          <Link href="/operations" className="rounded px-3 py-2 hover:bg-muted">← Operations</Link>
          <Link href="/insights" className="rounded px-3 py-2 hover:bg-muted">Pipeline insights</Link>
        </div>
      </aside>

      <section className="min-w-0 p-6 md:p-8">{children}</section>
    </div>
  );
}
