import type { RetrievedSource } from "./context";

/**
 * How well-grounded an answer is, as a plain level the user can read at a glance. It describes what the engine had in front of it, not how
 * accurate the answer is:
 *   1  Live data   : a linked page the user pointed at, or live market quotes fetched just now (primary, direct)
 *   2  Web sources : web search or news results, or the user's own documents and memories (secondary, quoted)
 *   3  Knowledge   : no outside material; from the model's general knowledge, which can be out of date
 * Calculator and other tool results count as Level 1 for the figures they produced.
 */
export type Sourcing = { level: 1 | 2 | 3; label: string; detail: string; basis: string[]; cited: number };

const KIND: Record<string, { level: 1 | 2; name: string }> = {
  page: { level: 1, name: "the linked page" }, market: { level: 1, name: "live market quotes" },
  web: { level: 2, name: "web results" }, doc: { level: 2, name: "your documents" }, mem: { level: 2, name: "your saved memories" },
};

export function sourcingFor(sources: RetrievedSource[], citedCount: number, toolNames: string[] = []): Sourcing {
  const basis: string[] = [];
  let best: 1 | 2 | 3 = 3;
  for (const s of sources) {
    const k = KIND[s.sourceId.split(":")[0]] ?? { level: 2 as const, name: "retrieved sources" };
    if (!basis.includes(k.name)) basis.push(k.name);
    if (k.level < best) best = k.level;
  }
  if (toolNames.length) { basis.push("calculated figures"); best = 1; }
  if (best === 1) return { level: 1, label: "Level 1 · Live data", detail: `Built from ${basis.join(", ")}, fetched for this question. Quotes may be delayed.`, basis, cited: citedCount };
  if (best === 2) return { level: 2, label: "Level 2 · Web sources", detail: `Built from ${basis.join(", ")}. A-Zee quotes what they say but doesn't verify them.`, basis, cited: citedCount };
  return { level: 3, label: "Level 3 · General knowledge", detail: "No outside sources were used. This comes from A-Zee's general knowledge and may be out of date; check anything important.", basis, cited: 0 };
}
