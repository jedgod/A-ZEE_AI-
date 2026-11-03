import { redirect } from "next/navigation";
import { pool } from "@/lib/admin/db";
import { currentStaff } from "@/lib/staff/auth";
import { OperationsApp } from "./operations-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations · AZ_AI" };

/** Staff and administrator workspace. The session and role are checked on the server. */
export default async function OperationsPage() {
  const staff = await currentStaff().catch(() => null);
  if (!staff || staff.mustChangePassword) redirect("/login?next=/operations");
  const team = (await pool.query("SELECT name FROM admin_tenants WHERE id = $1", [staff.tenantId])).rows[0]?.name ?? "Support desk";
  return <OperationsApp me={{ id: staff.id, name: staff.name, email: staff.email, role: staff.role }} team={team} />;
}
