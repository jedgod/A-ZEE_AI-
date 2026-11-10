import { Router } from 'express';
const router=Router();
// No AI provider calls unless authoritative A-Zee bridge is configured.
router.post('/chat', async (req,res)=>{
  const message=req.body?.message;
  const requestId=req.body?.requestId;
  if(typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return res.status(400).json({error:'UUID requestId required'});
  if(typeof message!=='string' || !message.trim() || message.length>4000) return res.status(400).json({error:'Invalid message'});
  if(!process.env.AZEE_AI_BRIDGE_URL || !process.env.AZEE_AI_BRIDGE_TOKEN) return res.status(503).json({error:'A-Zee AI unavailable'});
  try {
    const url=new URL(process.env.AZEE_AI_BRIDGE_URL);
    if(url.protocol!=='https:' && !(process.env.NODE_ENV!=='production' && url.hostname==='localhost')) throw new Error('Secure AI bridge required');
    // Only use the current user's tenant-scoped data; no raw client-supplied balances or prices.
    const {rows: accounts}=await req.db.query('SELECT cash::text FROM paper_accounts WHERE user_id=$1',[req.user.id]);
    const {rows: positions}=await req.db.query('SELECT symbol,shares::text,entry_price::text FROM paper_positions WHERE account_id IN (SELECT id FROM paper_accounts WHERE user_id=$1) ORDER BY symbol LIMIT 100',[req.user.id]);
    // No prices supplied until a licensed, fresh data source is certified.
    const facts={paper_cash:accounts[0]?.cash ?? null, paper_positions:positions, market_prices:null, market_data_status:'unavailable'};
    const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${process.env.AZEE_AI_BRIDGE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({requestId,user_id:req.user.azee_user_id,tenant_id:req.user.tenant_id,allowance:'aztrade_assistant',message,grounding:facts,policy:'Answer only from grounding. Never invent market prices, balances, fills or returns. State when data is unavailable. Never execute trades.'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) return res.status(response.status===429?429:503).json({error:'A-Zee AI unavailable or quota exceeded'});
    const body=await response.json();
    if(typeof body.reply!=='string' || body.reply.length>12000 || body.allowance!=='aztrade_assistant') throw new Error('Invalid AI bridge response');
    await req.db.query('INSERT INTO assistant_messages(user_id,role,content) VALUES ($1,$2,$3),($1,$4,$5)',[req.user.id,'user',message,'assistant',body.reply]);
    await req.db.query('COMMIT');
    return res.json({reply:body.reply,market_data_status:'unavailable'});
  }catch(error){console.error('AZTrade AI error:',error.message);return res.status(503).json({error:'AI unavailable'});}
});
router.get('/history',async(req,res)=>{
  try {const {rows}=await req.db.query('SELECT role,content,created_at FROM assistant_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id]);res.json(rows.reverse());}
  catch {res.status(503).json({error:'History unavailable'});}
});
export default router;
