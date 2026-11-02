// ============================================================
// 15_EXTENSIONS / PLUGINS / OUTPUT STATS
// ============================================================
import type { Extension } from "../contracts";

export const outputStats: Extension = {
  manifest: {
    id: "output-stats",
    name: "Output statistics",
    version: "1.0.0",
    apiVersion: "1",
    kind: "hook",
    description: "Records output length without storing content.",
    permissions: ["read_output", "write_metadata"],
    hooks: ["after_model_call"],
  },
  async execute({ data, signal }) {
    signal.throwIfAborted();
    return {
      metadata: { outputCharacters: data.output?.length ?? 0 },
    };
  },
};
