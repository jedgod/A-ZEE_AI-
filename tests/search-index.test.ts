import { describe, expect, it } from "vitest";
import { chunk, CHUNK_TARGET, IndexError, MARK_END, MARK_START, MAX_DOCUMENT_BYTES, normalize, plainExcerpt, prepareContent, sha256 } from "@/lib/search-index/chunk";
import { featureEnabled, FEATURES } from "@/lib/features";

const paragraph = (i: number) => `Paragraph ${i} talks about topic number ${i}. ` + "Some filler words follow here to give it length. ".repeat(8);

describe("search index text handling", () => {
  it("normalizes line endings and strips NULs and forged highlight markers", () => {
    expect(normalize(`a\r\nb\rc\u0000${MARK_START}d${MARK_END}  \n\n`)).toBe("a\nb\ncd");
    expect(plainExcerpt(`x ${MARK_START}hit${MARK_END} y`)).toBe("x hit y");
  });

  it("hashes normalized content, so CRLF and LF copies are the same document", () => {
    expect(prepareContent("one\r\ntwo").hash).toBe(prepareContent("one\ntwo").hash);
    expect(prepareContent("one\ntwo").hash).toBe(sha256("one\ntwo"));
  });

  it("rejects empty and oversized documents", () => {
    expect(() => prepareContent(" \n\t ")).toThrow("EMPTY_DOCUMENT");
    const big = "x".repeat(MAX_DOCUMENT_BYTES + 1);
    try { prepareContent(big); throw new Error("accepted"); } catch (e) { expect(e).toBeInstanceOf(IndexError); expect((e as IndexError).status).toBe(413); }
    expect(() => prepareContent("é".repeat(MAX_DOCUMENT_BYTES / 2 + 1))).toThrow("DOCUMENT_TOO_LARGE");   // limit is in bytes, not characters
  });

  it("chunks are exact, ordered slices of the document near the target size", () => {
    const content = normalize(Array.from({ length: 40 }, (_, i) => paragraph(i)).join("\n\n"));
    const parts = chunk(content);
    expect(parts.length).toBeGreaterThan(5);
    parts.forEach((c, i) => {
      expect(c.position).toBe(i);
      expect(content.slice(c.start, c.end)).toBe(c.content);
      expect(c.content.length).toBeLessThanOrEqual(1800);
      expect(c.content).toBe(c.content.trim());
      if (i) expect(c.start).toBeGreaterThanOrEqual(parts[i - 1].end);
    });
    expect(parts.slice(0, -1).every(c => c.content.length >= CHUNK_TARGET / 2)).toBe(true);
    // Paragraph boundaries are preferred: chunks start at the start of a paragraph.
    expect(parts.every(c => c.content.startsWith("Paragraph"))).toBe(true);
    // Nothing but whitespace is lost between chunks.
    expect(parts.map(c => c.content).join("").replace(/\s/g, "")).toBe(content.replace(/\s/g, ""));
  });

  it("splits text without spaces and short documents", () => {
    expect(chunk("short note")).toEqual([{ position: 0, start: 0, end: 10, content: "short note" }]);
    const solid = "y".repeat(4000);
    const parts = chunk(solid);
    expect(parts.map(p => p.content.length)).toEqual([1800, 1800, 400]);
  });
});

describe("search index readiness", () => {
  it("vector search stays blocked; the full-text index is not production ready", () => {
    expect(FEATURES.vectorSearch.readiness).toBe("infrastructure_blocked");
    expect(featureEnabled("vectorSearch", { AZ_FEATURE_VECTOR_SEARCH: "on" })).toBe(false);
    expect(FEATURES.searchIndex.readiness).not.toBe("production_ready");
  });
});
