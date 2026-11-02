import {describe,it,expect} from "vitest";
import {preflight} from "../index";
import {loadRegistry,selectModel} from "../model_registry";
import {telemetryFields} from "../policies";

const model={
 id:"test-model",provider:"local",providerModel:"test",
 enabled:true,productionReady:true,external:false,
 capabilities:["conversation","code_assistance","research"],
 classifications:["public","internal"],
 contextWindow:32768,maxOutputTokens:4000,priority:1,
 inputUsdPerMillion:0,outputUsdPerMillion:0,
};
const base={
 actor:{id:"user-1",tenantId:"tenant-1",role:"user",authenticated:true},
 request:{
  capability:"conversation",classification:"public",requestedOutputTokens:1000,
  inputTokens:1000,attachmentBytes:0,production:true,
 },
 registry:[model],
 policyContext:{
  externalProvider:false,protectedOperation:false,
  reviewerId:null,approvalValid:false,
 },
 options:{maxEstimatedUsd:0.1},
};

describe("00_META",()=>{
 it("allows an eligible conversation",()=>{
  expect(preflight(base)).toMatchObject({allowed:true,model:{id:"test-model"}});
 });
 it("denies unavailable search",()=>{
  expect(preflight({...base,request:{...base.request,capability:"live_search"}}))
   .toMatchObject({allowed:false,reasons:expect.arrayContaining(["CAPABILITY_OUT_OF_SCOPE"])})
 });
 it("denies restricted information",()=>{
  expect(preflight({...base,request:{...base.request,classification:"restricted"}}))
   .toMatchObject({allowed:false,reasons:expect.arrayContaining(["DATA_CLASSIFICATION_DENIED"])})
 });
 it("rejects a self-reviewed protected operation",()=>{
  expect(preflight({...base,policyContext:{
   externalProvider:false,protectedOperation:true,
   reviewerId:"user-1",approvalValid:true,
  }})).toMatchObject({allowed:false,reasons:expect.arrayContaining(["SELF_APPROVAL_DENIED"])})
 });
 it("denies guest attachment access",()=>{
  expect(preflight({...base,
   actor:{id:"guest-1",tenantId:null,role:"guest",authenticated:false},
   request:{...base.request,attachmentBytes:10},
  })).toMatchObject({allowed:false,reasons:expect.arrayContaining(["ATTACHMENT_LIMIT"])})
 });
 it("does not turn admin_control into a model call",()=>{
  expect(preflight({...base,actor:{...base.actor,role:"owner"},
   request:{...base.request,capability:"admin_control"},
  })).toEqual({allowed:false,reasons:["USE_ADMIN_SERVICE_AUTHORIZATION"]});
 });
 it("rejects duplicate registry identifiers",()=>{
  expect(()=>loadRegistry([model,model])).toThrow();
 });
 it("rejects unauthenticated elevated roles",()=>{
  expect(()=>preflight({...base,actor:{...base.actor,authenticated:false}})).toThrow();
 });
 it("does not route when context capacity is exceeded",()=>{
  const registry=loadRegistry([model]);
  expect(selectModel(registry,{
   capability:"conversation",classification:"public",
   inputTokens:32768,outputTokens:1,production:true,
   externalAllowed:true,maxEstimatedUsd:1,
  })).toEqual({ok:false,reasons:["NO_ELIGIBLE_MODEL"]});
 });
 it("redacts content from telemetry",()=>{
  const event=telemetryFields({
   actorId:"u",capability:"conversation",modelId:"m",input:"secret",output:"private",
  });
  expect(event).toEqual({actorId:"u",capability:"conversation",modelId:"m"});
 });
});
