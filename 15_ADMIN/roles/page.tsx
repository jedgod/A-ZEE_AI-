// ============================================================
// 15_ADMIN / ROLES — PRODUCTION VIEW
// Mounted at /admin/roles (app/admin/[module]/page.tsx); admin sign-in required.
// The mock layout that was here (hard-coded sample rows) now renders real tenant data and
// controls: components/admin/sections.tsx, backed by lib/admin/console.ts and /api/admin.
// ============================================================

import { Roles } from "@/components/admin/sections";

export default function Page() {
  return <Roles />;
}
