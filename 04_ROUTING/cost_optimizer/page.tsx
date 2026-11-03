// ============================================================
// 04_ROUTING / COST_OPTIMIZER — PRODUCTION VIEW
// Mounted at /admin/pipeline/04-cost_optimizer (app/admin/pipeline/[slug]/page.tsx); admin sign-in required.
// Replaces the standalone demo form that posted JSON to /api/routing/cost_optimizer, a route that never existed.
// The production page shows this module's real status in the app, its live configuration or
// recent metadata, and, for deterministic modules, a dry run of the real module (no AI call,
// nothing stored). Its catalog entry is in lib/admin/pipeline-catalog.ts.
// ============================================================

import { PipelineModulePage } from "@/components/admin/pipeline-module";

export default function Page() {
  return <PipelineModulePage slug="04-cost_optimizer" />;
}
