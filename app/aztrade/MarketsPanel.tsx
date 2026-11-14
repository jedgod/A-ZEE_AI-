'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, ChartCandlestick, Database, RefreshCw, Trash2 } from 'lucide-react';
import styles from './aztrade.module.css';
import { AssetPicker } from './AssetPicker';
import { PriceChart, type NewAlert } from './PriceChart';
import { Sparkline } from './Sparkline';
import { createMonitor, fetchSparklines, loadCatalog, REASONS } from './api';
import { CLASS_LABEL, changeOf, fmtPrice, type Asset, type AssetClass, type QuoteState, type Spark, type WatchItem } from './logic';

/** Markets: the watchlist with delayed, informational prices and trend lines, and an interactive chart for any supported asset. */
export function MarketsPanel({ watch, onAdd, onRemove, quotes, quotesBusy, reloadQuotes, marketsLive, onMonitor, onMonitorCreated }: {
  watch: WatchItem[]; onAdd: (a: Asset) => void; onRemove: (symbol: string) => void; quotes: QuoteState; quotesBusy: boolean; reloadQuotes: () => void;
  marketsLive: boolean; onMonitor: (a: Asset) => void; onMonitorCreated: () => void;
}) {
  const [filter, setFilter] = useState<AssetClass | 'all'>('all');
  const [chartAsset, setChartAsset] = useState<Asset>({ symbol: 'BTC-USD', assetClass: 'crypto' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [spark, setSpark] = useState<Record<string, Spark>>({});
  const [showSources, setShowSources] = useState(false);
  useEffect(() => { loadCatalog().then(r => setNames(Object.fromEntries(r.map(i => [i.symbol, i.name])))).catch(() => undefined); }, []);

  const shown = useMemo(() => (filter === 'all' ? watch : watch.filter(w => w.assetClass === filter)), [watch, filter]);
  const sparkKey = watch.map(w => `${w.assetClass}:${w.symbol}`).join(',');
  useEffect(() => {
    if (!sparkKey) return;
    let alive = true;
    fetchSparklines(watch.slice(0, 20)).then(r => { if (alive) setSpark(Object.fromEntries(r.results.map(x => [x.symbol, x]))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [sparkKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyPriced = Object.values(quotes).some(q => q.quote?.price != null);
  const priced = watch.filter(w => quotes[w.symbol]?.quote?.price != null).length;

  return (
    <div className={styles.stackWide}>
      <div className={styles.banner}>
        <Database size={20} />
        <div><strong>Market data: {marketsLive ? 'Connected' : anyPriced ? 'Informational · Delayed' : 'Not connected'}</strong>
          <p>{marketsLive ? 'A verified data source is connected.' : anyPriced ? 'Delayed quotes from free public sources. Not a licensed feed; no signals or trades use them.' : 'No quotes could be loaded right now.'}</p></div>
        <button type="button" className={styles.secondaryButton} onClick={() => setShowSources(v => !v)} aria-expanded={showSources}>Data sources</button>
      </div>
      {showSources ? <p className={styles.callout}>Prices here are delayed quotes from free public sources through A-Zee (crypto and forex need no key; stocks, ETFs and gold need a key on the server). They are informational only: not licensed for trading, and never used for AZTrade signals, regime, backtests or orders. A licensed feed can be connected later.</p> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>My watchlist ({watch.length})</h2>
          <span className={styles.rowGap}>
            <label className={styles.inlineSel}>Show <select value={filter} onChange={e => setFilter(e.target.value as AssetClass | 'all')}><option value="all">All</option>{(Object.keys(CLASS_LABEL) as AssetClass[]).map(c => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select></label>
            <button type="button" className={styles.secondaryButton} onClick={reloadQuotes} disabled={quotesBusy}><RefreshCw size={14} className={quotesBusy ? styles.spin : undefined} /> Prices</button>
          </span></div>
        <div className={styles.panelBody}>
          <div className={styles.addRow}><AssetPicker value={null} onChange={onAdd} label="Add to watchlist" /></div>
          {shown.length === 0 ? <div className={styles.empty}><span>Nothing here yet. Search above to add a symbol.</span></div> : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Asset</th><th>Price</th><th>24h</th><th>Trend</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {shown.map(w => {
                    const st = quotes[w.symbol]; const price = st?.quote?.price; const ch = changeOf(st?.quote); const sp = spark[w.symbol];
                    return (
                      <tr key={w.symbol}>
                        <td><strong>{w.symbol}</strong><div className={styles.muted}>{names[w.symbol] ?? CLASS_LABEL[w.assetClass]}</div></td>
                        <td>{price != null ? <strong>{fmtPrice(price, w.assetClass === 'forex')}</strong> : quotesBusy && !st ? 'Loading…' : <span title={REASONS[st?.error ?? ''] ?? 'No data source'}>Price unavailable<div className={styles.muted}>{REASONS[st?.error ?? ''] ?? 'No data source'}</div></span>}</td>
                        <td>{ch != null ? <span style={{ color: ch >= 0 ? '#059669' : '#dc2626', fontWeight: 700 }}>{ch >= 0 ? '▲ +' : '▼ '}{Math.abs(ch).toFixed(2)}%</span> : price != null ? <span className={styles.muted}>Delayed</span> : '—'}</td>
                        <td className={styles.sparkCell}>{sp && sp.points.length > 1 ? <Sparkline points={sp.points} height={34} color={sp.changePct != null && sp.changePct < 0 ? '#dc2626' : '#4f46e5'} fill={sp.changePct != null && sp.changePct < 0 ? '#fee2e2' : '#eef2ff'} label={`${w.symbol} trend`} /> : <span className={styles.muted}>{sp ? '—' : ''}</span>}</td>
                        <td className={styles.rowActions}>
                          <button type="button" title="Open chart" aria-label={`Open the ${w.symbol} chart`} onClick={() => { setChartAsset({ symbol: w.symbol, assetClass: w.assetClass }); document.getElementById('aztrade-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><ChartCandlestick size={15} /></button>
                          <button type="button" title="Monitor this" aria-label={`Monitor ${w.symbol}`} onClick={() => onMonitor({ symbol: w.symbol, assetClass: w.assetClass })}><Bell size={15} /></button>
                          <button type="button" title="Remove" aria-label={`Remove ${w.symbol}`} onClick={() => onRemove(w.symbol)}><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.muted}>{priced} of {watch.length} priced. Prices are delayed, informational quotes and not a licensed feed. Symbols without a quote need a data key on the server. Your watchlist is saved in this browser.</p>
        </div>
      </section>

      <section className={styles.panel} id="aztrade-chart">
        <div className={styles.panelHead}><h2><ChartCandlestick size={18} />Chart</h2></div>
        <div className={styles.panelBody}>
          <PriceChart asset={chartAsset} onAssetChange={setChartAsset}
            onCreateAlert={async (r: NewAlert) => { await createMonitor({ symbol: chartAsset.symbol, assetClass: chartAsset.assetClass, ruleType: r.ruleType, threshold: r.threshold, recurrence: r.recurrence }); onMonitorCreated(); }} />
        </div>
      </section>
    </div>
  );
}
