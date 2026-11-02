// 15_EXTENSIONS / ADAPTER INTERFACE
// Lifecycle contract only; adapters must be reviewed and statically allowlisted.
export interface ExtensionAdapter {
  manifest: { id: string; name: string; version: string };
  initialize(): Promise<void>;
  execute(input: unknown): Promise<unknown>;
  shutdown?(): Promise<void>;
}

// Runtime hooks use the narrower Extension contract in contracts.ts.
// This interface does not grant execution rights or provide isolation.
