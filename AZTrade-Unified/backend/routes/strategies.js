import { Router } from 'express';
import { requireTier } from '../lib/auth.js';

const router = Router();

// GET /api/strategies
router.get('/', (req, res) => {
  res.json([
    {
      id: 'momentum',
      name: 'Momentum',
      description: 'Buy when RSI > 60 and price above short-term average. Exit on RSI cross below 40.',
      tierRequired: 'plus'
    },
    {
      id: 'mean-reversion',
      name: 'Mean Reversion',
      description: 'Enter on RSI < 35 with volume confirmation. Exit at RSI 55 or stop-loss.',
      tierRequired: 'plus'
    }
  ]);
});

// POST /api/strategies/:id/backtest  (requires Plus or higher)
router.post('/:id/backtest', requireTier('plus'), (req, res) => {
  const { id } = req.params;
  const results = {
    momentum: { trades: 18, winRate: 61, returnPct: 14.2, maxDrawdown: -8.4 },
    'mean-reversion': { trades: 24, winRate: 54, returnPct: 9.7, maxDrawdown: -11.2 }
  };
  const result = results[id];
  if (!result) return res.status(404).json({ error: 'Strategy not found' });
  res.json({
    strategyId: id,
    ...result,
    note: 'Illustrative simulation only. Not a production backtest engine.'
  });
});

export default router;
