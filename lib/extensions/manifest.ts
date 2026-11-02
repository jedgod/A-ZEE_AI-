// ============================================================
// 15_EXTENSIONS / MANIFESTS
// ============================================================
import { z } from "zod";

export const permissionSchema = z.enum([
  "read_context", "read_output", "write_metadata"
]);
export const hookSchema = z.enum([
  "after_preprocess", "after_model_call", "before_delivery"
]);
export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  apiVersion: z.literal("1"),
  kind: z.enum(["adapter", "plugin", "capability", "policy", "hook"]),
  description: z.string().max(1000),
  permissions: z.array(permissionSchema).max(3),
  hooks: z.array(hookSchema).max(3),
}).strict();

export type Manifest = z.infer<typeof manifestSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type Hook = z.infer<typeof hookSchema>;
