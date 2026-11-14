import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AZTrade mobile auth separation", () => {
  const source = readFileSync(join(process.cwd(), "lib/aztrade/companion-gateway.ts"), "utf8");
  const native = readFileSync(join(process.cwd(), "mobile/aztrade/AZTradeAIScreen.tsx"), "utf8");
  it("supports distinct A-Zee and AZTrade authorization headers", () => {
    expect(source).toContain("x-aztrade-token");
    expect(native).toContain("X-AZTrade-Token");
    expect(native).toContain("X-AZ-Client");
  });
  it("preserves an idempotency key across authentication retry", () => {
    expect(native).toContain("const requestId = UUID()");
    expect(native).toContain("{requestId, message: question.trim()}");
  });
});
