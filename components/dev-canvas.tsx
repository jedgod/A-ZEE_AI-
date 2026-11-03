"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Maximize2, Minimize2, RotateCw, X } from "lucide-react";
import { buildItemPreview, buildPreview, extractCodeBlocks, isPreviewable, type CanvasItem } from "@/lib/code-blocks";
import styles from "./dev-canvas.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  messages: { role: string; content: string }[];
  item: CanvasItem | null;
  onClearItem: () => void;
  onUseItem: (item: CanvasItem) => void;
};

// No allow-same-origin: with it, srcdoc content could lift its own sandbox and
// read this app's storage. Form submissions are additionally blocked by the CSP.
const SANDBOX = "allow-scripts allow-forms";

export function DevCanvas({ open, onClose, messages, item, onClearItem, onUseItem }: Props) {
  const blocks = useMemo(() => extractCodeBlocks(messages), [messages]);
  const previewable = useMemo(() => blocks.filter(isPreviewable), [blocks]);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const selected = previewable.find(b => b.id === selectedId) || previewable[previewable.length - 1];
  const doc = useMemo(() => selected ? buildPreview(selected, blocks) : "", [selected, blocks]);
  const itemDoc = useMemo(() => item ? buildItemPreview(item) : "", [item]);

  useEffect(() => { if (item) setTab("preview"); }, [item]);

  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose]);

  if (!open) return null;

  const copy = async (id: string, code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(id); setTimeout(() => setCopied(null), 1500); } catch {}
  };

  return (
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section id="dev-canvas" className={`${styles.panel} ${wide ? styles.wide : ""}`} role="dialog" aria-label="Development canvas">
        <header className={styles.header}>
          <span className={styles.title}>Development canvas</span>
          <div className={styles.actions}>
            {tab === "preview" && (selected || item) && (
              <button className={styles.icon} onClick={() => setReloadKey(k => k + 1)} aria-label="Reload preview" title="Reload preview"><RotateCw size={15} /></button>
            )}
            <button className={styles.icon} onClick={() => setWide(w => !w)} aria-label={wide ? "Narrow canvas" : "Widen canvas"} title={wide ? "Narrow canvas" : "Widen canvas"}>
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button className={styles.icon} onClick={onClose} aria-label="Close canvas" title="Close canvas"><X size={16} /></button>
          </div>
        </header>

        <div className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? styles.activeTab : ""} onClick={() => setTab("preview")}>Preview</button>
          <button role="tab" aria-selected={tab === "code"} className={tab === "code" ? styles.activeTab : ""} onClick={() => setTab("code")}>
            Code{blocks.length ? ` (${blocks.length})` : ""}
          </button>
          {tab === "preview" && !item && previewable.length > 1 && (
            <select className={styles.picker} value={selected?.id} onChange={e => setSelectedId(e.target.value)} aria-label="Preview source">
              {previewable.map((b, i) => <option key={b.id} value={b.id}>{`${b.lang || "markup"} #${i + 1}`}</option>)}
            </select>
          )}
        </div>

        <div className={styles.body}>
          {tab === "preview" ? (
            item ? (
              <div className={styles.itemView}>
                <div className={styles.itemBar}>
                  <button className={styles.icon} onClick={onClearItem} aria-label="Back to conversation preview" title="Back to conversation preview"><ArrowLeft size={15} /></button>
                  <span className={styles.itemName}>{item.kind === "prompt" ? item.title : item.name}</span>
                  <button className={styles.use} onClick={() => onUseItem(item)}>
                    {item.kind === "prompt" ? "Use prompt" : "Attach to message"}
                  </button>
                </div>
                <iframe
                  key={`item-${reloadKey}`}
                  className={styles.frame}
                  title="Item preview"
                  sandbox={SANDBOX}
                  referrerPolicy="no-referrer"
                  srcDoc={itemDoc}
                />
              </div>
            ) : selected ? (
              <iframe
                key={`${selected.id}-${reloadKey}`}
                className={styles.frame}
                title="Project preview"
                sandbox={SANDBOX}
                referrerPolicy="no-referrer"
                srcDoc={doc}
              />
            ) : (
              <div className={styles.empty}>
                <strong>Preview area for the project</strong>
                <p>Ask AZ_AI for HTML or SVG — for example “Build a pricing card in HTML and CSS” — and it renders here. CSS and JavaScript blocks from the same reply are included.</p>
              </div>
            )
          ) : blocks.length ? (
            <div className={styles.codeList}>
              {blocks.map(b => (
                <figure key={b.id} className={styles.codeBlock}>
                  <figcaption>
                    <span>{b.lang || "text"}</span>
                    <button onClick={() => copy(b.id, b.code)} aria-label={`Copy ${b.lang || "text"} code`}>
                      {copied === b.id ? <Check size={13} /> : <Copy size={13} />}{copied === b.id ? "Copied" : "Copy"}
                    </button>
                  </figcaption>
                  <pre><code>{b.code}</code></pre>
                </figure>
              ))}
            </div>
          ) : (
            <div className={styles.empty}><p>Code blocks from this conversation appear here.</p></div>
          )}
        </div>
        <footer className={styles.footer}>Previews run in an isolated sandbox with network requests blocked.</footer>
      </section>
    </div>
  );
}
