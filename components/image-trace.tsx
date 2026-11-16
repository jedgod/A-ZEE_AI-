"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Match } from "@/lib/vision/matches";
import type { CaptionResult } from "@/lib/vision/caption";

type SavedCaption = { caption: string; result: CaptionResult };

const captionLabels = {
  same_wording: "This wording appears in an indexed caption.",
  different_wording: "The indexed captions use different wording.",
  insufficient_evidence: "No recorded caption from an exact file match.",
};

function SourceLink({ match }: { match: Pick<Match, "url" | "publisher"> }) {
  let host: string;
  try {
    const url = new URL(match.url);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    host = url.hostname;
  } catch { return null; }
  return <a className="break-words text-sky-300 underline" href={match.url} target="_blank" rel="noopener noreferrer">{match.publisher || host}</a>;
}

export function ImageTrace({ scanId, matches, original }: { scanId: string; matches: Match[]; original?: string }) {
  const base = `/api/vision/scans/${encodeURIComponent(scanId)}`;
  const items = [...matches].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const [selected, setSelected] = useState<Match>();
  const [caption, setCaption] = useState("");
  const [saved, setSaved] = useState<SavedCaption | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/caption`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const { data } = await response.json();
        if (!controller.signal.aborted && data) setSaved(current => current ?? data);
      }).catch(() => undefined);
    return () => controller.abort();
  }, [base]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !caption.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${base}/caption`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Too many checks. Try again in a minute." : "Caption check unavailable. Try again.");
        return;
      }
      setSaved((await response.json()).data);
    } catch { setError("Caption check unavailable. Try again."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
    <h3 className="font-semibold text-zinc-100">Trace this image</h3>
    <p className="text-zinc-400">Ordered by when these matches were observed in the index. The earliest result may be a repost.</p>
    <ol className="space-y-3 border-l border-zinc-700 pl-3">
      {items.map(match => <li key={match.url} className="space-y-1">
        <p className="text-zinc-200"><time dateTime={match.observedAt}>{match.observedAt.slice(0, 10)}</time> · {match.kind === "exact" ? "Exact file" : match.method === "region" ? "Possible shared image region" : "Possible visual match"}</p>
        <SourceLink match={match} />
        {match.caption && <blockquote className="break-words text-zinc-400">{match.caption}</blockquote>}
        {match.previewId && <button type="button" aria-expanded={selected?.url === match.url} onClick={() => {
          setPreviewFailed(false);
          setSelected(selected?.url === match.url ? undefined : match);
        }} className="block min-h-8 underline text-sky-300">Compare images</button>}
      </li>)}
    </ol>
    {selected?.previewId && <div className="grid grid-cols-2 gap-2 text-zinc-200">
      <figure className="space-y-1">
        <figcaption>Your upload</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {original ? <img src={original} alt="Uploaded image" className="w-full rounded object-contain" /> : <p className="text-zinc-400">Rescan to view your upload here.</p>}
      </figure>
      <figure className="space-y-1">
        <figcaption>Indexed image</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {previewFailed ? <p className="text-zinc-400">Preview unavailable.</p> : <img src={`${base}/compare/${selected.previewId}`} onError={() => setPreviewFailed(true)} alt="Indexed source image" className="w-full rounded object-contain" />}
      </figure>
    </div>}
    <form onSubmit={submit} className="space-y-2 border-t border-zinc-800 pt-3">
      <label className="block font-semibold text-zinc-100">
        Check a caption
        <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={1000} rows={3}
          placeholder="Paste the caption that came with the image" className="mt-2 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100" />
      </label>
      <button type="submit" disabled={busy || !caption.trim()} className="min-h-9 rounded bg-sky-300 px-3 font-semibold text-zinc-950 disabled:opacity-50">{busy ? "Checking…" : "Check wording"}</button>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
    </form>
    {saved && <div aria-live="polite" className="space-y-1 text-zinc-300">
      <p>{captionLabels[saved.result.status]}</p>
      <p className="break-words">Caption checked: {saved.caption}</p>
      {saved.result.sources.map(source => <blockquote key={source.url} className="break-words">“{source.caption}” · <SourceLink match={source} /></blockquote>)}
      <p className="text-zinc-400">A wording comparison alone cannot verify the claim.</p>
    </div>}
  </section>;
}
