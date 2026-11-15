import { Fragment } from 'react';
import styles from './aztrade.module.css';
import { parseReply, type ReplyBlock, type ReplyPart } from './logic';

const Parts = ({ parts }: { parts: ReplyPart[] }) => <>{parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}</>;

/** An AZTrade AI answer laid out as paragraphs, one line per bullet, and a set-apart note. */
export function ReplyView({ text }: { text: string }) {
  const blocks = parseReply(text);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b: ReplyBlock = blocks[i];
    if (b.kind === 'li') {
      const items: ReplyBlock[] = [];
      while (i < blocks.length && blocks[i].kind === 'li') items.push(blocks[i++]);
      i--;
      out.push(<ul key={i} className={styles.replyList}>{items.map((it, j) => <li key={j}><Parts parts={it.parts} /></li>)}</ul>);
    } else if (b.kind === 'h') out.push(<h4 key={i} className={styles.replyHead}><Parts parts={b.parts} /></h4>);
    else if (b.kind === 'note') out.push(<p key={i} className={styles.replyNote}><Parts parts={b.parts} /></p>);
    else out.push(<p key={i} className={styles.replyP}><Parts parts={b.parts} /></p>);
  }
  return <div className={styles.reply}>{out}</div>;
}
