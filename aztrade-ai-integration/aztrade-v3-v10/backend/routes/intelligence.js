import { Router } from 'express';
import { assertResearchMode } from '../lib/core.js';
import { portfolioIntelligence } from '../lib/portfolio.js';
import { backtest } from '../lib/backtest.js';
import { createMarketDataService } from '../lib/market-data.js';
import { validateBrokerScopes } from '../lib/broker-readonly.js';

/** Mount behind the existing authMiddleware + requestDb. No userId or tenantId accepted from clients. */
export function intelligenceRouter({registry,adapters,brokerRegistry}) {
  const router=Router();
  const market=createMarketDataService({registry,adapters});
  const respond=(res,e)=>res.status(Number.isInteger(e.status)?e.status:503).json({error:e.message?.startsWith('INVALID_')?'INVALID_REQUEST':'FEATURE_UNAVAILABLE'});
  router.get('/status',(req,res)=>res.json({researchAvailable:process.env.AZTRADE_RESEARCH_ENABLED==='true',marketDataConfigured:false,paperExecution:false,liveExecution:false,brokerOrders:false}));
  router.get('/portfolio/risk',async(req,res)=>{
    try{
      assertResearchMode();
      const {rows}=await req.db.query('SELECT symbol,shares::text as quantity FROM paper_positions WHERE account_id IN (SELECT id FROM paper_accounts WHERE user_id=$1)',[req.user.id]);
      // No unlicensed/demo quotes ever used for totals; returning incomplete is intentional.
      const positions=rows.map(p=>({symbol:p.symbol,quantity:p.quantity,assetClass:'unknown'}));
      res.json(portfolioIntelligence(positions,new Map()));
    }catch(e){respond(res,e);}
  });
  router.post('/historical/backtest',async(req,res)=>{
    try{
      assertResearchMode();
      if(!['plus','premium'].includes(req.user?.tier))return res.status(403).json({error:'PLAN_REQUIRED'});
      // Hard gate: wire quota to A-Zee billing and a licensed provider before enabling endpoint.
      if(process.env.AZTRADE_HISTORICAL_BACKTEST_CERTIFIED!=='true')return res.status(503).json({error:'BACKTEST_NOT_CERTIFIED'});
      // Even after opt-in, no provider is registered by this package; deployment must register it explicitly.
      return res.status(503).json({error:'PROVIDER_NOT_CONFIGURED'});
    }catch(e){respond(res,e);}
  });
  router.get('/brokers',(req,res)=>res.json({supported:[],connected:[],note:'Only approved read-only broker adapters will appear here.'}));
  router.post('/brokers/connect',(_req,res)=>res.status(503).json({error:'BROKER_OAUTH_NOT_CONFIGURED'}));
  router.post('/brokers/orders',(_req,res)=>res.status(423).json({error:'LIVE_TRADING_DISABLED'}));
  return router;
}
