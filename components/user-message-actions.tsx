"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, History, Pencil, Share2 } from "lucide-react";
import styles from "./user-message-actions.module.css";

type Props = {
  text: string;
  versions: string[];            // the other versions of this prompt (oldest first); empty when it was never edited
  disabled?: boolean;
  onEdit: () => void;
  onPickVersion: (index: number) => void;
  notify: (text: string) => void;
};

/** Copy, Share, See versions and Edit under one of the user's own prompts. Nothing here sends anything by itself. */
export function UserMessageActions({ text, versions, disabled, onEdit, onPickVersion, notify }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!e.composedPath().includes(ref.current as EventTarget)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); notify("Copied"); } catch { notify("Couldn't copy. Select the text and copy it instead."); }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); notify("Sharing isn't available here, so the text was copied."); }
    } catch (e) { if ((e as Error).name !== "AbortError") notify("Couldn't share."); }
  }

  return (
    <div className={styles.row} ref={ref}>
      <button type="button" aria-label="Copy" title="Copy" onClick={copy}><Copy size={16} /></button>
      <button type="button" aria-label="Share" title="Share" onClick={share}><Share2 size={16} /></button>
      <span className={styles.versionWrap}>
        <button type="button" aria-label="See versions" title={versions.length ? "See versions" : "No earlier versions yet"} aria-expanded={open}
          disabled={!versions.length} onClick={() => setOpen(o => !o)}><History size={16} /></button>
        {open && (
          <ul className={styles.menu} role="menu">
            {versions.map((v, i) => (
              <li key={i}><button type="button" role="menuitem" disabled={disabled} onClick={() => { setOpen(false); onPickVersion(i); }}>
                <b>Version {i + 1}</b><span>{v.length > 90 ? `${v.slice(0, 90)}…` : v}</span></button></li>
            ))}
          </ul>
        )}
      </span>
      <button type="button" aria-label="Edit message" title="Edit message" disabled={disabled} onClick={onEdit}><Pencil size={16} /></button>
    </div>
  );
}
