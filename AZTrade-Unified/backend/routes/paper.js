import { Router } from 'express';
import { createHash } from 'node:crypto';
import { isConnectionError } from '../lib/request-db.js';
const router = Router();
const quantityPattern = /^(?:[1-9]\d{0,5}|0\.\d{0,7}[1-9]|[1-9]\d{0,5}\.\d{0,7}[1-9])$/;

// Errors raised by aztrade_place_paper_order() (migration 006). SQLSTATE class T0 belongs to AZTrade.
const ORDER_ERRORS = {
  T0001: [403, 'Provisioned tenant identity required'],
  T0002: [404, 'Paper account unavailable'],
  T0003: [409, 'Idempotency key payload mismatch'],
  T0004: [422, 'Unknown instrument or quote'],
  T0005: [503, 'Quote stale or invalid'],
  T0006: [422, 'Insufficient virtual cash'],
  T0007: [422, 'Insufficient virtual position'],
  T0008: [400, 'Invalid symbol, side or decimal quantity'],
  T0009: [503, 'Trading unavailable: market data is not licensed for execution'],
};

router.get('/', async (req, res) => {
  try {
    const { rows: accounts } = await req.db.query('SELECT id,cash FROM paper_accounts WHERE user_id=$1', [req.user.id]);
    if (!accounts.length) return res.status(404).json({error:'No paper account'});
    const account = accounts[0];
    const {rows: positions} = await req.db.query(`SELECT pp.symbol,pp.shares,pp.entry_price,mp.price AS current_price,
      (pp.shares*mp.price)::text AS market_value FROM paper_positions pp
      JOIN market_prices mp ON mp.symbol=pp.symbol WHERE pp.account_id=$1`, [account.id]);
    const {rows: history} = await req.db.query(`SELECT id,symbol,side,shares,price,status,created_at
      FROM paper_orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 50`,[account.id]);
    return res.json({accountId:account.id,cash:account.cash,positions,history,paperMode:true,source:'postgresql'});
  } catch(e) { console.error(e); return res.status(500).json({error:'Paper account unavailable'}); }
});

// POST /api/paper/orders
// All money movement happens inside ONE database procedure (account row lock, idempotent replay, quote
// freshness, NUMERIC arithmetic with a single rounding, position update, order row and a balanced two-entry
// ledger posting). The API role cannot write those tables itself, so this route only validates the request
// shape, calls the procedure, commits, and translates its error codes.
router.post('/orders', async (req,res) => {
  if (process.env.AZTRADE_PAPER_EXECUTION_CERTIFIED !== 'true')
    return res.status(503).json({error:'Paper execution blocked until certified'});
  const {symbol,side,shares,idempotencyKey}=req.body||{};
  const sym=typeof symbol==='string'?symbol.trim().toUpperCase():'';
  const qty=typeof shares==='string'?shares:String(shares??'');
  if (!/^[A-Z0-9._/-]{1,32}$/.test(sym) || !['BUY','SELL'].includes(side) || !quantityPattern.test(qty))
    return res.status(400).json({error:'Invalid symbol, side or decimal quantity'});
  if (typeof idempotencyKey!=='string'|| !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
    return res.status(400).json({error:'Invalid idempotency key'});
  const hash=createHash('sha256').update(JSON.stringify({symbol:sym,side,shares:qty})).digest('hex');
  try {
    const {rows}=await req.db.query('SELECT aztrade_place_paper_order($1,$2,$3::numeric,$4,$5) AS result',[sym,side,qty,idempotencyKey,hash]);
    await req.db.query('COMMIT'); // The deferred balanced-posting constraint is checked here.
    const {replay,order}=rows[0].result;
    return res.status(replay?200:201).json({paperMode:true,...(replay?{idempotent:true}:{}),order});
  } catch(e) {
    const mapped=ORDER_ERRORS[e?.code];
    if (mapped) return res.status(mapped[0]).json({error:mapped[1]}); // the request's transaction is rolled back when the response finishes
    if (isConnectionError(e)) {
      // The database restarted or failed over. Nothing was committed unless COMMIT had already been acknowledged, so
      // the caller can safely retry with the SAME idempotency key: it posts once, or replays the earlier result.
      res.set('Retry-After','2');
      return res.status(503).json({error:'Database unavailable; retry with the same idempotency key'});
    }
    console.error('paper order failed',e);
    return res.status(500).json({error:'Order transaction failed; retry with the same idempotency key'});
  }
});
export default router;
