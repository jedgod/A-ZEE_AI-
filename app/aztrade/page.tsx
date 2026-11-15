'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, Bot, CheckCircle2,
  ChevronRight, CircleAlert, Clock3, FlaskConical, Globe2, Landmark,
  Layers3, LoaderCircle, LockKeyhole, Menu, PieChart, PlugZap, RefreshCw,
  Search, Send, ShieldCheck, Sparkles, TrendingUp, Wallet, X,
} from 'lucide-react';
import styles from './aztrade.module.css';
import { MarketsPanel } from './MarketsPanel';
import { MonitorsPanel } from './MonitorsPanel';
import { PortfolioPanel } from './PortfolioPanel';
import { currentUser, unreadCount } from './api';
import { useQuotes, useWatchlist } from './hooks';
import { valuate, type Asset } from './logic';
import { ReplyView } from './ReplyView';

type Section = 'overview' | 'research' | 'markets' | 'portfolio' | 'monitors' | 'strategies' | 'risk' | 'brokers' | 'history';
type CapabilityResponse = {
  product: string; plan: string; tier: string;
  capabilities: {
    marketData: 'unavailable' | 'licensed';
    brokerConnections: 'unavailable' | 'read_only';
    historicalBacktests: 'unavailable' | 'certified';
    researchAssistant: boolean;
    paperExecution: false; liveExecution: false;
  };
};
type RecordValue = Record<string, unknown>;
type Portfolio = { cash?: string; positions?: RecordValue[]; history?: RecordValue[]; accountId?: string };
type HistoryMessage = { role: string; content: string; created_at?: string };
type Session = { access_token: string; expires_in: number };
type Entitlements = {
  plan: string; tier: string; aiAssistant: boolean; backtesting: boolean;
  maximumBacktestBars: number; maximumBacktestRunsPerDay: number; maximumResearchPerDay: number;
  daily?: { backtest: { used: number; limit: number }; research: { used: number; limit: number } };
  marketData: { configured: boolean };
  paperExecutionEnabled?: boolean; realMoneyTradingEnabled?: boolean;
};
type Intelligence = { researchAvailable?: boolean; marketDataConfigured?: boolean };
type RiskReport = { status?: string; missingSymbols?: string[]; totals?: { currency: string; marketValue: number; largestPositionPct: number; byAssetClassPct: Record<string, number> } | null };

const menus: Array<{ key: Section; label: string; icon: typeof BarChart3 }> = [
  { key: 'overview', label: 'Overview', icon: Layers3 },
  { key: 'research', label: 'AI Research', icon: Sparkles },
  { key: 'markets', label: 'Markets', icon: Globe2 },
  { key: 'portfolio', label: 'Portfolio', icon: Wallet },
  { key: 'monitors', label: 'Monitors', icon: Bell },
  { key: 'strategies', label: 'Strategies & backtests', icon: FlaskConical },
  { key: 'risk', label: 'Risk intelligence', icon: ShieldCheck },
  { key: 'brokers', label: 'Broker connections', icon: PlugZap },
  { key: 'history', label: 'Assistant history', icon: Clock3 },
];
const instruments = ['Stocks', 'ETFs', 'Crypto', 'Forex', 'Commodities', 'Options', 'Futures'];
const samples = [
  'Explain concentration risk between stocks and cryptocurrency.',
  'What should I check before choosing an ETF?',
  'Explain how interest rates can influence currencies.',
];
function safeString(input: unknown): string { return typeof input === 'string' ? input : typeof input === 'number' && Number.isFinite(input) ? String(input) : '—'; }
function formatAmount(raw: unknown) {
  const n = Number(raw);
  return raw == null || raw === '' || !Number.isFinite(n) ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}
