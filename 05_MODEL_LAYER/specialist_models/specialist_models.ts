// ============================================================
// 05_MODEL_LAYER / SPECIALIST_MODELS
// File: lib/models/specialist_models.ts — SERVER ONLY
// ============================================================

import "server-only";
import { Model } from "../contracts";

export type Capability = "coding" | "extraction" | "translation";
export type Specialist = {
  id: string;
  modelId: string;
  capabilities: Capability[];
  adapter: Model;
  enabled: boolean;
};

export function createSpecialistRouter(
  registry: readonly Specialist[]
) {
  return async function run(
    capability: Capability,
    prompt: string,
    signal?: AbortSignal
  ) {
    const candidate = registry.find(item =>
      item.enabled && item.capabilities.includes(capability)
    );

    if (!candidate) {
      throw new Error("No verified specialist for " + capability);
    }

    return candidate.adapter.run({
      prompt,
      modelId: candidate.modelId,
      signal,
    });
  };
}

// Construct the registry on the server from an allowlist.
// Mark capabilities verified only after evaluation.
// Add quality/cost ranking if multiple specialists qualify.
