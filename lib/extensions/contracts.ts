// ============================================================
// 15_EXTENSIONS / ADAPTER CONTRACT
// ============================================================
import type { Manifest, Hook } from "./manifest";

export type Actor = {
  userId: string;
  tenantId: string;
  permissions: ReadonlySet<string>;
};

export type HookData = Readonly<{
  context?: string;
  output?: string;
}>;

export type ExtensionResult = {
  metadata: Record<string, string | number | boolean>;
};

export interface Extension {
  manifest: Manifest;
  execute(input: {
    hook: Hook;
    data: HookData;
    signal: AbortSignal;
  }): Promise<ExtensionResult>;
}

// Extensions receive projected data, not Actor or credentials.
// Return values cannot replace pipeline identity or approval gates.
