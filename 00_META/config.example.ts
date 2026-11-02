import {loadRegistry} from "./model_registry";

// Example only: replace providerModel, prices and limits with verified data.
// Disabled until reviewed. No credentials belong in this file.
export const configuredModels=loadRegistry([
 {
  id:"primary-chat",
  provider:"openai-compatible",
  providerModel:"REPLACE_WITH_CONFIGURED_PROVIDER_MODEL",
  enabled:false,
  productionReady:false,
  external:true,
  capabilities:["conversation","code_assistance","research"],
  classifications:["public","internal"],
  contextWindow:32768,
  maxOutputTokens:4000,
  priority:10,
  inputUsdPerMillion:1,
  outputUsdPerMillion:4,
 },
]);
