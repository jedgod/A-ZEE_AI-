// Shared server-side egress policy. Network isolation is still a deployment duty.
export const ollamaOnly = () => process.env.AZ_PROVIDER_MODE === "ollama-only";

export function requireCloudInferenceAllowed() {
  if (ollamaOnly()) throw new Error("EXTERNAL_AI_DISABLED");
}
