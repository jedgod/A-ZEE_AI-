// ============================================================
// 07_TOOLS / CODE_EXECUTION
// File: lib/07_tools/code_execution.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({
  language: z.enum(["python", "javascript"]),
  source: z.string().min(1).max(20000),
}).strict();

export interface Sandbox {
  execute(input: {
    language: "python" | "javascript";
    source: string;
    network: false;
    timeoutMs: number;
    memoryMb: number;
    maxOutputBytes: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export async function runCodeExecution(
  auth: AuthContext, raw: unknown, sandbox: Sandbox
) {
  requirePermission(auth, "tools:code_execution");
  const input = schema.parse(raw);
  return sandbox.execute({
    ...input, network: false, timeoutMs: 5000,
    memoryMb: 128, maxOutputBytes: 32000,
  });
}

// Sandbox adapter MUST enforce every declared limit.
// Use disposable isolation, no host mounts, no secrets,
// CPU quotas, restricted syscalls, and controlled artifacts.
// Node vm and subprocesses alone are NOT secure sandboxes.
