import { Cpu, HelpCircle, ScanSearch, ShieldAlert, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PixelScores = { aiGeneratedScore: number; deepfakeScore: number };
export type AiDetectionResult = {
  scanId?: string;
  verdict: "AI_GENERATED" | "LIKELY_REAL" | "INCONCLUSIVE";
  confidence: number;
  /** Present when a pixel-level classifier ran; otherwise a single overall meter is shown. */
  pixelScores?: PixelScores | null;
  likelySource: string;
  signals: string[];
  previewUrl?: string;
};

const pct = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
const meter = (score: number) => (score >= 70 ? { bar: "bg-rose-500", text: "text-rose-400" } : score >= 35 ? { bar: "bg-amber-500", text: "text-amber-400" } : { bar: "bg-emerald-500", text: "text-emerald-400" });

const VERDICTS = {
  AI_GENERATED: { label: "AI GENERATED", badge: "bg-rose-500/20 text-rose-300 border-rose-500/40", bar: "bg-rose-500", Icon: ShieldAlert, icon: "text-rose-400" },
  LIKELY_REAL: { label: "LIKELY REAL", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", bar: "bg-emerald-500", Icon: ShieldCheck, icon: "text-emerald-400" },
  INCONCLUSIVE: { label: "INCONCLUSIVE", badge: "bg-amber-500/20 text-amber-300 border-amber-500/40", bar: "bg-amber-500", Icon: HelpCircle, icon: "text-amber-400" },
} as const;

function Meter({ label, score, Icon, color }: { label: string; score: number; Icon?: typeof Cpu; color: { bar: string; text: string } }) {
  return (
    <div className="space-y-1" role="img" aria-label={`${label} ${score} percent`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-zinc-400">{Icon ? <Icon className="h-3 w-3 text-zinc-500" /> : null}{label}</span>
        <span className={`font-bold ${color.text}`}>{score}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full transition-all duration-500 ${color.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

/** Result of an AI-image check: verdict, optional dual pixel meters (GenAI diffusion, face deepfake) or one overall meter, source and clues. */
export function AiDetectionCard({ result, onDelete }: { result: AiDetectionResult; onDelete?: (scanId: string) => void }) {
  const v = VERDICTS[result.verdict] ?? VERDICTS.INCONCLUSIVE;
  const confidence = pct(result.confidence);
  const scores = result.pixelScores;
  const ai = scores ? pct(scores.aiGeneratedScore) : 0, fake = scores ? pct(scores.deepfakeScore) : 0;
  return (
    <div className="my-2 max-w-xs overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/95">
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
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full border border-zinc-700 bg-black/80 px-2.5 py-1">
            <v.Icon className={`h-3.5 w-3.5 ${v.icon}`} /><span className="text-xs font-bold text-white">{confidence}%</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-3 p-3.5">
        {scores ? (
          <div className="space-y-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950 p-2.5">
            <Meter label="GenAI Diffusion" score={ai} Icon={Cpu} color={meter(ai)} />
            <Meter label="Face Deepfake" score={fake} Icon={UserCheck} color={meter(fake)} />
          </div>
        ) : (
          <Meter label="Overall Confidence" score={confidence} color={{ bar: v.bar, text: "text-white" }} />
        )}
        <div className="flex justify-between rounded-xl border border-zinc-800/80 bg-zinc-950 px-3 py-2 text-xs">
          <span className="text-zinc-500">Suspected Source</span><span className="font-medium text-zinc-200">{result.likelySource}</span>
        </div>
        {result.signals.length ? (
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
