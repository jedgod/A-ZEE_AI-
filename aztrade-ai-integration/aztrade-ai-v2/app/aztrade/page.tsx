'use client';
import { useCallback,useEffect,useRef,useState } from 'react';

type Access={product:string;plan:string;tier:string;capabilities:{marketData:string;brokerConnections:string;historicalBacktests:string;paperExecution:boolean;liveExecution:boolean}};
const markets=['Stocks','ETFs','Crypto','Forex','Commodities','Options','Futures'];
const layout:React.CSSProperties={maxWidth:1060,margin:'0 auto',padding:'clamp(16px,4vw,36px)',fontFamily:'system-ui,sans-serif'};
const panel:React.CSSProperties={border:'1px solid #ced5df',borderRadius:16,padding:20,background:'var(--aztrade-panel,#fff)',color:'var(--aztrade-text,#18212f)'};
export default function AZTradeAIPage() {
  const [access,setAccess]=useState<Access|null>(null);
  const [token,setToken]=useState<string|null>(null);
  const [question,setQuestion]=useState('');
  const [answer,setAnswer]=useState('');
  const [status,setStatus]=useState('Checking your A-Zee sign-in…');
  const [busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null);
  const connect=useCallback(async(signal?:AbortSignal)=>{
    const [caps,session]=await Promise.all([
      fetch('/api/aztrade/capabilities',{credentials:'same-origin',cache:'no-store',signal}),
      fetch('/api/aztrade/token',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal})
    ]);
    if (!caps.ok || !session.ok) throw new Error('Sign in to A-Zee and verify your account to use AZTrade AI.');
    const [c,s]=await Promise.all([caps.json(),session.json()]);
    if(typeof s.access_token!=='string') throw new Error('AZTrade authorization unavailable');
    setAccess(c);setToken(s.access_token);setStatus('Research assistant ready. No verified live market prices.');
    return s.access_token as string;
  },[]);
  useEffect(()=>{const controller=new AbortController();connect(controller.signal).catch(e=>{if(!controller.signal.aborted)setStatus(String(e.message||'Unavailable'))});return ()=>{controller.abort();pending.current?.abort();};},[connect]);
  async function research(){
    if(!question.trim() || busy)return;
    setBusy(true);setAnswer('');setStatus('Preparing source-limited AI analysis…');
    const controller=new AbortController();pending.current=controller;
    try{
      let activeToken=token;
      if(!activeToken) activeToken=await connect(controller.signal);
      const requestId=crypto.randomUUID();
      const reply=async(t:string)=>fetch('/api/aztrade/companion?resource=assistant/chat',{
        method:'POST',credentials:'same-origin',cache:'no-store',headers:{'X-AZTrade-Token':`Bearer ${t}`,'Content-Type':'application/json'},
        body:JSON.stringify({requestId,message:question.trim()}),signal:controller.signal
      });
      let response=await reply(activeToken);
      // Token expiry is handled by reauthenticating. Never retry a request if it
      // might already have been accepted and metered.
      if(response.status===401){activeToken=await connect(controller.signal);response=await reply(activeToken);}
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'AI research unavailable');
      if(typeof data.reply!=='string')throw new Error('Invalid research response');
      setAnswer(data.reply);setStatus('AI response generated from available account context.');
    }catch(e){if(!controller.signal.aborted)setStatus(e instanceof Error?e.message:'Unavailable');}
    finally{setBusy(false);pending.current=null;}
  }
  return <main style={layout}>
    <header style={{display:'flex',gap:16,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:20}}>
      <div><a href="/" style={{fontSize:14}}>← A-Zee AI</a><h1 style={{margin:'8px 0'}}>AZTrade AI</h1><p style={{margin:0,color:'#58677b'}}>Multi-market investment research companion</p></div>
      <span style={{padding:'8px 12px',borderRadius:50,background:'#fff1d6',color:'#654500',fontWeight:600}}>Research only · Trading disabled</span>
    </header>
    <div role="status" aria-live="polite" style={{marginBottom:18}}>{status}</div>
    <section style={{...panel,marginBottom:16}}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><strong>Ask AZTrade AI</strong><span>{access?`${access.plan} plan · ${access.tier}`:'Sign-in required'}</span></div>
      <p style={{color:'#58677b'}}>Ask about market concepts, risk, or your connected paper account. AZTrade cannot verify live prices, news, or external broker accounts yet.</p>
      <label htmlFor="aztrade-question">Your research question</label><textarea id="aztrade-question" maxLength={4000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Explain diversification risks across stocks and crypto…" rows={4} style={{boxSizing:'border-box',width:'100%',padding:12,marginTop:8,border:'1px solid #8996a8',borderRadius:10,font:'inherit'}}/>
      <div style={{display:'flex',gap:10,marginTop:12}}><button onClick={research} disabled={busy||!token||!question.trim()} style={{padding:'10px 18px',borderRadius:10,cursor:'pointer'}}>{busy?'Analyzing…':'Analyze with AI'}</button><button onClick={()=>{pending.current?.abort();setBusy(false)}} disabled={!busy}>Cancel</button></div>
      {answer&&<article aria-label="AI analysis" style={{whiteSpace:'pre-wrap',lineHeight:1.55,borderTop:'1px solid #ddd',marginTop:20,paddingTop:16}}>{answer}</article>}
    </section>
    <section style={{...panel,marginBottom:16}}><h2>Explore markets</h2><p>Educational coverage; not live quotes or licensed investment research.</p><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{markets.map(m=><span key={m} style={{padding:'8px 12px',border:'1px solid #aab5c4',borderRadius:30}}>{m}</span>)}</div></section>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:16}}>
      <section style={panel}><h2>Broker connections</h2><p>Unavailable. Read-only broker integrations require approved connectors and user authorization.</p><button disabled>Connect broker</button></section>
      <section style={panel}><h2>Market data</h2><p>No licensed price provider configured. Demo prices are never valid trading signals.</p><button disabled>Live quotes unavailable</button></section>
      <section style={panel}><h2>Strategies & backtests</h2><p>Real historical testing is unavailable. Illustrative outputs must not be treated as performance.</p><button disabled>Backtests unavailable</button></section>
      <section style={panel}><h2>Paper & live trading</h2><p>Execution is disabled on both client and backend pending separate certification.</p><button disabled>Place order unavailable</button></section>
    </div>
    <p style={{fontSize:13,color:'#58677b',marginTop:22}}>AZTrade AI provides educational analysis, not financial advice. No guaranteed returns or automated trades.</p>
  </main>;
}
