'use client';

import { Landmark, PieChart as PieIcon, ShieldCheck, Wallet } from 'lucide-react';
import styles from './aztrade.module.css';
import { fmtMoney, fmtNum, type Valuation } from './logic';

const ORDER = ['Equities', 'Crypto', 'Forex', 'Commodities', 'Cash'];
const COLORS: Record<string, string> = { Equities: '#4f46e5', Crypto: '#f59e0b', Forex: '#0891b2', Commodities: '#ca8a04', Cash: '#94a3b8' };

/** The practice account, valued with delayed informational prices. A valuation is called complete only when every holding has a price. */
export function PortfolioPanel({ valuation, connected, positionCount }: { valuation: Valuation | null; connected: boolean; positionCount: number }) {
  const v = valuation;
  return (
    <div className={styles.stackWide}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2><Landmark size={18} />Account connection</h2></div>
        <div className={styles.panelBody}>
          <p>{connected && v ? 'Practice account connected. View-only, simulated funds.' : 'No practice account connected.'}</p>
          <p className={styles.muted}>✓ Read-only (no trading)  ·  ✓ Sync holdings &amp; balance</p>
          <button type="button" disabled className={styles.disabledButton}>Connect broker — not available yet</button>
          <p className={styles.muted}>Broker connections aren't available yet. Nothing is requested from you.</p>
        </div>
      </section>

      <div className={styles.metricGrid}>
        <div className={styles.metric}><div className={styles.metricTop}><span>Total value</span><Wallet size={19} /></div><strong>{v?.complete ? fmtMoney(v.total) : 'Unavailable'}</strong>
          <small>{v?.complete ? (v.rows.length ? 'Cash plus holdings at delayed, informational prices.' : 'Practice cash only. No holdings yet.') : v ? `Needs a price for: ${v.missing.slice(0, 4).join(', ')}` : 'Appears once an account is connected.'}</small></div>
        <div className={styles.metric}><div className={styles.metricTop}><span>Cash balance</span><Wallet size={19} /></div><strong>{v ? fmtMoney(v.cash) : 'Unavailable'}</strong><small>{v ? 'Simulated practice cash. Not real money.' : 'Appears once an account is connected.'}</small></div>
        <div className={styles.metric}><div className={styles.metricTop}><span>Holdings</span><PieIcon size={19} /></div><strong>{connected ? positionCount : '—'}</strong><small>Practice positions</small></div>
        <div className={styles.metric}><div className={styles.metricTop}><span>Concentration</span><ShieldCheck size={19} /></div><strong>{v?.largest != null ? `${v.largest.toFixed(0)}%` : 'N/A'}</strong>
          <small>{v?.largest != null ? 'Largest single position.' : v && !v.rows.length ? 'No positions to measure.' : v && !v.complete ? 'Needs a price for every holding.' : 'Needs a connected account.'}</small></div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2><PieIcon size={18} />Asset allocation</h2></div>
        <div className={styles.panelBody}>
          {v?.complete && v.total > 0 ? <>
            <div className={styles.allocBar} role="img" aria-label="Allocation by asset class">{ORDER.map(k => { const p = v.pct(v.byClass[k] ?? 0); return p > 0 ? <span key={k} style={{ width: `${p}%`, background: COLORS[k] }} title={`${k} ${p.toFixed(1)}%`} /> : null; })}</div>
            <div className={styles.allocLegend}>{ORDER.map(k => <div key={k}><i style={{ background: COLORS[k] }} />{k}<strong>{v.pct(v.byClass[k] ?? 0).toFixed(1)}%</strong></div>)}</div>
          </> : <p className={styles.muted}>Not available until every holding has a delayed price.</p>}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Holdings</h2><span className={styles.muted}>{connected ? 'Practice' : 'Not connected'}</span></div>
        <div className={styles.panelBody}>
          {!v ? <div className={styles.empty}><span>Connect your A-Zee account and the paper backend to view positions.</span></div>
            : v.rows.length === 0 ? <div className={styles.empty}><span>No practice holdings are recorded for this account.</span></div>
            : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Symbol</th><th>Quantity</th><th>Price</th><th>Value (USD)</th><th>Exposure</th></tr></thead><tbody>
              {v.rows.map(r => <tr key={r.symbol}><td>{r.symbol}</td><td>{Number.isFinite(r.qty) ? fmtNum(r.qty) : '—'}</td><td>{r.price != null ? fmtNum(r.price) : 'Unavailable'}</td><td>{r.value != null ? fmtMoney(r.value) : '—'}</td><td>{v.complete && r.value != null ? `${v.pct(r.value).toFixed(1)}%` : '—'}</td></tr>)}
            </tbody></table></div>}
          <p className={styles.muted}>Values use delayed, informational prices, not a licensed feed. Holdings come from your practice account, and from a read-only broker later.</p>
        </div>
      </section>
    </div>
  );
}
