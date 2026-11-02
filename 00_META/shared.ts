import { z } from "zod";

export const roleSchema = z.enum([
  "guest", "user", "operator", "reviewer", "admin", "owner",
]);
export const capabilitySchema = z.enum([
  "conversation", "code_assistance", "research",
  "live_search", "file_context", "code_execution", "admin_control",
]);
export const classificationSchema = z.enum([
  "public", "internal", "confidential", "restricted",
]);
export type Role = z.infer<typeof roleSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Classification = z.infer<typeof classificationSchema>;

export const actorSchema = z.object({
  id: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200).nullable(),
  role: roleSchema,
  authenticated: z.boolean(),
}).strict().superRefine((a, ctx) => {
  if (!a.authenticated && a.role !== "guest")
    ctx.addIssue({code:"custom",message:"Unauthenticated actor must be guest"});
  if (a.authenticated && a.role === "guest")
    ctx.addIssue({code:"custom",message:"Authenticated actor cannot be guest"});
});
export type Actor = z.infer<typeof actorSchema>;

export const requestSchema = z.object({
  capability: capabilitySchema,
  classification: classificationSchema,
  requestedOutputTokens: z.number().int().min(1).max(32768),
  inputTokens: z.number().int().min(1).max(1000000),
  attachmentBytes: z.number().int().min(0).max(100000000),
  production: z.boolean(),
}).strict();
export type MetaRequest = z.infer<typeof requestSchema>;

export type Decision = {
  allowed: boolean;
  reasons: readonly string[];
};
export function decision(reasons: string[]): Decision {
  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}
