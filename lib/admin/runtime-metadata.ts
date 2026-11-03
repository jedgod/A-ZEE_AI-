import type { PolicyContext } from "@/00_META/policies";
import { preflight, type PreflightResult } from "@/00_META";

const DEFAULT_REGISTRY = [
  {
    id: "local-runtime-model",
    provider: "local",
    providerModel: "runtime-model",
    enabled: true,
    productionReady: true,
    external: false,
    capabilities: ["conversation", "code_assistance", "research"],
    classifications: ["public", "internal"],
    contextWindow: 32768,
    maxOutputTokens: 4096,
    priority: 1,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
  },
] as const;

export type MetadataBridgeInput = {
  actor?: unknown;
  request?: unknown;
  policyContext?: PolicyContext;
  registry?: unknown;
  policy?: unknown;
  options?: unknown;
};

export function normalizeRuntimeRole(role: string): "guest" | "user" | "operator" | "reviewer" | "admin" | "owner" {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "reviewer":
      return "reviewer";
    case "operator":
      return "operator";
    case "viewer":
    case "user":
      return "user";
    default:
      return "guest";
  }
}

export function evaluateRuntimeMetadata(
  input: MetadataBridgeInput = {},
): PreflightResult {
  const actor = (input.actor ?? {
    id: "system",
    tenantId: "system",
    role: "user",
    authenticated: true,
  }) as {
    id?: string;
    tenantId?: string | null;
    role?: string;
    authenticated?: boolean;
  };

  return preflight({
    actor: {
      id: actor.id ?? "system",
      tenantId: actor.tenantId ?? "system",
      role: normalizeRuntimeRole(String(actor.role ?? "user")),
      authenticated: actor.authenticated ?? true,
    },
    request:
      input.request ?? {
        capability: "conversation",
        classification: "public",
        requestedOutputTokens: 1024,
        inputTokens: 1024,
        attachmentBytes: 0,
        production: true,
      },
    policyContext:
      input.policyContext ?? {
        externalProvider: false,
        protectedOperation: false,
        reviewerId: null,
        approvalValid: false,
      },
    registry: input.registry ?? DEFAULT_REGISTRY,
    policy: input.policy,
    options:
      input.options ?? {
        maxEstimatedUsd: 0.1,
      },
  });
}
