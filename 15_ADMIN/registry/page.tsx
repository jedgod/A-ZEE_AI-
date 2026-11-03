// ============================================================
// 15_ADMIN / REGISTRY — PRODUCTION VIEW
// Mounted at /admin/registry (app/admin/[module]/page.tsx); admin sign-in required.
// The mock layout that was here (hard-coded sample rows) now renders real tenant data and
// controls: components/admin/sections.tsx, backed by lib/admin/console.ts and /api/admin.
// ============================================================

import { Registry } from "@/components/admin/sections";
import { consoleActor } from "@/lib/admin/console";

export default async function Page() {
  const actor = await consoleActor();
  return <Registry actor={actor} />;
}
