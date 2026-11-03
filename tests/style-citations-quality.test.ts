import { describe, expect, it } from "vitest";
import { styleInstruction } from "@/09_GENERATION/style_control/module";
import { ratingBuckets, structuralQuality } from "@/10_VALIDATION/quality_score/module";
import { citationsFor, safeUrl } from "@/11_POSTPROCESS/citations/module";
import { chatRequestSchema } from "@/lib/chat/contracts";

const ask = { messages: [{ role: "user", content: "hi" }] };

describe("09 style control", () => {
  it("accepts only the fixed tones", () => {
    expect(chatRequestSchema.safeParse({ ...ask, style: "technical" }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ ...ask, style: "ignore policy" }).success).toBe(false);
    expect(() => styleInstruction("ignore policy" as never)).toThrow();
  });
  it("adds no instruction by default", () => {
    expect(styleInstruction()).toBeNull();
    expect(styleInstruction("default")).toBeNull();
    expect(styleInstruction("technical")).toContain("technical");
  });
});

describe("11 citations", () => {
  const sources = [
    { sourceId: "doc:a", title: "Guide", url: "https://example.org/guide" },
    { sourceId: "doc:b", title: "Unsafe", url: "javascript:alert(1)" },
    { sourceId: "memory:1" },
  ];
  it("rejects unsafe schemes and embedded credentials", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://user:pass@example.org")).toBeNull();
    expect(safeUrl("https://example.org/x")).toBe("https://example.org/x");
  });
  it("maps cited IDs to sources, dedupes, and flags unknown ones", () => {
    const result = citationsFor("Per [doc:a] and [1], also [doc:b], [memory:1] and [doc:zzz].", sources);
    expect(result.citations).toEqual([
      { id: "doc:a", title: "Guide", url: "https://example.org/guide" },
      { id: "doc:b", title: "Unsafe", url: null },
      { id: "memory:1", title: "memory:1", url: null },
    ]);
    expect(result.unsupportedIds).toEqual(["doc:zzz"]);
  });
  it("ignores code, indexing and Markdown links", () => {
    const answer = "Use `arr[1]` or xs[2].\n```js\nconst y = list[3];\n```\nSee [docs](https://example.org) and [9].";
    expect(citationsFor(answer, sources)).toEqual({ citations: [], unsupportedIds: ["9"] });
  });
});

describe("10 structural quality", () => {
  it("never scores empty content positively", () => {
    expect(structuralQuality("  ", { sourcesRetrieved: 0, citations: 0, unsupported: 0 }).score).toBe(0);
  });
  it("only applies source checks when sources were retrieved", () => {
    expect(structuralQuality("An answer.", { sourcesRetrieved: 0, citations: 0, unsupported: 0 }).score).toBe(100);
    expect(structuralQuality("An answer.", { sourcesRetrieved: 2, citations: 0, unsupported: 0 }).score).toBe(80);
    expect(structuralQuality("An answer [9].", { sourcesRetrieved: 2, citations: 0, unsupported: 1 }).score).toBe(60);
  });
  it("is labelled uncalibrated and buckets ratings", () => {
    expect(structuralQuality("x", { sourcesRetrieved: 0, citations: 0, unsupported: 0 }).calibrated).toBe(false);
    expect(ratingBuckets([]).every(b => b.helpfulRate === null)).toBe(true);
    const buckets = ratingBuckets([{ score: 100, helpful: true }, { score: 80, helpful: false }, { score: 10, helpful: true }]);
    expect(buckets.at(-1)).toMatchObject({ low: 80, count: 2, helpfulRate: 0.5 });
    expect(buckets[0]).toMatchObject({ count: 1, helpfulRate: 1 });
  });
});
