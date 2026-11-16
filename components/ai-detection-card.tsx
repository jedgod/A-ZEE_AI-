import { ImageTrace } from "@/components/image-trace";
import type { Match } from "@/lib/vision/matches";
import { ScanSearch, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };
export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  confidence: number;
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  verification?: {
    publicIndex: {
      status: "checked" | "not_configured" | "unavailable";
      matches: Match[];
      indexedImages?: number;
    };
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
  const v = resultIsCurrent ? VERDICTS[result.verdict] ?? VERDICTS.INCONCLUSIVE : VERDICTS.INCONCLUSIVE;
  const index = result.verification?.publicIndex;
  return (
    <div className="my-2 max-w-md overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5"><ScanSearch className="h-4 w-4 text-rose-400" /><span className="text-xs font-semibold text-zinc-200">A-Zee AI Detector</span></div>
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
        {!resultIsCurrent && <p className="text-xs text-zinc-400">Previous scan. Scan again to verify signed credentials.</p>}
        {index && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <p className="font-semibold text-zinc-200">Public image matches</p>
            <p className="text-zinc-400">{index.status === "checked"
              ? `${index.matches.length ? "Showing " + index.matches.length + " matches." : "No matches found."} A-Zee index: ${index.indexedImages ?? 0} source entries.`
              : index.status === "unavailable" ? "The A-Zee index could not be checked." : "Public matching is not configured."}</p>
          </div>
        )}
        {result.scanId && index?.status === "checked" && index.matches.length > 0 && (
          <ImageTrace key={result.scanId} scanId={result.scanId} matches={index.matches} original={result.previewUrl} />
        )}
        {resultIsCurrent && result.signals.length ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Forensic Signals</p>
            <ul className="space-y-1">
              {result.signals.map((clue, i) => <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-zinc-300"><span className="mt-0.5 text-zinc-500">•</span><span>{clue}</span></li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
