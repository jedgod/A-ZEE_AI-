"use client";

import { Search } from "lucide-react";
import styles from "./follow-ups.module.css";

/**
 * Suggested searches (ask A-Zee again) and keywords (open a web search in a new tab) under an answer.
 * A keyword link only opens a search page in your browser; nothing is sent from here.
 */
export function FollowUps({ searches, keywords, disabled, onAsk }: { searches: string[]; keywords: string[]; disabled?: boolean; onAsk: (query: string) => void }) {
  if (!searches.length && !keywords.length) return null;
  return (
    <div className={styles.wrap}>
      {searches.length > 0 && (
        <div className={styles.group} aria-label="Related searches">
          <span className={styles.label}>Related searches</span>
          {searches.map(q => (
            <button key={q} type="button" className={styles.chip} disabled={disabled} onClick={() => onAsk(q)}><Search size={13} /> {q}</button>
          ))}
        </div>
      )}
      {keywords.length > 0 && (
        <div className={styles.group} aria-label="Keywords">
          <span className={styles.label}>Keywords</span>
          {keywords.map(k => (
            <a key={k} className={styles.kw} href={`https://duckduckgo.com/?q=${encodeURIComponent(k)}`} target="_blank" rel="noopener noreferrer">{k} ↗</a>
          ))}
        </div>
      )}
    </div>
  );
}
