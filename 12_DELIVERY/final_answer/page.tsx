// ============================================================
// 12_DELIVERY / FINAL_ANSWER — PRODUCTION VIEW
// Mounted at /admin/pipeline/12-final_answer (app/admin/pipeline/[slug]/page.tsx); admin sign-in required.
// Replaces the standalone demo form that posted JSON to /api/operations/final_answer, a route that never existed.
// The production page shows this module's real status in the app, its live configuration or
// recent metadata, and, for deterministic modules, a dry run of the real module (no AI call,
// nothing stored). Its catalog entry is in lib/admin/pipeline-catalog.ts.
// ============================================================

import { PipelineModulePage } from "@/components/admin/pipeline-module";

export default function Page() {
  return <PipelineModulePage slug="12-final_answer" />;
}