function explainError(code: unknown): string {
  const key = typeof code === 'string' ? code : '';
  const messages: Record<string, string> = {
    SIGN_IN_REQUIRED: 'Sign in to your A-Zee account to continue.',
    SIGN_IN_REQUIRED_OR_UNVERIFIED: 'Sign in and verify your A-Zee email address.',
    SESSION_REVOKED: 'Your session expired or was revoked. Please sign in again.',
    AZTRADE_TOKEN_REQUIRED: 'AZTrade session required. Reconnect and try again.',
    FEATURE_DISABLED: 'AZTrade AI is not enabled on this server.',
    AZTRADE_UNAVAILABLE: 'The AZTrade service is unavailable right now.',
    RATE_LIMITED: 'Too many requests. Try again shortly.',
    DAILY_LIMIT_REACHED: "You've used today's AZTrade AI questions. Try again tomorrow.",
    PLAN_LIMIT_REACHED: "Your plan's AZTrade AI allowance is used up.",
    UPGRADE_REQUIRED: 'AZTrade AI needs a paid plan.',
    AI_UNAVAILABLE: 'The AI service is unavailable right now. Try again soon.',
  };
  return messages[key] || (key ? `Request unavailable (${key.replace(/[^A-Z0-9_ -]/gi, '').slice(0, 70)}).` : 'Request unavailable.');
}

