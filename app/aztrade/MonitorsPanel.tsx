'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChartCandlestick, ListChecks, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import styles from './aztrade.module.css';
import { AssetPicker } from './AssetPicker';
import { PriceChart, type NewAlert } from './PriceChart';
import { Sparkline } from './Sparkline';
import { createMonitor, deleteMonitor, explain, fetchSparklines, listMonitors, patchMonitor } from './api';
import { fmtNum, fmtWhen, percentOk, ruleLine, unitFor, type AlertRow, type Asset, type Recurrence, type Rule, type RuleType, type Spark } from './logic';

const TYPES: { id: RuleType; label: string }[] = [{ id: 'price_below', label: 'Crosses below' }, { id: 'price_above', label: 'Crosses above' }, { id: 'pct_drop_24h', label: 'Drops by (24h)' }, { id: 'pct_rise_24h', label: 'Rises by (24h)' }];
const recurrenceHelp = (r: Recurrence) => (r === 'once' ? 'Alerts one time, then waits until you re-arm it.' : 'Alerts every time the price crosses your level. The first check only sets the starting side.');

function Segment({ value, onPick, name }: { value: Recurrence; onPick: (r: Recurrence) => void; name: string }) {
  return (
    <div className={styles.seg} role="radiogroup" aria-label="Recurrence">
      {([['once', 'Once'], ['each_crossing', 'Each crossing']] as [Recurrence, string][]).map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} name={name} className={value === id ? styles.segOn : ''} onClick={() => onPick(id)}>{label}</button>
      ))}
    </div>
  );
}

