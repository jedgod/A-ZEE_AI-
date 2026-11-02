import React, { type ReactNode } from "react";
import Link from "next/link";
import { requireHostActor } from "@/lib/admin/host-auth";

const modules = [
  "dashboard",
  "tenants",
  "users",
  "roles",
  "approvals",
  "policies",
  "registry",
  "billing",
  "incidents",
];

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireHostActor();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-r bg-muted/30 p-6">
        <div className="mb-8">
          <p className="text-sm font-semibold">AZ_AI / Admin</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tenant: {actor.tenantId}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Role: {actor.role}
          </p>
        </div>

        <nav aria-label="Administration" className="flex flex-col gap-2">
          {modules.map((module) => (
            <Link
              key={module}
              href={`/admin/${module}`}
              className="rounded px-3 py-2 text-sm hover:bg-muted"
            >
              {module}
            </Link>
          ))}
        </nav>
      </aside>

      <section className="min-w-0">{children}</section>
    </div>
  );
}
