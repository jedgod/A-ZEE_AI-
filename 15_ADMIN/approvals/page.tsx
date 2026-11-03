// ============================================================
// 15_ADMIN / APPROVALS — PRODUCTION VIEW
// Mounted at /admin/approvals (app/admin/[module]/page.tsx); admin sign-in required.
// The mock layout that was here (hard-coded sample rows) now renders real tenant data and
// controls: components/admin/sections.tsx, backed by lib/admin/console.ts and /api/admin.
// ============================================================

import { Approvals } from "@/components/admin/sections";
import { consoleActor } from "@/lib/admin/console";

export default async function Page() {
  const actor = await consoleActor();
  return <Approvals actor={actor} />;
}