export default function AZTradePage() {
  const [section, setSection] = useState<Section>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [intel, setIntel] = useState<Intelligence | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState('Checking your A-Zee session…');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [risk, setRisk] = useState<unknown>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataIssue, setDataIssue] = useState('');
  const pendingAI = useRef<AbortController | null>(null);
  const abortAll = useRef<AbortController | null>(null);
  const [userKey, setUserKey] = useState('guest');
  const [unread, setUnread] = useState(0);
  const [monitorCount, setMonitorCount] = useState<number | null>(null);
  const [monitorSeed, setMonitorSeed] = useState<Asset | null>(null);
  const watch = useWatchlist(userKey);
  useEffect(() => { currentUser().then(r => { if (r.user?.id) setUserKey(r.user.id); }).catch(() => undefined); unreadCount().then(r => setUnread(r.count)).catch(() => undefined); }, []);

  const connect = useCallback(async (signal?: AbortSignal): Promise<string> => {
    // A-Zee's existing same-origin session authenticates both requests.
    const [caps, minted] = await Promise.all([
      fetch('/api/aztrade/capabilities', { credentials: 'same-origin', cache: 'no-store', signal }),
      fetch('/api/aztrade/token', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}', signal }),
    ]);
    if (!caps.ok || !minted.ok) {
      const failed = !caps.ok ? caps : minted;
      const data = await failed.json().catch(() => ({}));
      throw new Error(explainError(data.error || 'SIGN_IN_REQUIRED'));
    }
    const c: CapabilityResponse = await caps.json();
    const s: Session = await minted.json();
    if (typeof s.access_token !== 'string' || typeof c.plan !== 'string' || !c.capabilities) throw new Error('Invalid authorization response.');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // The same subscription record the mobile app reads: plan, limits and today's usage.
    const ent = await fetch('/api/aztrade/entitlements', { headers: { Authorization: `Bearer ${s.access_token}` }, cache: 'no-store', signal }).then(r => r.ok ? r.json() : null).catch(() => null);
    setEntitlements(ent && typeof ent.plan === 'string' ? ent as Entitlements : null);
    tokenRef.current = s.access_token;
    setToken(s.access_token);
    setCapabilities(c);
    setConnected(true);
    setStatus('Research available · Market data and execution are subject to certification');
    return s.access_token;
  }, []);

  const proxy = useCallback(async (resource: string, activeToken: string, signal: AbortSignal, payload?: unknown) => {
    const method = payload ? 'POST' : 'GET';
    const response = await fetch(`/api/aztrade/companion?resource=${encodeURIComponent(resource)}`, {
      method, credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'X-AZTrade-Token': `Bearer ${activeToken}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(explainError(data.error)), { status: response.status });
    return data as unknown;
  }, []);

  const loadData = useCallback(async (activeToken: string, signal: AbortSignal) => {
    setDataBusy(true);
    const [p, r, h, i] = await Promise.allSettled([
      proxy('paper', activeToken, signal), proxy('intelligence/portfolio/risk', activeToken, signal), proxy('assistant/history', activeToken, signal), proxy('intelligence/status', activeToken, signal),
    ]);
    if (signal.aborted) return;
    setPortfolio(p.status === 'fulfilled' && p.value && typeof p.value === 'object' && !Array.isArray(p.value) ? p.value as Portfolio : null);
    setRisk(r.status === 'fulfilled' ? r.value : null);
    setIntel(i.status === 'fulfilled' && i.value && typeof i.value === 'object' ? i.value as Intelligence : null);
    setHistory(h.status === 'fulfilled' && Array.isArray(h.value) ? h.value.filter((x): x is HistoryMessage => !!x && typeof x === 'object' && typeof x.role === 'string' && typeof x.content === 'string').slice(-50) : []);
    setDataIssue([p,r,h,i].some(v => v.status === 'rejected') ? 'Some account services could not be reached; unavailable values are hidden.' : '');
    setDataBusy(false);
  }, [proxy]);

  useEffect(() => {
    const controller = new AbortController();
    abortAll.current = controller;
    connect(controller.signal).then(t => loadData(t, controller.signal)).catch(e => {
      if (!controller.signal.aborted) {
        setConnected(false); setStatus(e instanceof Error ? e.message : 'Authentication unavailable.');
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pendingAI.current?.abort(); tokenRef.current = null; };
  }, [connect, loadData]);

  async function refresh() {
    if (dataBusy) return;
    abortAll.current?.abort();
    const controller = new AbortController(); abortAll.current = controller;
    try { const t = await connect(controller.signal); await loadData(t, controller.signal); }
    catch(e) { if (!controller.signal.aborted) setDataIssue(e instanceof Error ? e.message : 'Refresh unavailable.'); }
  }

  async function submitResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = question.trim();
    if (!message || aiBusy || !connected || !capabilities?.capabilities.researchAssistant) return;
    const requestId = crypto.randomUUID();
    const controller = new AbortController(); pendingAI.current = controller;
    setAiBusy(true); setAnswer(''); setStatus('A-Zee AI is analyzing your question…');
    try {
      let activeToken = tokenRef.current;
      if (!activeToken) activeToken = await connect(controller.signal);
      // Preserve the idempotency key if the token expires. Do not blindly retry network failures.
      async function attempt(t: string) {
        const response = await fetch('/api/aztrade/companion?resource=assistant%2Fchat', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { 'X-AZTrade-Token': `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, message }),
        });
        const body = await response.json().catch(() => ({}));
        return { response, body };
      }
      let result = await attempt(activeToken);
      if (result.response.status === 401) { activeToken = await connect(controller.signal); result = await attempt(activeToken); }
      if (!result.response.ok) throw new Error(explainError(result.body.error));
      if (typeof result.body.reply !== 'string') throw new Error('Invalid AI response.');
      setAnswer(result.body.reply.slice(0, 12000));
      setStatus('AI analysis ready · Verify sources and assumptions before decisions');
      await loadData(activeToken, controller.signal);
      void connect(controller.signal).catch(() => undefined);   // refresh today's usage
    } catch(e) { if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : 'Research unavailable.'); }
    finally { setAiBusy(false); if (pendingAI.current === controller) pendingAI.current = null; }
  }

  const navigate = (key: Section) => { setSection(key); setMenuOpen(false); };
  // Delayed, informational prices for the watchlist and for any practice holdings; the Portfolio and Risk views value the account from them.
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const wanted = useMemo(() => [...watch.items.map(w => ({ symbol: w.symbol, assetClass: w.assetClass })), ...positions.filter(p => typeof p.symbol === 'string').map(p => ({ symbol: String(p.symbol), assetClass: watch.classOf(String(p.symbol)) }))], [watch.items, positions, watch.classOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const { quotes, busy: quotesBusy, reload: reloadQuotes } = useQuotes(wanted, section === 'markets' || section === 'portfolio' || section === 'risk');
  const anyPriced = Object.values(quotes).some(q => q.quote?.price != null);
  const valuation = useMemo(() => (portfolio ? valuate(Number(portfolio.cash), positions.filter(p => typeof p.symbol === 'string').map(p => ({ symbol: String(p.symbol), shares: p.shares })), quotes, watch.classOf) : null), [portfolio, positions, quotes, watch.classOf]); // eslint-disable-line react-hooks/exhaustive-deps
  // The trading state is whatever the server reports, never a fixed label. It is shown red if the server ever says otherwise.
  const verifiedTrading = !!capabilities;
  const liveOff = capabilities?.capabilities.liveExecution === false && entitlements?.realMoneyTradingEnabled !== true;
  const paperOn = entitlements?.paperExecutionEnabled === true;
  const openMonitor = (a: Asset) => { setMonitorSeed(a); navigate('monitors'); };
  const isMarketAvailable = capabilities?.capabilities.marketData === 'licensed' && intel?.marketDataConfigured === true;
  const isBacktestAvailable = capabilities?.capabilities.historicalBacktests === 'certified' && !!entitlements?.backtesting;
  const daily = entitlements?.daily;
  void risk;

  return <main className={styles.shell}>
    <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`} aria-label="AZTrade navigation">
      <div className={styles.brand}><img src="/aztrade-az.png" alt="AZ" className={styles.brandLogo}/><div><strong>AZTrade <span>AI</span></strong><small>Powered by A-Zee</small></div><button className={styles.mobileClose} onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <Link href="/" className={styles.back}><ArrowLeft size={15}/> Back to A-Zee Workspace</Link>
      <div className={styles.navLabel}>WORKSPACE</div>
      <nav className={styles.nav} aria-label="AZTrade sections">{menus.map(({key,label,icon:Icon}) => <button key={key} className={`${styles.navItem} ${section===key?styles.navActive:''}`} aria-current={section===key?'page':undefined} onClick={() => navigate(key)}><Icon size={18}/><span>{label}</span>{section===key&&<ChevronRight size={15} className={styles.chevron}/>}</button>)}</nav>
      <div className={styles.sidebarFoot}><div className={styles.safetyChip} style={verifiedTrading && !liveOff ? { background: '#fee2e2', color: '#991b1b' } : undefined}><LockKeyhole size={15}/> {!verifiedTrading ? 'Live trading: not verified' : liveOff ? 'Live trading disabled' : 'Live trading ENABLED'}</div><p>{!verifiedTrading ? 'Sign in so the server can confirm the trading state.' : liveOff ? 'Confirmed by the server. Research and education only. No real-money orders.' : 'The server reports live trading as enabled. Review this before using AZTrade.'}</p></div>
    </aside>
    {menuOpen && <button aria-label="Close mobile menu" className={styles.backdrop} onClick={() => setMenuOpen(false)}/>}
    <div className={styles.workspace}>
      <header className={styles.topbar}><div className={styles.topLeft}><button className={styles.menuBtn} onClick={() => setMenuOpen(true)} aria-label="Open AZTrade navigation"><Menu size={22}/></button><span className={styles.crumb}>Workspace <ChevronRight size={13}/> <strong>AZTrade AI</strong></span></div><div className={styles.topRight}><span className={styles.flag}><span className={styles.dot}/> Research mode</span><span className={styles.plan}>{entitlements ? `${entitlements.plan} · ${entitlements.tier}` : capabilities ? `${capabilities.plan} · ${capabilities.tier}` : 'Guest'}</span><a className={styles.bellLink} href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications"><Bell size={17}/>{unread > 0 && <span className={styles.bellDot}>{unread > 9 ? '9+' : unread}</span>}</a><button className={styles.iconButton} title="Refresh account data" aria-label="Refresh account data" disabled={loading||dataBusy} onClick={refresh}><RefreshCw size={17} className={dataBusy?styles.spin:undefined}/></button></div></header>
      <div className={styles.content}>
        <div className={styles.heading}><div><div className={styles.eyebrow}><Sparkles size={15}/> INTELLIGENT MARKET WORKSPACE</div><h1>{menus.find(v=>v.key===section)?.label}</h1><p>Research markets, understand your portfolio, and manage risk — all within A-Zee AI.</p></div><span className={styles.readOnly}><ShieldCheck size={15}/> Research only</span></div>
        <div className={`${styles.notice} ${!connected?styles.noticeWarn:''}`} role="status" aria-live="polite"><CircleAlert size={18}/><span>{status}</span>{!connected && !loading && <Link href="/signin?next=/aztrade">Sign in</Link>}</div>
        {dataIssue && <div className={styles.secondaryNotice} role="status">{dataIssue}</div>}
        {section==='overview' && <>
          <div className={styles.metricGrid}>
            <Metric icon={Wallet} label="Practice cash" value={connected&&portfolio?formatAmount(portfolio.cash):'Not connected'} detail="Simulated funds only" />
            <Metric icon={PieChart} label="Positions" value={connected&&portfolio?String(positions.length):'Not connected'} detail="Paper holdings" />
            <Metric icon={Globe2} label="Market data" value={isMarketAvailable?'Licensed':anyPriced?'Informational · delayed':'Not loaded yet'} detail="Open Markets to load delayed quotes" />
            <Metric icon={Bell} label="Monitors" value={monitorCount == null ? '—' : `${monitorCount} active`} detail="Price and 24h-move alerts" />
          </div>
          <div className={styles.twoCol}><ResearchPanel question={question} setQuestion={setQuestion} answer={answer} busy={aiBusy} enabled={!!token&&!!connected&&!!capabilities?.capabilities.researchAssistant} submit={submitResearch} cancel={()=>pendingAI.current?.abort()} onSample={v=>{setQuestion(v);navigate('research');}} compact/>
          <div className={styles.stack}><Panel title="Market access" icon={Globe2} action={<button className={styles.textButton} onClick={()=>navigate('markets')}>Explore <ArrowRight size={14}/></button>}><div className={styles.chips}>{instruments.map(x=><span className={styles.chip} key={x}>{x}</span>)}</div><p className={styles.muted}>Delayed, informational quotes for crypto and forex; stocks and gold need a data key on the server. Not a licensed feed.</p></Panel><Panel title="Account safety" icon={ShieldCheck}><StatusRow label="Live-money execution" value={!verifiedTrading ? 'Not verified' : liveOff ? 'Disabled' : 'ENABLED'}/><StatusRow label="Paper execution" value={!entitlements ? 'Not verified' : paperOn ? 'Enabled' : 'Disabled'}/><StatusRow label="Source verification" value={isMarketAvailable?'Configured':'Pending'}/></Panel>{entitlements && <Panel title="Your plan today" icon={Wallet}><StatusRow label="Plan" value={`${entitlements.plan} (${entitlements.tier})`}/>{daily && <StatusRow label="AI questions" value={`${daily.research.used} of ${daily.research.limit}`}/>}{daily && entitlements.backtesting && <StatusRow label="Backtest runs" value={`${daily.backtest.used} of ${daily.backtest.limit}`}/>}</Panel>}</div></div>
        </>}
        {section==='research' && <div className={styles.twoCol}><ResearchPanel question={question} setQuestion={setQuestion} answer={answer} busy={aiBusy} enabled={!!token&&!!connected&&!!capabilities?.capabilities.researchAssistant} submit={submitResearch} cancel={()=>pendingAI.current?.abort()} onSample={setQuestion}/><Panel title="Research guidance" icon={BookOpen}><p>Ask about market concepts, portfolio diversification, financial fundamentals, and risk factors. The existing AI bridge only grounds account-specific facts using permitted paper account data.</p><div className={styles.callout}><CircleAlert size={17}/><span>Live prices, news, or brokerage holdings must not be inferred when no licensed or authorized source is connected.</span></div><button className={styles.secondaryButton} onClick={()=>navigate('history')}>View prior AI questions <ArrowRight size={15}/></button></Panel></div>}
        {section==='markets' && <MarketsPanel watch={watch.items} onAdd={watch.add} onRemove={watch.remove} quotes={quotes} quotesBusy={quotesBusy} reloadQuotes={reloadQuotes} marketsLive={isMarketAvailable} onMonitor={openMonitor} onMonitorCreated={() => setMonitorCount(c => (c ?? 0) + 1)} />}
        {section==='portfolio' && <PortfolioPanel valuation={valuation} connected={!!portfolio} positionCount={positions.length} />}
        {section==='monitors' && <MonitorsPanel seed={monitorSeed} onCount={setMonitorCount} />}
        {section==='strategies' && <><Panel title="Strategy research and historical backtests" icon={FlaskConical}><p>Strategy backtesting must use licensed historical data, reproducible assumptions, transaction costs, market calendars, and look-ahead safeguards.</p><StatusRow label="Your plan" value={entitlements ? (entitlements.backtesting ? `Up to ${entitlements.maximumBacktestBars.toLocaleString()} daily bars, ${entitlements.maximumBacktestRunsPerDay} runs a day${daily ? ` (${daily.backtest.used} used today)` : ''}` : 'Backtesting needs the Plus plan or higher') : 'Unavailable'}/><StatusRow label="Historical backtests" value={isBacktestAvailable?'Certified by server':'Not certified'}/><StatusRow label="Verified historical bars" value={isMarketAvailable?'Source registered':'Unavailable'}/><button disabled className={styles.disabledButton}>Run historical backtest — unavailable</button></Panel><Unavailable title="No fabricated strategy performance" description="Fixed demonstration returns must never appear as real backtest results. The backend must enforce limits and approved data provenance."/></>}
        {section==='risk' && <><Panel title="Risk intelligence" icon={ShieldCheck}><p>Computed from your practice account and delayed, informational prices. These are research aids, not licensed valuations, and no trading signal uses them.</p>{valuation ? <><StatusRow label="Portfolio valuation" value={valuation.complete?'Complete, using delayed prices':`Incomplete: no price for ${valuation.missing.slice(0,20).join(', ')}`}/>{valuation.complete && <><StatusRow label="Total value" value={new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(valuation.total)}/><StatusRow label="Largest position" value={valuation.largest!=null?`${valuation.largest.toFixed(1)}%`:'No positions to measure'}/>{Object.entries(valuation.byClass).filter(([,v])=>v>0).map(([k,v])=><StatusRow key={k} label={k} value={`${valuation.pct(v).toFixed(1)}%`}/>)}</>}</> : <Empty label="Risk metrics are unavailable until your practice account loads."/>}<div className={styles.callout}><CircleAlert size={17}/><span>Volatility and drawdown need price history for every holding and are not estimated here.</span></div></Panel></>}
        {section==='brokers' && <><Panel title="Connect a brokerage account" icon={Landmark}><p>Read-only access will let users view authorized holdings and account information. Broker connections require approved OAuth scopes, encrypted credentials, revocation, and per-user isolation.</p><div className={styles.brokerGrid}><Broker name="Alpaca"/><Broker name="Interactive Brokers"/><Broker name="Supported exchanges"/></div></Panel><Unavailable title="Broker onboarding awaiting approval" description="No broker OAuth flow or live execution permissions are enabled. Do not enter brokerage credentials into AZTrade until an approved connector is configured."/></>}
        {section==='history' && <Panel title="AI research history" icon={Clock3}>{!connected?<Empty label="Sign in to view your own assistant history."/>:history.length===0?<Empty label="No research history available yet."/>:<div className={styles.history}>{history.map((m,i)=><article key={`${m.created_at||i}-${i}`} className={styles.historyItem}><span>{m.role==='assistant'?'AZTrade AI':'You'}</span><p>{m.content.slice(0,4000)}</p></article>)}</div>}</Panel>}
        <footer className={styles.footer}>AZTrade AI is a research and educational companion, not a brokerage. No investment returns are guaranteed. Market, portfolio and AI data may be incomplete. Trading remains disabled.</footer>
      </div>
    </div>
  </main>;
}

function Panel({title,icon:Icon,action,children}:{title:string;icon:typeof BarChart3;action?:React.ReactNode;children:React.ReactNode}){return <section className={styles.panel}><div className={styles.panelHead}><h2><Icon size={18}/>{title}</h2>{action}</div><div className={styles.panelBody}>{children}</div></section>}
function Metric({icon:Icon,label,value,detail}:{icon:typeof BarChart3;label:string;value:string;detail:string}){return <div className={styles.metric}><div className={styles.metricTop}><span>{label}</span><Icon size={19}/></div><strong>{value}</strong><small>{detail}</small></div>}
function StatusRow({label,value}:{label:string;value:string}){return <div className={styles.statusRow}><span>{label}</span><strong>{value}</strong></div>}
function Empty({label}:{label:string}){return <div className={styles.empty}><CircleAlert size={22}/><span>{label}</span></div>}
function Unavailable({title,description}:{title:string;description:string}){return <div className={styles.unavailable}><LockKeyhole size={18}/><div><strong>{title}</strong><p>{description}</p></div></div>}
function Broker({name}:{name:string}){return <div className={styles.broker}><Landmark size={22}/><strong>{name}</strong><span>Not connected</span><button disabled aria-label={`Connect ${name} unavailable`}>Coming later</button></div>}
function ResearchPanel({question,setQuestion,answer,busy,enabled,submit,cancel,onSample,compact=false}:{question:string;setQuestion:(v:string)=>void;answer:string;busy:boolean;enabled:boolean;submit:(e:FormEvent<HTMLFormElement>)=>void;cancel:()=>void;onSample:(v:string)=>void;compact?:boolean}){return <Panel title="Ask AZTrade AI" icon={Bot}><p className={styles.muted}>Ask questions about markets, risk, and your available paper account facts. No invented prices or automatic trading.</p><form onSubmit={submit}><label className={styles.formLabel} htmlFor="aztrade-question">Your research question</label><textarea id="aztrade-question" value={question} maxLength={4000} rows={compact?3:5} disabled={busy} onChange={e=>setQuestion(e.target.value)} className={styles.textarea} placeholder="What are the risks of concentrating investments in one sector?"/><div className={styles.formActions}><span>{question.length}/4000</span><div>{busy&&<button type="button" onClick={cancel} className={styles.secondaryButton}>Cancel</button>}<button type="submit" disabled={!enabled||busy||!question.trim()} className={styles.primaryButton}>{busy?<LoaderCircle className={styles.spin} size={16}/>:<Send size={16}/>} {busy?'Analyzing…':'Analyze with AI'}</button></div></div></form>{!compact&&<div className={styles.suggestions}><strong>Try asking</strong>{samples.map(s=><button type="button" onClick={()=>onSample(s)} key={s}><Sparkles size={14}/>{s}</button>)}</div>}{answer&&<article className={styles.answer} aria-label="AZTrade AI answer"><h3><CheckCircle2 size={17}/> Research response</h3><ReplyView text={answer}/><small>Check facts, provenance and limitations before making financial decisions.</small></article>}</Panel>}
