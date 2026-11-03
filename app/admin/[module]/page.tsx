import { notFound } from "next/navigation";
import { Approvals, Billing, Dashboard, Incidents, Policies, Registry, Roles, Tenants, Users } from "@/components/admin/sections";
import { consoleActor } from "@/lib/admin/console";

export const dynamic = "force-dynamic";

const SECTIONS = { dashboard: Dashboard, tenants: Tenants, users: Users, roles: Roles, approvals: Approvals, policies: Policies, registry: Registry, billing: Billing, incidents: Incidents };

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  return { title: `${module[0]?.toUpperCase()}${module.slice(1)} · Admin · AZ_AI` };
}

export default async function AdminModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!Object.hasOwn(SECTIONS, module)) notFound();
  const actor = await consoleActor();
  const Section = SECTIONS[module as keyof typeof SECTIONS];
  return <div className="mx-auto max-w-6xl"><Section actor={actor} /></div>;
}
