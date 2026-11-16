import styles from "./sourcing-badge.module.css";

export type SourcingInfo = { level: 1 | 2 | 3; label: string; detail: string; basis?: string[]; cited?: number };

/** A small "how well-grounded is this answer" label under an answer. Hover or focus it for the detail. */
export function SourcingBadge({ info }: { info: SourcingInfo }) {
  return (
    <span className={`${styles.badge} ${styles[`l${info.level}`]}`} title={info.detail} tabIndex={0} aria-label={`${info.label}. ${info.detail}`}>
      <i aria-hidden /> {info.label}{info.cited ? ` · ${info.cited} cited` : ""}
    </span>
  );
}
