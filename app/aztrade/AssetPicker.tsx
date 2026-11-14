'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import styles from './aztrade.module.css';
import { loadCatalog } from './api';
import { CLASS_LABEL, guessClass, SYMBOL_PATTERN, type Asset, type CatalogItem } from './logic';

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A searchable dropdown of the assets the monitoring feed supports. Typing "BTC" shows "BTC-USD · Bitcoin / US Dollar" so the user
 * sees exactly which pair they are choosing. A symbol that is not in the list can still be used as a custom entry. Keyboard: ↑ ↓ Enter Esc.
 */
export function AssetPicker({ value, onChange, label = 'Asset', onlyWithHistory = false }: { value: Asset | null; onChange: (a: Asset) => void; label?: string; onlyWithHistory?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [hot, setHot] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { let alive = true; loadCatalog().then(r => { if (alive) setItems(r); }).catch(() => { if (alive) setFailed(true); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const typed = q.trim().toUpperCase();
  const shown = useMemo(() => {
    const n = norm(q);
    const list = items.filter(i => !onlyWithHistory || i.history);
    if (!n) return list.slice(0, 10);
    const score = (i: CatalogItem) => (norm(i.symbol) === n ? 100 : norm(i.symbol).startsWith(n) ? 80 : norm(i.name).startsWith(n) ? 60 : norm(i.symbol).includes(n) ? 40 : norm(i.name).includes(n) ? 30 : 0);
    return list.map(i => ({ i, s: score(i) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 10).map(x => x.i);
  }, [items, q, onlyWithHistory]);
  const canCustom = SYMBOL_PATTERN.test(typed) && !items.some(i => i.symbol === typed);
  const rows: Array<{ kind: 'item'; item: CatalogItem } | { kind: 'custom' }> = [...shown.map(item => ({ kind: 'item' as const, item })), ...(canCustom ? [{ kind: 'custom' as const }] : [])];
  useEffect(() => { setHot(0); }, [q, open]);
  const current = value ? items.find(i => i.symbol === value.symbol) : undefined;
  const pick = (a: Asset) => { onChange(a); setOpen(false); setQ(''); };
  const choose = (r: (typeof rows)[number]) => (r.kind === 'item' ? pick({ symbol: r.item.symbol, assetClass: r.item.assetClass, name: r.item.name }) : pick({ symbol: typed, assetClass: guessClass(typed) }));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(h => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hot]) choose(rows[hot]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className={styles.picker} ref={box}>
      {label ? <label className={styles.formLabel} htmlFor={`${id}-btn`}>{label}</label> : null}
      <button id={`${id}-btn`} type="button" className={styles.pickerField} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(o => !o); setTimeout(() => input.current?.focus(), 0); }}>
        <span>{value ? (current ? current.pair : `${value.symbol} · custom symbol`) : 'Search BTC-USD, TSLA, AAPL…'}</span><ChevronDown size={16} />
      </button>
      {open ? (
        <div className={styles.pickerPanel}>
          <div className={styles.pickerSearch}><Search size={15} /><input ref={input} role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={rows[hot] ? `${id}-o${hot}` : undefined} aria-label="Search assets" autoComplete="off" spellCheck={false} maxLength={30} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type a symbol or name (BTC, tesla, EUR)" /></div>
          <ul id={`${id}-list`} role="listbox" className={styles.pickerList}>
            {rows.map((r, i) => (
              <li key={r.kind === 'item' ? r.item.symbol : 'custom'} id={`${id}-o${i}`} role="option" aria-selected={r.kind === 'item' && value?.symbol === r.item.symbol} className={`${styles.pickerRow} ${i === hot ? styles.pickerHot : ''}`} onMouseEnter={() => setHot(i)} onMouseDown={e => { e.preventDefault(); choose(r); }}>
                {r.kind === 'item' ? <>
                  <div><strong>{r.item.symbol}</strong> <span>· {r.item.name}</span><small>{CLASS_LABEL[r.item.assetClass]}{r.item.live ? '' : ' · needs a data key on the server'}{r.item.live && !r.item.history ? ' · no chart history yet' : ''}</small></div>
                  {value?.symbol === r.item.symbol ? <Check size={15} /> : null}
                </> : <strong className={styles.link}>Use “{typed}” as a custom symbol</strong>}
              </li>
            ))}
            {!rows.length ? <li className={styles.pickerEmpty}>{failed ? "Couldn't load the asset list. Check your connection." : 'No match. Try a ticker like TSLA.'}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
