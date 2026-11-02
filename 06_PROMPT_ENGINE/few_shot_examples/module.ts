// ============================================================
// 06_PROMPT_ENGINE / FEW_SHOT_EXAMPLES
// File: lib/06_prompt_engine/few_shot_examples.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import type { Message } from "../../lib/execution/contracts";

const example = z.object({
  id: z.string().min(1).max(100),
  input: z.string().min(1).max(4000),
  output: z.string().min(1).max(4000),
}).strict();

export function buildFewShotExamples(
  trustedRegistry: unknown,
  selectedIds: readonly string[]
): Message[] {
  const registry = z.array(example).max(100).parse(trustedRegistry);
  if (selectedIds.length > 4 ||
      new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Select up to four unique examples");
  }

  return selectedIds.flatMap(id => {
    const item = registry.find(e => e.id === id);
    if (!item) throw new Error("Unknown example");
    return [
      { role: "user" as const, content: item.input },
      { role: "assistant" as const, content: item.output },
    ];
  });
}

// Registry must be reviewed, versioned, and free of sensitive data.
// Count example tokens against the full prompt budget.
