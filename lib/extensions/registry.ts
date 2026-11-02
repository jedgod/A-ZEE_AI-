// ============================================================
// 15_EXTENSIONS / STATIC REGISTRY
// ============================================================
import "server-only";
import { manifestSchema } from "./manifest";
import type { Extension } from "./contracts";
import { outputStats } from "./plugins/output-stats";

function defineRegistry(extensions: readonly Extension[]) {
  const entries = new Map<string, Extension>();
  for (const extension of extensions) {
    manifestSchema.parse(extension.manifest);
    if (entries.has(extension.manifest.id)) {
      throw new Error("Duplicate extension ID");
    }
    entries.set(extension.manifest.id, extension);
  }
  return {
    list: () => [...entries.values()].map(e => e.manifest),
    get: (id: string) => {
      const extension = entries.get(id);
      if (!extension) throw new Error("Unknown extension");
      return extension;
    },
  };
}

export const registry = defineRegistry([outputStats]);

// Add reviewed static imports here. No eval, require(path),
// client entrypoints, or arbitrary dynamic imports.
// Package signing alone does not establish code safety.
