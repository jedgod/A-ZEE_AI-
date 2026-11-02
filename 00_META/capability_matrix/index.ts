import { z } from "zod";
import {
  roleSchema, capabilitySchema, type Actor, type Capability,
  type Decision, decision,
} from "../shared";

const ruleSchema = z.object({
  roles:z.array(roleSchema).min(1),
  authenticationRequired:z.boolean(),
  tenantRequired:z.boolean(),
  maxInputTokens:z.number().int().positive(),
  maxOutputTokens:z.number().int().positive(),
  maxAttachmentBytes:z.number().int().nonnegative(),
}).strict();
export const matrixSchema = z.record(capabilitySchema, ruleSchema)
  .superRefine((matrix,ctx)=>{
    for(const key of capabilitySchema.options)
      if(!matrix[key])
        ctx.addIssue({code:"custom",message:"Missing matrix entry: "+key});
  });
const signedIn = ["user","operator","reviewer","admin","owner"] as const;
const normal = {
  roles:["guest",...signedIn],
  authenticationRequired:false,tenantRequired:false,
  maxInputTokens:12000,maxOutputTokens:2000,maxAttachmentBytes:0,
};
export const capabilityMatrix = matrixSchema.parse({
  conversation:normal,
  research:{...normal,roles:[...signedIn],authenticationRequired:true},
  code_assistance:{...normal,maxInputTokens:24000,maxOutputTokens:4000},
  file_context:{
    ...normal,roles:[...signedIn],authenticationRequired:true,
    maxAttachmentBytes:65536,
  },
  live_search:{...normal,roles:[...signedIn],authenticationRequired:true},
  code_execution:{
    ...normal,roles:["operator","admin","owner"],
    authenticationRequired:true,tenantRequired:true,
  },
  admin_control:{
    ...normal,roles:["admin","owner"],authenticationRequired:true,
    tenantRequired:true,
  },
});

export function authorizeCapability(
  actor:Actor, capability:Capability,
  inputTokens:number, outputTokens:number, attachmentBytes:number,
):Decision {
  const rule = capabilityMatrix[capability];
  const reasons:string[] = [];
  if(!rule) return decision(["CAPABILITY_UNREGISTERED"]);
  if(!rule.roles.includes(actor.role)) reasons.push("ROLE_NOT_PERMITTED");
  if(rule.authenticationRequired && !actor.authenticated)
    reasons.push("AUTHENTICATION_REQUIRED");
  if(rule.tenantRequired && !actor.tenantId)
    reasons.push("TENANT_REQUIRED");
  if(inputTokens > rule.maxInputTokens) reasons.push("INPUT_TOKEN_LIMIT");
  if(outputTokens > rule.maxOutputTokens) reasons.push("OUTPUT_TOKEN_LIMIT");
  if(attachmentBytes > rule.maxAttachmentBytes) reasons.push("ATTACHMENT_LIMIT");
  return decision(reasons);
}
