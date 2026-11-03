// ============================================================
// 05_MODEL_LAYER / SPECIALIST_MODELS — PRODUCTION VIEW
// Mounted at /admin/pipeline/05-specialist_models (app/admin/pipeline/[slug]/page.tsx); admin sign-in required.
// Replaces the standalone demo form that posted JSON to /api/model-layer/specialist_models, a route that never existed.
// The production page shows this module's real status in the app, its live configuration or
// recent metadata, and, for deterministic modules, a dry run of the real module (no AI call,
// nothing stored). Its catalog entry is in lib/admin/pipeline-catalog.ts.
// ============================================================

import { PipelineModulePage } from "@/components/admin/pipeline-module";

export default function Page() {
  return <PipelineModulePage slug="05-specialist_models" />;
}
