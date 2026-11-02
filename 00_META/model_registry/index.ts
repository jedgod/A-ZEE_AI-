import { z } from "zod";
import {
  capabilitySchema, classificationSchema,
  type Capability, type Classification,
} from "../shared";

export const modelSchema = z.object({
  id:z.string().regex(/^[a-z0-9][a-z0-9._-]{1,99}$/),
  provider:z.enum(["openai-compatible","local"]),
  providerModel:z.string().min(1).max(200),
  enabled:z.boolean(),
  productionReady:z.boolean(),
  external:z.boolean(),
  capabilities:z.array(capabilitySchema).min(1),
  classifications:z.array(classificationSchema).min(1),
  contextWindow:z.number().int().min(1024),
  maxOutputTokens:z.number().int().positive(),
  priority:z.number().int().min(0).max(1000),
  inputUsdPerMillion:z.number().finite().nonnegative(),
  outputUsdPerMillion:z.number().finite().nonnegative(),
}).strict().superRefine((m,ctx)=>{
  if(m.maxOutputTokens >= m.contextWindow)
    ctx.addIssue({code:"custom",message:"Output must be smaller than context window"});
  if(m.provider === "local" && m.external)
    ctx.addIssue({code:"custom",message:"Local provider cannot be external"});
});
export const registrySchema = z.array(modelSchema).superRefine((models,ctx)=>{
  const seen=new Set<string>();
  for(const model of models) {
    if(seen.has(model.id))
      ctx.addIssue({code:"custom",message:"Duplicate model id: "+model.id});
    seen.add(model.id);
  }
});
export type ModelDefinition=z.infer<typeof modelSchema>;

export type RoutingRequest={
  capability:Capability;
  classification:Classification;
  inputTokens:number;
  outputTokens:number;
  production:boolean;
  externalAllowed:boolean;
  maxEstimatedUsd:number;
  preferredModelId?:string;
};
export type ModelSelection =
  | {ok:true; model:ModelDefinition; estimatedUsd:number}
  | {ok:false; reasons:readonly string[]};

export function estimatedCost(
  model:ModelDefinition,inputTokens:number,outputTokens:number,
) {
  return (inputTokens*model.inputUsdPerMillion +
    outputTokens*model.outputUsdPerMillion)/1000000;
}

export function loadRegistry(raw:unknown):readonly ModelDefinition[] {
  return registrySchema.parse(raw);
}

export function selectModel(
  registry:readonly ModelDefinition[], r:RoutingRequest,
):ModelSelection {
  const candidates=registry.filter(m =>
    m.enabled &&
    (!r.production || m.productionReady) &&
    (!m.external || r.externalAllowed) &&
    m.capabilities.includes(r.capability) &&
    m.classifications.includes(r.classification) &&
    r.inputTokens+r.outputTokens <= m.contextWindow &&
    r.outputTokens <= m.maxOutputTokens &&
    estimatedCost(m,r.inputTokens,r.outputTokens) <= r.maxEstimatedUsd &&
    (!r.preferredModelId || m.id===r.preferredModelId)
  );
  candidates.sort((a,b)=>
    a.priority-b.priority ||
    estimatedCost(a,r.inputTokens,r.outputTokens) -
      estimatedCost(b,r.inputTokens,r.outputTokens) ||
    a.id.localeCompare(b.id)
  );
  if(!candidates[0])return {
    ok:false,reasons:["NO_ELIGIBLE_MODEL"],
  };
  const model=candidates[0];
  return {ok:true,model,estimatedUsd:estimatedCost(model,r.inputTokens,r.outputTokens)};
}
// Costs are estimates, not a billing ledger or an atomic spend reservation.
// Declare only capabilities actually implemented by the provider adapter.
