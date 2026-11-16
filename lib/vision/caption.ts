import type { Match } from "./matches";

export type CaptionResult = {
  status: "same_wording" | "different_wording" | "insufficient_evidence";
  sources: (Pick<Match, "url" | "observedAt" | "publisher"> & { caption: string })[];
};

function normalize(value: string): string {
  return value.normalize("NFC").toLowerCase().trim().replace(/\s+/gu, " ");
}

export function checkCaption(claim: string, matches: Match[]): CaptionResult {
  const sources = matches.flatMap(({ kind, caption, url, observedAt, publisher }) =>
    kind === "exact" && caption?.trim() ? [{ url, caption, observedAt, publisher }] : [],
  );
  return {
    status: sources.length === 0 ? "insufficient_evidence"
      : sources.some(source => normalize(source.caption) === normalize(claim)) ? "same_wording" : "different_wording",
    sources,
  };
}
