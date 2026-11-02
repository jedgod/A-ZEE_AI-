// ============================================================
// 15_EXTENSIONS / PERMISSIONS
// ============================================================
import type { Actor, HookData } from "./contracts";
import type { Permission } from "./manifest";

export function authorize(
  actor: Actor,
  required: readonly Permission[],
  granted: readonly Permission[]
) {
  if (!actor.userId || !actor.tenantId) throw new Error("Unauthorized");
  for (const permission of required) {
    if (!granted.includes(permission) ||
        !actor.permissions.has("extensions:" + permission)) {
      throw new Error("Extension permission denied");
    }
  }
}

export function projectData(
  required: readonly Permission[], input: HookData
): HookData {
  return Object.freeze({
    ...(required.includes("read_context") ? { context: input.context } : {}),
    ...(required.includes("read_output") ? { output: input.output } : {}),
  });
}

// Actor and grants come exclusively from authenticated server state.
// read_context/read_output may expose personal data;
// grant them only for approved purposes and reviewed code.
