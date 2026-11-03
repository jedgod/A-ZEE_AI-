// Provider selection, dispatch, and fallback now live in the stage folders:
// 00_META (preflight + registry), 04_ROUTING (selection + fallback), 05_MODEL_LAYER (branches),
// wired together in lib/pipeline (registry.ts, index.ts). This module keeps the error type
// the API routes map to HTTP responses.

export class ProviderError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
