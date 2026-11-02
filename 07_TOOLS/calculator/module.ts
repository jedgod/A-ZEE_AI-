// ============================================================
// 07_TOOLS / CALCULATOR
// File: lib/07_tools/calculator.ts
// SERVER-ONLY INTEGRATION TEMPLATE
// ============================================================

import "server-only";
import { z } from "zod";
import {
  AuthContext, requirePermission
} from "../../lib/execution/contracts";

const schema = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  a: z.number().finite().min(-1e12).max(1e12),
  b: z.number().finite().min(-1e12).max(1e12),
}).strict();

export function runCalculator(auth: AuthContext, raw: unknown) {
  requirePermission(auth, "tools:calculator");
  const { operation, a, b } = schema.parse(raw);
  if (operation === "divide" && b === 0) {
    throw new Error("Division by zero");
  }

  const value = operation === "add" ? a + b
    : operation === "subtract" ? a - b
    : operation === "multiply" ? a * b : a / b;

  if (!Number.isFinite(value)) throw new Error("Non-finite result");
  return { operation, value };
}

// JavaScript floating-point arithmetic is not exact decimal math.
// Use an audited decimal library for financial calculations.
