import { z } from "zod";
import {
  classificationSchema, type Actor, type MetaRequest,
  type Decision, decision,
} from "../shared";

export const policySchema = z.object({
  version:z.string().regex(/^\d+\.\d+\.\d+$/),
  allowedClassifications:z.array(classificationSchema).min(1),
  retentionDays:z.number().int().min(1).max(365),
  allowExternalProviders:z.boolean(),
  redactTelemetryContent:z.boolean(),
  independentReviewRequired:z.boolean(),
}).strict();

export const defaultPolicy = Object.freeze(policySchema.parse({
  version:"1.0.0",
  allowedClassifications:["public","internal"],
  retentionDays:30,
  allowExternalProviders:true,
  redactTelemetryContent:true,
  independentReviewRequired:true,
}));
export type Policy = z.infer<typeof policySchema>;
export type PolicyContext = {
  // These must be resolved by server services, NOT from browser JSON.
  externalProvider:boolean;
  protectedOperation:boolean;
  reviewerId:string|null;
  approvalValid:boolean;
};

export function evaluatePolicy(
  actor:Actor, request:MetaRequest, context:PolicyContext,
  rawPolicy:unknown = defaultPolicy,
):Decision {
  const policy = policySchema.parse(rawPolicy);
  const reasons:string[]=[];
  if(!policy.allowedClassifications.includes(request.classification))
    reasons.push("DATA_CLASSIFICATION_DENIED");
  if(context.externalProvider && !policy.allowExternalProviders)
    reasons.push("EXTERNAL_PROVIDER_DENIED");
  if(request.classification !== "public" && !actor.authenticated)
    reasons.push("AUTHENTICATION_REQUIRED_FOR_DATA");
  if(context.protectedOperation && policy.independentReviewRequired) {
    if(!context.approvalValid || !context.reviewerId)
      reasons.push("INDEPENDENT_APPROVAL_REQUIRED");
    if(context.reviewerId === actor.id)
      reasons.push("SELF_APPROVAL_DENIED");
  }
  return decision(reasons);
}

export function telemetryFields(event:{
  actorId:string; capability:string; modelId:string; input?:string; output?:string;
}) {
  // Deliberately omit prompts, responses, credentials and attachments.
  return {
    actorId:event.actorId,capability:event.capability,modelId:event.modelId,
  };
}
