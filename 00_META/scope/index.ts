import { z } from "zod";
import {
  capabilitySchema, type Capability, type Decision, decision,
} from "../shared";

const declarationSchema = z.object({
  enabled: z.boolean(),
  environments: z.array(z.enum(["development","production"])).min(1),
  boundary: z.string().min(10),
}).strict();
export const scopeSchema = z.record(capabilitySchema, declarationSchema)
  .superRefine((value, ctx) => {
    for (const key of capabilitySchema.options)
      if (!value[key])
        ctx.addIssue({code:"custom",message:"Missing capability scope: "+key});
  });

export const scope = scopeSchema.parse({
  conversation: {
    enabled:true, environments:["development","production"],
    boundary:"Provider-generated answers; verify important information.",
  },
  code_assistance: {
    enabled:true, environments:["development","production"],
    boundary:"Generate and explain code; no execution is implied.",
  },
  research: {
    enabled:true, environments:["development","production"],
    boundary:"Reason from supplied context; current web verification is unavailable.",
  },
  file_context: {
    enabled:true, environments:["development","production"],
    boundary:"Text-only attachments; no executable or binary processing.",
  },
  live_search: {
    enabled:false, environments:["development","production"],
    boundary:"Enabled only while a search adapter is configured (lib/search, TAVILY_API_KEY). Sources are untrusted; answers record them and verify quotes.",
  },
  code_execution: {
    enabled:false, environments:["development"],
    boundary:"Requires an isolated executor with resource and network controls.",
  },
  admin_control: {
    enabled:true, environments:["development","production"],
    boundary:"Existing authenticated admin services enforce tenant and role checks.",
  },
});

// Capabilities switched on at runtime only while their adapter is configured.
const runtimeEnabled: Partial<Record<Capability, () => boolean>> = {
  live_search: () => typeof process !== "undefined" && Boolean(process.env.TAVILY_API_KEY?.trim()),
};

export function checkScope(capability:Capability, production:boolean):Decision {
  const declaration = scope[capability];
  const reasons:string[] = [];
  if (!declaration?.enabled && !runtimeEnabled[capability]?.()) reasons.push("CAPABILITY_OUT_OF_SCOPE");
  const env = production ? "production" : "development";
  if (!declaration?.environments.includes(env))
    reasons.push("ENVIRONMENT_NOT_SUPPORTED");
  return decision(reasons);
}
