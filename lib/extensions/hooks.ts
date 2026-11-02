// ============================================================
// 15_EXTENSIONS / HOOK EXECUTION
// ============================================================
import "server-only";
import { z } from "zod";
import { performance } from "node:perf_hooks";
import type { Actor, HookData } from "./contracts";
import type { Hook } from "./manifest";
import { registry } from "./registry";
import { installations } from "./repository";
import { authorize, projectData } from "./permissions";
import { audit } from "./audit";

const outputSchema = z.object({
  metadata: z.record(z.union([
    z.string().max(200), z.number().finite(), z.boolean(),
  ])),
}).strict();

export async function runHooks(
  actor: Actor, hook: Hook, data: HookData,
  parentSignal?: AbortSignal
) {
  if (!actor.userId || !actor.tenantId) throw new Error("Unauthorized");
  if ((data.context?.length ?? 0) > 100000 ||
      (data.output?.length ?? 0) > 100000) {
    throw new Error("Hook payload too large");
  }
  const results: Record<string, unknown> = {};
  for (const install of await installations(actor.tenantId)) {
    if (!install.enabled) continue;
    const start = performance.now();
    try {
    const extension = registry.get(install.id);
    const manifest = extension.manifest;
    if (!manifest.hooks.includes(hook)) continue;
    if (manifest.version !== install.version) {
      throw new Error("Extension update requires reapproval");
    }
    authorize(actor, manifest.permissions, install.grants);
    const timeout = AbortSignal.timeout(3000);
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, timeout]) : timeout;
      signal.throwIfAborted();
      const result = outputSchema.parse(await extension.execute({
        hook, data: projectData(manifest.permissions, data), signal,
      }));
      signal.throwIfAborted();
      if (Object.keys(result.metadata).length > 20) {
        throw new Error("Too many metadata fields");
      }
      if (!manifest.permissions.includes("write_metadata") &&
          Object.keys(result.metadata).length) {
        throw new Error("Unauthorized metadata write");
      }
      // Namespace output; it cannot overwrite core pipeline fields.
      results[manifest.id] = result.metadata;
      await audit({
        tenantId: actor.tenantId, actorId: actor.userId,
        extensionId: manifest.id, event: "execution",
        status: "success", durationMs: performance.now() - start,
      });
    } catch (error) {
      await audit({
        tenantId: actor.tenantId, actorId: actor.userId,
        extensionId: install.id, event: "execution",
        status: "failure", durationMs: performance.now() - start,
      });
      throw error; // Fail closed; caller handles the pipeline failure.
    }
  }
  return results;
}

// Cooperative deadline only: built-ins must honor AbortSignal.
// An in-process extension can still access process resources.
// Untrusted packages require isolated execution, not this runtime.