/** "Monitor this for me": price and 24-hour-move rules the server checks on a schedule; alerts arrive in Notifications. */
export function MonitorsPanel({ seed, onCount }: { seed?: Asset | null; onCount?: (n: number) => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [asset, setAsset] = useState<Asset>(seed ?? { symbol: 'BTC-USD', assetClass: 'crypto' });
  const [type, setType] = useState<RuleType>('price_below');
  const [threshold, setThreshold] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ type: RuleType; threshold: string; recurrence: Recurrence }>({ type: 'price_below', threshold: '', recurrence: 'once' });
  const [activityId, setActivityId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [explainId, setExplainId] = useState<string | null>(null);
  const [spark, setSpark] = useState<Record<string, Spark>>({});
  const [chartRule, setChartRule] = useState<Rule | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => { if (seed) setAsset(seed); }, [seed?.symbol, seed?.assetClass]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = (list: Rule[]) => list.filter(x => x.status === 'active' || x.status === 'stale_feed').length;
  const load = useCallback(async () => {
    try { const r = await listMonitors(); setRules(r.rules); setAlerts(r.alerts); onCount?.(active(r.rules)); }
    catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const sparkKey = [...new Set(rules.map(r => `${r.asset_class}:${r.symbol}`))].sort().join(',');
  useEffect(() => {
    if (!sparkKey) return;
    let alive = true;
    const items = sparkKey.split(',').map(k => { const [assetClass, ...sym] = k.split(':'); return { assetClass: assetClass as Asset['assetClass'], symbol: sym.join(':') }; });
    fetchSparklines(items).then(r => { if (alive) setSpark(Object.fromEntries(r.results.map(x => [`${x.assetClass}:${x.symbol}`, x]))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [sparkKey]);

  useEffect(() => { const d = dialog.current; if (!d) return; if (chartRule && !d.open) d.showModal(); if (!chartRule && d.open) d.close(); }, [chartRule]);

  const pctBlocked = type.startsWith('pct_') && !percentOk(asset.assetClass);
  const canSave = !saving && Number(threshold) > 0 && !pctBlocked;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true); setError('');
    try {
      const out = await createMonitor({ symbol: asset.symbol, assetClass: asset.assetClass, ruleType: type, threshold: Number(threshold), recurrence });
      setRules(prev => { const next = [out.rule, ...prev]; onCount?.(active(next)); return next; });
      setThreshold('');
    } catch (err) { setError(explain(err)); }
    finally { setSaving(false); }
  }
  async function toggle(r: Rule) {
    try { const out = await patchMonitor(r.id, { status: r.status === 'paused' || r.status === 'triggered' ? 'active' : 'paused' }); setRules(prev => prev.map(x => (x.id === r.id ? out.rule : x))); void load(); }
    catch (err) { setError(explain(err)); }
  }
  async function saveEdit(r: Rule) {
    if (!(Number(edit.threshold) > 0)) { setError('Enter a number above zero.'); return; }
    setError('');
    try { const out = await patchMonitor(r.id, { ruleType: edit.type, threshold: Number(edit.threshold), recurrence: edit.recurrence }); setRules(prev => { const next = prev.map(x => (x.id === r.id ? out.rule : x)); onCount?.(active(next)); return next; }); setEditId(null); }
    catch (err) { setError(explain(err)); }
  }
  async function remove(r: Rule) {
    if (!window.confirm(`Delete the ${r.symbol} monitor? It stops checking and its alert history is removed.`)) return;
    try { await deleteMonitor(r.id); setRules(prev => { const next = prev.filter(x => x.id !== r.id); onCount?.(active(next)); return next; }); }
    catch (err) { setError(explain(err)); }
  }
  async function createFromChart(r: NewAlert) {
    if (!chartRule) return;
    const out = await createMonitor({ symbol: chartRule.symbol, assetClass: chartRule.asset_class, ruleType: r.ruleType, threshold: r.threshold, recurrence: r.recurrence });
    setRules(prev => { const next = [out.rule, ...prev]; onCount?.(active(next)); return next; });
  }

  const tone = (st: Rule['status']) => (st === 'active' ? { cls: styles.badgeOk, t: 'Active' } : st === 'triggered' ? { cls: styles.badgeErr, t: 'Triggered' } : st === 'stale_feed' ? { cls: styles.badgeWarn, t: 'Stale feed' } : { cls: styles.badgeOff, t: 'Paused' });
  const explainAlert = (a: AlertRow) => {
    const cl = rules.find(r => r.id === a.rule_id)?.asset_class ?? 'crypto';
    return (
      <dl className={styles.explain}>
        <dt>What happened</dt><dd>{a.message}</dd>
        {a.rule_type ? <><dt>Your rule then</dt><dd>{ruleLine({ rule_type: a.rule_type, threshold: a.threshold ?? '0', recurrence: a.recurrence }, cl)}</dd></> : null}
        <dt>Quote used</dt><dd>{fmtNum(a.observed_price)}{a.change_pct != null ? `  ·  24h change ${Number(a.change_pct) >= 0 ? '+' : ''}${Number(a.change_pct).toFixed(2)}%` : ''}</dd>
        <dt>Quote as of</dt><dd>{a.quote_as_of ? fmtWhen(a.quote_as_of) : 'Not provided by the source'}</dd>
        <dt>Source</dt><dd>{a.source}</dd>
        <dt>Alert sent</dt><dd>{fmtWhen(a.created_at)}</dd>
        <dd className={styles.muted}>Delayed, informational quote from a free public source. Not advice, and nothing is traded.</dd>
      </dl>
    );
  };
  const alertList = (list: AlertRow[]) => (list.length ? list.slice(0, 10).map(a => (
    <div key={a.id} className={styles.alertItem}>
      <button type="button" className={styles.alertRow} aria-expanded={explainId === a.id} onClick={() => setExplainId(explainId === a.id ? null : a.id)}>
        <span><small>{fmtWhen(a.created_at)} · {a.symbol}</small>{a.message}</span><strong className={styles.link}>{explainId === a.id ? 'Hide' : 'Explain'}</strong>
      </button>
      {explainId === a.id ? explainAlert(a) : null}
    </div>
  )) : <p className={styles.muted}>No alerts yet.</p>);

  return (
    <div className={styles.stackWide}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><h2><Bell size={18} />Monitor this for me</h2><span className={styles.tagWarn}>Delayed quotes</span></div>
        <form className={styles.panelBody} onSubmit={create}>
          <div className={styles.monForm}>
            <AssetPicker value={asset} onChange={a => { setAsset(a); if (type.startsWith('pct_') && !percentOk(a.assetClass)) setType('price_below'); }} />
            <label className={styles.field}>Condition
              <select value={type} onChange={e => setType(e.target.value as RuleType)}>
                {TYPES.map(t => <option key={t.id} value={t.id} disabled={t.id.startsWith('pct_') && !percentOk(asset.assetClass)}>{t.label}{t.id.startsWith('pct_') && !percentOk(asset.assetClass) ? ' (crypto and stocks only)' : ''}</option>)}
              </select>
            </label>
            <label className={styles.field}>{type.startsWith('pct_') ? 'Percent' : 'Price'}
              <span className={styles.suffix}><input inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} maxLength={14} placeholder={type.startsWith('pct_') ? '3' : '60000'} aria-label="Threshold" /><em>{unitFor(type, asset.assetClass)}</em></span>
            </label>
            <div className={styles.field}><span>Recurrence</span><Segment value={recurrence} onPick={setRecurrence} name="recurrence" /></div>
          </div>
          <p className={styles.muted}>{recurrenceHelp(recurrence)}</p>
          {pctBlocked ? <p className={styles.muted} style={{ color: '#92400e' }}>Forex and commodities don't report a 24-hour change. Use a price rule.</p> : null}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <button type="submit" className={styles.primaryButton} disabled={!canSave}>{saving ? 'Activating…' : 'Activate monitor'}</button>
        </form>
      </section>

      <div className={styles.monHead}><h2>Your monitors</h2><span>{rules.length} / 15</span></div>
      {loading ? <p className={styles.muted}>Loading…</p> : rules.length === 0 ? <div className={styles.empty}><span>No monitors yet. Add one above, or open a chart in Markets and set an alert from it.</span></div> : (
        <div className={styles.monGrid}>
          {rules.map(r => {
            const t = tone(r.status); const editing = editId === r.id; const sp = spark[`${r.asset_class}:${r.symbol}`];
            return (
              <article key={r.id} className={styles.monCard}>
                <header><strong>{r.symbol}</strong><span><em className={t.cls}>{t.t}</em><em className={styles.badgeWarn}>Delayed quotes</em></span></header>
                <p className={styles.muted}>{ruleLine(r, r.asset_class)}</p>
                {editing ? (
                  <div className={styles.monEdit}>
                    <label className={styles.field}>Condition<select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as RuleType })}>{TYPES.map(x => <option key={x.id} value={x.id} disabled={x.id.startsWith('pct_') && !percentOk(r.asset_class)}>{x.label}</option>)}</select></label>
                    <label className={styles.field}>{edit.type.startsWith('pct_') ? 'Percent' : 'Price'}<span className={styles.suffix}><input inputMode="decimal" value={edit.threshold} onChange={e => setEdit({ ...edit, threshold: e.target.value })} maxLength={14} aria-label="New threshold" /><em>{unitFor(edit.type, r.asset_class)}</em></span></label>
                    <div className={styles.field}><span>Recurrence</span><Segment value={edit.recurrence} onPick={rc => setEdit({ ...edit, recurrence: rc })} name={`rec-${r.id}`} /></div>
                    <p className={styles.muted}>Saving re-arms this monitor from scratch.</p>
                    <div className={styles.formActions}><span /><div><button type="button" className={styles.secondaryButton} onClick={() => setEditId(null)}>Cancel</button><button type="button" className={styles.primaryButton} onClick={() => void saveEdit(r)}>Save</button></div></div>
                  </div>
                ) : (
                  <>
                    <button type="button" className={styles.sparkBtn} onClick={() => setChartRule(r)} aria-label={`Open the ${r.symbol} chart`}>
                      <span><strong>{sp?.range === '1W' ? '7-day price trend' : '24h price trend'}</strong> <small>· delayed</small></span><em className={styles.link}>Open chart ›</em>
                      {sp && sp.points.length > 1 ? <>
                        <Sparkline points={sp.points} height={44} color={sp.changePct != null && sp.changePct < 0 ? '#dc2626' : '#4f46e5'} fill={sp.changePct != null && sp.changePct < 0 ? '#fee2e2' : '#eef2ff'} />
                        {sp.changePct != null ? <small style={{ color: sp.changePct >= 0 ? '#059669' : '#dc2626', fontWeight: 700 }}>{sp.changePct >= 0 ? '▲ +' : '▼ '}{Math.abs(sp.changePct).toFixed(2)}%</small> : null}
                      </> : <small className={styles.muted}>{sp ? (sp.error === 'PROVIDER_NOT_CONFIGURED' ? 'No history source is set up for this asset yet.' : 'Trend unavailable right now.') : 'Loading trend…'}</small>}
                    </button>
                    <div className={styles.kvList}>
                      <div><span>Last successful check</span><strong>{r.last_checked_at ? fmtWhen(r.last_checked_at) : 'Waiting for the first check'}</strong></div>
                      <div><span>Quote as of</span><strong>{r.last_quote_as_of ? fmtWhen(r.last_quote_as_of) : r.last_checked_at ? 'Not provided by source' : '—'}</strong></div>
                      <div><span>Last price</span><strong>{r.last_price ? fmtNum(r.last_price) : '—'}</strong></div>
                      <div><span>Source</span><strong>{r.last_source ?? '—'}</strong></div>
                    </div>
                    <p className={styles.muted}><Bell size={13} /> In-app alerts</p>
                    {r.status === 'stale_feed' && r.stale_reason ? <p className={styles.warnText}>⚠ {r.stale_reason}. It rechecks automatically.</p> : null}
                    {r.status === 'triggered' && r.triggered_at ? <p className={styles.errText}>Triggered {fmtWhen(r.triggered_at)}. Re-arm to watch again.</p> : null}
                    <div className={styles.monActions}>
                      <button type="button" onClick={() => setActivityId(activityId === r.id ? null : r.id)}><ListChecks size={14} /> Activity</button>
                      <button type="button" onClick={() => void toggle(r)}>{r.status === 'paused' || r.status === 'triggered' ? <><Play size={14} /> Re-arm</> : <><Pause size={14} /> Pause</>}</button>
                      <button type="button" onClick={() => { setEditId(r.id); setEdit({ type: r.rule_type, threshold: String(Number(r.threshold)), recurrence: r.recurrence }); }}><Pencil size={14} /> Edit</button>
                      <button type="button" onClick={() => setChartRule(r)}><ChartCandlestick size={14} /> Chart</button>
                      <button type="button" aria-label={`Delete ${r.symbol} monitor`} onClick={() => void remove(r)}><Trash2 size={14} /></button>
                    </div>
                    {activityId === r.id ? <div className={styles.alertList}>{alertList(alerts.filter(a => a.rule_id === r.id))}</div> : null}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <section className={styles.band}>
        <button type="button" className={styles.bandHead} aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
          <span><strong>Alert activity</strong><small>See the quote and rule behind an alert.</small></span><em className={styles.link}>Explain this alert ›</em>
        </button>
        {showAll ? <div className={styles.alertList}>{alertList(alerts)}</div> : null}
      </section>
      <p className={styles.muted}>Alerts appear in your Notifications (the bell). Prices are delayed, informational quotes from free public sources, so an alert can lag the market. This is not advice and nothing is traded. Lock-screen push is not set up yet.</p>

      <dialog ref={dialog} className={styles.dialog} onClose={() => setChartRule(null)} onClick={e => { if (e.target === dialog.current) setChartRule(null); }} aria-label="Monitor chart">
        {chartRule ? (
          <div className={styles.dialogBody}>
            <div className={styles.dialogHead}><div><strong>{chartRule.symbol} chart</strong><small>{ruleLine(chartRule, chartRule.asset_class)}</small></div><button type="button" className={styles.iconButton} aria-label="Close chart" onClick={() => setChartRule(null)}><X size={18} /></button></div>
            <PriceChart asset={{ symbol: chartRule.symbol, assetClass: chartRule.asset_class }} rule={chartRule}
              alerts={alerts.filter(a => a.rule_id === chartRule.id).map(a => ({ id: a.id, created_at: a.created_at, observed_price: a.observed_price, source: a.source, message: a.message, quote_as_of: a.quote_as_of, symbol: a.symbol }))}
              lastPrice={chartRule.last_price ? Number(chartRule.last_price) : null} onCreateAlert={createFromChart} />
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
