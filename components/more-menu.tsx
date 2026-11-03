"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FolderInput, MoreHorizontal, Trash2 } from "lucide-react";
import type { Project } from "@/lib/projects";
import styles from "./share-menu.module.css";

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  projects: Project[];
  currentProjectId: string;
  chatTitle: string | null;
  onMove: (projectId: string) => void;
  onCreateAndMove: (name: string) => string | null;
  onDelete: () => void;
};

export function MoreMenu({ open, setOpen, projects, currentProjectId, chatTitle, onMove, onCreateAndMove, onDelete }: Props) {
  const [view, setView] = useState<"main" | "move" | "delete">("main");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = projects.find(p => p.id === currentProjectId) || projects[0];

  useEffect(() => {
    if (!open) { setView("main"); setName(""); setError(""); return; }
    const close = (e: MouseEvent) => {
      const inside = e.composedPath().some(node => node === rootRef.current);
      if (!inside) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", escape); };
  }, [open, setOpen]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const failure = onCreateAndMove(name);
    if (failure) setError(failure);
    else setOpen(false);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        aria-label="More options"
        title="More options"
        aria-expanded={open}
        aria-controls="more-menu"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div id="more-menu" className={styles.menu} role="menu">
          {view === "main" && (
            <>
              <div className={styles.heading}>{chatTitle ? <span className={styles.truncate}>{chatTitle}</span> : "This chat"}</div>
              <div className={styles.list}>
                <button role="menuitem" className={styles.item} disabled={!chatTitle} onClick={() => setView("move")}>
                  <FolderInput size={16} />
                  <span className={styles.grow}><span>Move project</span><small>Now in {current.name}</small></span>
                  <ChevronRight size={16} className={styles.trailing} />
                </button>
                <button role="menuitem" className={`${styles.item} ${styles.danger}`} disabled={!chatTitle} onClick={() => setView("delete")}>
                  <Trash2 size={16} /><span>Delete chat</span>
                </button>
                {!chatTitle && <p className={styles.hint}>Start a conversation to move or delete it.</p>}
              </div>
            </>
          )}

          {view === "move" && (
            <>
              <div className={styles.heading}>
                <button className={styles.back} onClick={() => setView("main")} aria-label="Back"><ChevronLeft size={16} /></button>
                Move to project
              </div>
              <div className={`${styles.list} ${styles.scrollList}`} role="group" aria-label="Projects">
                {projects.map(p => (
                  <button
                    key={p.id}
                    role="menuitemradio"
                    aria-checked={p.id === current.id}
                    className={styles.item}
                    onClick={() => { if (p.id !== current.id) onMove(p.id); setOpen(false); }}
                  >
                    <span className={styles.checkSlot}>{p.id === current.id && <Check size={15} />}</span>
                    <span className={styles.grow}>{p.name}</span>
                  </button>
                ))}
              </div>
              <form className={styles.inlineForm} onSubmit={create}>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); setError(""); }}
                  placeholder="New project name"
                  aria-label="New project name"
                  maxLength={40}
                />
                <button type="submit" className={styles.primary}>Create & move</button>
              </form>
              {error && <p className={`${styles.error} ${styles.padded}`} role="alert">{error}</p>}
            </>
          )}

          {view === "delete" && (
            <>
              <div className={styles.heading}>Delete chat?</div>
              <div className={styles.form}>
                <p className={styles.note}>“{chatTitle}” will be removed from this browser. This can’t be undone.</p>
                <div className={styles.buttons}>
                  <button className={styles.secondary} onClick={() => setView("main")}>Cancel</button>
                  <button className={`${styles.primary} ${styles.dangerButton}`} onClick={() => { onDelete(); setOpen(false); }}>Delete</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
