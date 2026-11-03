import { createHash } from "node:crypto";

// Pure text handling for the search index: normalization, hashing and chunking. Chunks are exact
// slices of the normalized document (content.slice(start, end) === chunk), so every excerpt can be
// traced back to a position in the indexed source.

export const MAX_DOCUMENT_BYTES = 1_000_000;
export const CHUNK_TARGET = 1200;
const CHUNK_MAX = 1800;

/** Highlight markers used by ts_headline; removed from documents so they can't be forged. */
export const MARK_START = "";
export const MARK_END = "";

export class IndexError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) { super(code); }
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** LF line endings, no NULs or highlight markers, no trailing whitespace at the end. */
export function normalize(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[\u0000]/g, "").replace(/\s+$/, "");
}

/** Normalized content within the size limit, or an IndexError. */
export function prepareContent(raw: string): { content: string; hash: string; bytes: number } {
  if (typeof raw !== "string") throw new IndexError(422, "INVALID_INPUT");
  if (Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES) throw new IndexError(413, "DOCUMENT_TOO_LARGE", { limitBytes: MAX_DOCUMENT_BYTES });
  const content = normalize(raw);
  if (!content.trim()) throw new IndexError(422, "EMPTY_DOCUMENT");
  return { content, hash: sha256(content), bytes: Buffer.byteLength(content, "utf8") };
}

export type Chunk = { position: number; start: number; end: number; content: string };

/** Splits at paragraph, then line, then sentence, then word boundaries near CHUNK_TARGET. */
export function chunk(content: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < content.length) {
    while (start < content.length && /\s/.test(content[start])) start++;   // chunks don't start with whitespace
    if (start >= content.length) break;
    let end = Math.min(content.length, start + CHUNK_MAX);
    if (end < content.length) {
      const window = content.slice(start, end);
      const cut = [/\n\s*\n/g, /\n/g, /[.!?]\s/g, /\s/g].map(re => {
        let best = -1;
        for (const m of window.matchAll(re)) if (m.index! >= CHUNK_TARGET / 2) { best = m.index! + m[0].length; if (m.index! >= CHUNK_TARGET) break; }
        return best;
      }).find(i => i > 0);
      if (cut) end = start + cut;
    }
    const text = content.slice(start, end).replace(/\s+$/, "");
    chunks.push({ position: chunks.length, start, end: start + text.length, content: text });
    start = end;
  }
  return chunks;
}

/** Excerpt text without highlight markers (what provenance checks compare with the source). */
export const plainExcerpt = (excerpt: string) => excerpt.replaceAll(MARK_START, "").replaceAll(MARK_END, "");
