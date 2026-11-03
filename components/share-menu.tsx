"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Copy, Download, Link, Link2, Mail, MoreHorizontal, Share2 } from "lucide-react";
import { encodeShare, toMarkdown, type SharedProject } from "@/lib/share";
import styles from "./share-menu.module.css";

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  getProject: () => SharedProject | null;
  notify: (text: string) => void;
};

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
// Windows and many mail clients truncate mailto URLs past roughly 2,000 characters.
const MAILTO_LIMIT = 1900;

export function ShareMenu({ open, setOpen, getProject, notify }: Props) {
  const [view, setView] = useState<"main" | "emails" | "more">("main");
  const [emails, setEmails] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setView("main"); setError(""); return; }
    // composedPath() is captured at dispatch, so clicks on items React has since
    // re-rendered away still count as inside the menu.
    const close = (e: MouseEvent) => {
      const path = e.composedPath();
      const inside = path.some(node => node === rootRef.current ||
        (node instanceof Element && node.getAttribute("aria-controls") === "share-menu"));
      if (!inside) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", escape); };
  }, [open, setOpen]);

  useEffect(() => { if (view === "emails") emailRef.current?.focus(); }, [view]);

  const project = () => {
    const p = getProject();
    if (!p) notify("Start a conversation to share it.");
    return p;
  };

  const linkFor = async (p: SharedProject) => `${location.origin}${location.pathname}${await encodeShare(p)}`;

  const copyLink = async () => {
    const p = project();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(await linkFor(p));
      notify("Link copied. Anyone who opens it can view this project, its instructions, and files.");
      setOpen(false);
    } catch { notify("Clipboard unavailable"); }
  };

  const sendEmails = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).filter(Boolean);
    const invalid = list.filter(a => !EMAIL.test(a));
    if (!list.length) { setError("Enter at least one email address."); return; }
    if (invalid.length) { setError(`Check ${invalid.join(", ")}`); return; }
    const p = project();
    if (!p) return;
    const link = await linkFor(p);
    const subject = encodeURIComponent(`AZ_AI project: ${p.title}`);
    const intro = "I'm sharing an AZ_AI project with you. Open this link to view the project, its instructions, and files:";
    let body = encodeURIComponent(`${intro}\n\n${link}`);
    const base = `mailto:${list.map(encodeURIComponent).join(",")}?subject=${subject}&body=`;
    if ((base + body).length > MAILTO_LIMIT) {
      try { await navigator.clipboard.writeText(link); } catch { notify("Clipboard unavailable"); return; }
      body = encodeURIComponent(`${intro}\n\n[Paste the copied link here]`);
      notify("The link is too long for an email draft, so it was copied. Paste it into the message.");
    }
    window.location.href = base + body;
    setEmails("");
    setOpen(false);
  };

  const copyMarkdown = async () => {
    const p = project();
    if (!p) return;
    try { await navigator.clipboard.writeText(toMarkdown(p.title, p.messages)); notify("Copied as Markdown"); setOpen(false); }
    catch { notify("Clipboard unavailable"); }
  };

  const download = () => {
    const p = project();
    if (!p) return;
    const url = URL.createObjectURL(new Blob([toMarkdown(p.title, p.messages)], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${p.title.replace(/[^\w-]+/g, "-").slice(0, 40) || "az-ai-project"}.md` });
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const deviceShare = async () => {
    const p = project();
    if (!p) return;
    try { await navigator.share({ title: `AZ_AI project: ${p.title}`, url: await linkFor(p) }); setOpen(false); }
    catch (err) { if ((err as Error).name !== "AbortError") notify("Sharing unavailable"); }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        aria-label="Share project"
        title="Share project"
        aria-expanded={open}
        aria-controls="share-menu"
      >
        <Link2 size={16} />
      </button>

      {open && (
        <div id="share-menu" className={styles.menu} role="menu">
          {view === "main" && (
            <>
              <div className={styles.heading}>Share project</div>
              <div className={styles.list}>
                <button role="menuitem" className={styles.item} onClick={copyLink}>
                  <Link size={16} />
                  <span><span>Anyone with the link</span><small>Can view the project, instructions, and files</small></span>
                </button>
                <button role="menuitem" className={styles.item} onClick={() => setView("emails")}>
                  <Mail size={16} /><span>Specific emails</span>
                </button>
                <button role="menuitem" className={styles.item} onClick={() => setView("more")}>
                  <MoreHorizontal size={16} /><span>More…</span>
                </button>
              </div>
            </>
          )}

          {view === "emails" && (
            <form onSubmit={sendEmails}>
              <div className={styles.heading}>
                <button type="button" className={styles.back} onClick={() => setView("main")} aria-label="Back"><ChevronLeft size={16} /></button>
                Specific emails
              </div>
              <div className={styles.form}>
                <label htmlFor="share-emails">People to send the project link to</label>
                <input
                  id="share-emails"
                  ref={emailRef}
                  value={emails}
                  onChange={e => { setEmails(e.target.value); setError(""); }}
                  placeholder="name@example.com, another@example.com"
                  autoComplete="email"
                />
                {error && <p className={styles.error} role="alert">{error}</p>}
                <p className={styles.note}>Opens an email draft in your mail app with the share link.</p>
                <button type="submit" className={styles.primary}>Create email</button>
              </div>
            </form>
          )}

          {view === "more" && (
            <>
              <div className={styles.heading}>
                <button className={styles.back} onClick={() => setView("main")} aria-label="Back"><ChevronLeft size={16} /></button>
                More sharing options
              </div>
              <div className={styles.list}>
                <button role="menuitem" className={styles.item} onClick={copyMarkdown}><Copy size={16} /><span>Copy as Markdown</span></button>
                <button role="menuitem" className={styles.item} onClick={download}><Download size={16} /><span>Download as Markdown</span></button>
                {typeof navigator !== "undefined" && "share" in navigator && (
                  <button role="menuitem" className={styles.item} onClick={deviceShare}><Share2 size={16} /><span>Share with device apps…</span></button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
