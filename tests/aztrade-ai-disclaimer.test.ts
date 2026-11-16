import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pipeline", () => ({ answerChat: vi.fn() }));
vi.mock("@/lib/admin/db", () => ({ pool: { query: vi.fn() } }));

import { DISCLAIMER, withDisclaimer } from "@/lib/aztrade/ai";

describe("AZTrade AI closing disclaimer", () => {
  it("adds the education-only line when the model leaves it out", () => {
    const out = withDisclaimer("- **Cash:** You hold cash.\n- **Risk:** Prices move.");
    expect(out.endsWith(DISCLAIMER)).toBe(true);
    expect(out.startsWith("- **Cash:**")).toBe(true);
  });
  it("does not repeat it when the model already ended with it", () => {
    const answer = "- **Risk:** Prices move.\n\n*This is education and paper-trading analysis only, not investment advice.*";
    expect(withDisclaimer(answer)).toBe(answer);
    expect(withDisclaimer(`${answer}\n`)).toBe(`${answer}\n`);
  });
  it("adds it even if the disclaimer wording appears earlier in the answer", () => {
    const out = withDisclaimer("This is not investment advice, they say.\n- **Cash:** You hold cash.");
    expect(out.endsWith(DISCLAIMER)).toBe(true);
  });
});
