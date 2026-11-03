import { z } from "zod";
import { actorSchema,requestSchema } from "./shared";
import { checkScope } from "./scope";
import { authorizeCapability } from "./capability_matrix";
import {
  evaluatePolicy,defaultPolicy,policySchema,type PolicyContext,
} from "./policies";
import {
  loadRegistry,selectModel,type ModelDefinition,
} from "./model_registry";

export {mission,getProductIdentity} from "./mission";
export {scope,checkScope} from "./scope";
export {capabilityMatrix,authorizeCapability} from "./capability_matrix";
export {defaultPolicy,evaluatePolicy,telemetryFields} from "./policies";
export {loadRegistry,selectModel,estimatedCost} from "./model_registry";
export * from "./shared";

const optionsSchema=z.object({
  maxEstimatedUsd:z.number().finite().min(0).max(100),
  preferredModelId:z.string().min(1).max(100).optional(),
}).strict();

export type PreflightResult=
 | {allowed:false;reasons:readonly string[]}
 | {allowed:true;reasons:readonly [];model:ModelDefinition;estimatedUsd:number};

export function preflight(input:{
  actor:unknown;request:unknown;
  policyContext:PolicyContext;
  registry:unknown;
  policy?:unknown;
  options:unknown;
}):PreflightResult {
  const actor=actorSchema.parse(input.actor);
  const request=requestSchema.parse(input.request);
  const options=optionsSchema.parse(input.options);
  const policy=policySchema.parse(input.policy??defaultPolicy);
  const registry=loadRegistry(input.registry);

  const checks=[
    checkScope(request.capability,request.production),
    // Attachment size is authorized under file_context below. Passing it here too meant every
    // attachment failed conversation's own 0-byte attachment allowance.
    authorizeCapability(actor,request.capability,request.inputTokens,
      request.requestedOutputTokens,request.capability==="file_context"?request.attachmentBytes:0),
    evaluatePolicy(actor,request,input.policyContext,policy),
  ];

  // Attachments require their own grant as well as the requested operation.
  if(request.attachmentBytes>0) {
    checks.push(checkScope("file_context",request.production));
    checks.push(authorizeCapability(actor,"file_context",request.inputTokens,
      request.requestedOutputTokens,request.attachmentBytes));
  }
  const reasons=[...new Set(checks.flatMap(c=>c.reasons))];
  if(reasons.length)return {allowed:false,reasons};

  if(request.capability==="admin_control") {
    // Control-plane operations are not routed to language models.
    return {allowed:false,reasons:["USE_ADMIN_SERVICE_AUTHORIZATION"]};
  }

  const routed=selectModel(registry,{
    capability:request.capability,classification:request.classification,
    inputTokens:request.inputTokens,outputTokens:request.requestedOutputTokens,
    production:request.production,
    externalAllowed:policy.allowExternalProviders,
    ...options,
  });
  if(!routed.ok)return {allowed:false,reasons:routed.reasons};

  // Re-evaluate policy with the selected provider, not a caller's guess.
  const providerDecision=evaluatePolicy(actor,request,{
    ...input.policyContext,externalProvider:routed.model.external,
  },policy);
  if(!providerDecision.allowed)
    return {allowed:false,reasons:providerDecision.reasons};

  return {allowed:true,reasons:[],model:routed.model,estimatedUsd:routed.estimatedUsd};
}
