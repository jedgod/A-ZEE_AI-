import type { Classification, Discovery } from "@/lib/vision/provider-types";
import { ImageTrace } from "@/components/image-trace";
import type { Match } from "@/lib/vision/matches";
import { ScanSearch, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };
export type GoogleSection =
  | { status: "ran"; model: string; observations: { summary: string; visibleText: string[]; placeClues: string[]; captureClues: string[]; aiArtifactClues: string[]; limits: string } }
  | { status: "skipped" | "unavailable"; reason: string };

export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  confidence: number;
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  verification?: {
    classification?: Classification;
    discovery?: Discovery;
    credential?: "trusted_ai_creation" | "trusted_other" | "untrusted" | "invalid" | "absent" | "unavailable";
    publicIndex: {
      status: "checked" | "not_configured" | "unavailable";
      matches: Match[];
      indexedImages?: number;
    };
    google?: GoogleSection;
  } | null;
  previewUrl?: string;
};

const VERDICTS = {
  AI_GENERATED: { label: "SIGNED AI CLAIM", badge: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  LIKELY_REAL: { label: "LIKELY REAL", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
  INCONCLUSIVE: { label: "INCONCLUSIVE", badge: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
} as const;

export function AiDetectionCard({ result, onDelete }: { result: AiDetectionResult; onDelete?: (scanId: string) => void }) {
  const resultIsCurrent = Boolean(result.verification);
  const v = result.verification?.credential === "trusted_ai_creation" ? VERDICTS.AI_GENERATED : VERDICTS.INCONCLUSIVE;
  const index = result.verification?.publicIndex;
  const google = result.verification?.google;
  const classification = result.verification?.classification;
  const discovery = result.verification?.discovery;
  return (
    <div className="my-2 max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5"><ScanSearch className="h-4 w-4 text-rose-400" /><span className="text-xs font-semibold text-zinc-200">A-Zee Image Evidence</span></div>
        <div className="flex items-center gap-1.5">
          <Badge className={`border text-[10px] font-bold ${v.badge}`}>{v.label}</Badge>
          {result.scanId && onDelete ? (
            <button type="button" onClick={() => onDelete(result.scanId!)} aria-label="Delete scan" title="Delete scan" className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {result.previewUrl ? (
        <div className="relative h-36 w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.previewUrl} alt="Scanned media" className="h-full w-full object-cover opacity-90" />

        </div>
      ) : null}

      <div className="space-y-3 p-3.5">
        <p className="text-xs text-zinc-400">Signed provenance, estimated AI classification, local copies and public web matches are separate evidence. Estimates can be wrong. Public search covers only the provider index, not private messages/profiles or every social post. A match does not prove the original source.</p>
        {!resultIsCurrent && <p className="text-xs text-zinc-400">Previous scan. Scan again to verify signed credentials.</p>}
        {index && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-semibold text-zinc-200">Configured local copy matches</p>
            <p className="text-zinc-400">{index.status === "checked"
              ? `${index.matches.length ? "Showing " + index.matches.length + " matches." : "No matches in the configured local index."} A-Zee index: ${index.indexedImages ?? 0} source entries.`
              : index.status === "unavailable" ? "The A-Zee index could not be checked." : "Local copy matching is not configured."}</p>
          </div>
        )}
        {result.scanId && index?.status === "checked" && index.matches.length > 0 && (
          <ImageTrace key={result.scanId} scanId={result.scanId} matches={index.matches} original={result.previewUrl} />
        )}
        {classification && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-semibold text-zinc-200">Estimated AI classification - Sightengine</p>
            {classification.status === "checked" ? <>
              <p className="text-zinc-300">{classification.label === "LIKELY_AI" ? "Likely AI-generated" : classification.label === "LOW_AI_SIGNAL" ? "Low AI signal; authenticity unknown" : "Inconclusive estimate"} ? Provider score {Math.round(classification.score * 100)} / 100</p>
              <p className="text-zinc-400">Model: {classification.model} (provider-managed version). Not calibrated by A-Zee; this is not a verified probability or signed declaration. Checked {classification.checkedAt.slice(0, 10)}.</p>
            </> : <p className="text-zinc-400">{classification.status}: {classification.reason}</p>}
          </div>
        )}
        {discovery && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-semibold text-zinc-200">Public web and social links - Google Cloud Vision</p>
            {discovery.status === "checked" ? <>
              <p className="text-zinc-400">{discovery.matches.length ? "Provider-reported visual matches:" : "No matches returned within this provider's public index."} Checked {discovery.checkedAt.slice(0, 10)}. No private content or direct social-account access.</p>
              {discovery.matches.map(match => <div key={match.url}>
                <p className="text-zinc-300">{match.platform} ? {match.kind.replaceAll("_", " ")}</p>
                <a className="break-all text-zinc-400 underline" href={match.url.startsWith("https://") ? match.url : undefined} target="_blank" rel="noopener noreferrer nofollow">{match.url}</a>
              </div>)}
            </> : <p className="text-zinc-400">{discovery.status}: {discovery.reason}</p>}
          </div>
        )}
        {google && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-semibold text-zinc-200">Visual clues from Google Gemini</p>
            {google.status === "ran" ? (
              <>
                <p className="text-zinc-300">{google.observations.summary}</p>
                {([["Text in the picture", google.observations.visibleText], ["Place clues", google.observations.placeClues], ["How it seems to have been made or captured", google.observations.captureClues], ["Visual signs of AI or editing", google.observations.aiArtifactClues]] as [string, string[]][]).filter(([, items]) => items.length).map(([label, items]) => (
                  <div key={label}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
                    <ul className="list-disc pl-4 text-zinc-300">{items.map(item => <li key={item}>{item}</li>)}</ul>
                  </div>
                ))}
                {google.observations.limits && <p className="text-zinc-400">{google.observations.limits}</p>}
                <p className="text-zinc-500">Described by Google's Gemini. These are clues from a model, not proof of where the picture came from, and they do not change the AI-origin result above.</p>
              </>
            ) : <p className="text-zinc-400">{google.reason}</p>}
          </div>
        )}
        {resultIsCurrent && result.signals.length ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Signed provenance and metadata clues</p>
            <ul className="space-y-1">
              {result.signals.map((clue, i) => <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-zinc-300"><span className="mt-0.5 text-zinc-500">•</span><span>{clue}</span></li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
