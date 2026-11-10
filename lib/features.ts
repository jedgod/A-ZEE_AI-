// Feature flags and readiness for the A-Zee platform capabilities.
//
// Readiness is stated, never inferred from a demo:
//   planned                – not built yet; always off
//   implemented            – code exists, not yet verified end to end here
//   locally_tested         – functional and its automated tests pass on this machine
//   infrastructure_blocked – needs infrastructure that isn't available (said which)
//   production_ready       – only after the release acceptance criteria are met (none yet)
// Experimental features can be switched off with AZ_FEATURE_<NAME>=off.

export type Readiness = "planned" | "implemented" | "locally_tested" | "infrastructure_blocked" | "production_ready";
export type FeatureName = "connectors" | "codeAgent" | "codeExecution" | "searchIndex" | "vectorSearch" | "voice" | "cloudIde" | "ideTerminal";

type Definition = { label: string; readiness: Readiness; experimental: boolean; env: string; blockedBy?: string };

export const FEATURES: Record<FeatureName, Definition> = {
  connectors: { label: "Gmail, Google Drive and GitHub connectors", readiness: "locally_tested", experimental: true, env: "AZ_FEATURE_CONNECTORS" },
  codeAgent: { label: "AI Code Agent (inspect, patch, review, rollback)", readiness: "locally_tested", experimental: true, env: "AZ_FEATURE_CODE_AGENT" },
  codeExecution: { label: "Sandboxed code execution", readiness: "infrastructure_blocked", experimental: true, env: "AZ_FEATURE_CODE_EXECUTION", blockedBy: "No container runtime (Docker) or remote sandbox service is configured." },
  searchIndex: { label: "A-Zee Search Index (PostgreSQL full-text)", readiness: "locally_tested", experimental: true, env: "AZ_FEATURE_SEARCH_INDEX" },
  vectorSearch: { label: "Vector search (pgvector)", readiness: "infrastructure_blocked", experimental: true, env: "AZ_FEATURE_VECTOR_SEARCH", blockedBy: "The pgvector extension isn't installed in this PostgreSQL server, and no embedding provider is configured." },
  voice: { label: "Voice AI (browser speech)", readiness: "planned", experimental: true, env: "AZ_FEATURE_VOICE" },
  cloudIde: { label: "Cloud IDE (editor, files, Git panel, agent, previews)", readiness: "planned", experimental: true, env: "AZ_FEATURE_CLOUD_IDE" },
  ideTerminal: { label: "IDE terminal sessions", readiness: "infrastructure_blocked", experimental: true, env: "AZ_FEATURE_IDE_TERMINAL", blockedBy: "Needs an isolated execution environment and a WebSocket terminal service." },
};

/** Off when AZ_FEATURE_<NAME>=off, and always off while planned or infrastructure-blocked. */
export function featureEnabled(name: FeatureName, env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {}): boolean {
  if (name === "connectors" && env.AZ_PROVIDER_MODE === "ollama-only") return false;
  const def = FEATURES[name];
  if (def.readiness === "planned" || def.readiness === "infrastructure_blocked") return false;
  return (env[def.env] ?? "on").toLowerCase() !== "off";
}

export const READINESS_LABEL: Record<Readiness, string> = {
  planned: "Planned", implemented: "Implemented", locally_tested: "Locally tested", infrastructure_blocked: "Infrastructure blocked", production_ready: "Production ready",
};
