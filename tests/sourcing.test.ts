import { describe, expect, it } from "vitest";
import { sourcingFor } from "@/lib/pipeline/sourcing";

const src = (id: string) => ({ sourceId: id, text: "x", trust: "untrusted" as const });
describe("sourcing levels", () => {
  it("level 1 for live quotes or a linked page", () => {
    expect(sourcingFor([src("market:1")], 1).level).toBe(1);
    expect(sourcingFor([src("web:1"), src("page:1")], 0).level).toBe(1);
  });
  it("level 2 for web results or documents", () => {
    expect(sourcingFor([src("web:1")], 2).level).toBe(2);
    expect(sourcingFor([src("doc:abc")], 0).level).toBe(2);
  });
  it("level 3 with no outside material, and a tool result lifts it to 1", () => {
    const none = sourcingFor([], 0);
    expect(none.level).toBe(3); expect(none.cited).toBe(0); expect(none.detail).toMatch(/out of date/);
    expect(sourcingFor([], 0, ["calculator"]).level).toBe(1);
  });
});
