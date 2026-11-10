import { Router } from 'express';

const router = Router();

// GET /api/portfolio
router.get('/', async (req, res) => {
  try {
    const { rows: portfolios } = await req.db.query(
      'SELECT id, name FROM portfolios WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );
    if (!portfolios.length) return res.json({ portfolio: null, holdings: [], summary: {} });

    const pid = portfolios[0].id;
    const { rows: holdings } = await req.db.query(
      `SELECT h.symbol, h.shares, h.avg_cost,
              p.price, p.change_pct,
              (h.shares * p.price) AS market_value,
              (h.shares * p.price - h.shares * h.avg_cost) AS unrealized_pnl
       FROM holdings h
       JOIN market_prices p ON p.symbol = h.symbol
       WHERE h.portfolio_id = $1`,
      [pid]
    );

    const totalValue = holdings.reduce((s, h) => s + Number(h.market_value), 0);
    const totalCost = holdings.reduce((s, h) => s + Number(h.shares) * Number(h.avg_cost), 0);
    const pnl = totalValue - totalCost;

    res.json({
      portfolio: portfolios[0],
      holdings,
      summary: {
        totalValue,
        totalCost,
        unrealizedPnl: pnl,
        unrealizedPnlPct: totalCost ? (pnl / totalCost) * 100 : 0
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

// POST /api/portfolio/holdings
router.post('/holdings', async (req, res) => {
  try {
    const { symbol, shares, avgCost } = req.body;
    if (!symbol || !(shares > 0) || avgCost == null) {
      return res.status(400).json({ error: 'symbol, shares, avgCost required' });
    }
    const sym = symbol.toUpperCase();

    // Verify instrument exists
    const { rows: inst } = await req.db.query('SELECT symbol FROM instruments WHERE symbol = $1', [sym]);
    if (!inst.length) return res.status(400).json({ error: 'Unknown symbol' });

    const { rows: ports } = await req.db.query(
      'SELECT id FROM portfolios WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    const pid = ports[0].id;

    await req.db.query(
      `INSERT INTO holdings (portfolio_id, symbol, shares, avg_cost)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (portfolio_id, symbol)
       DO UPDATE SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost, updated_at = now()`,
      [pid, sym, shares, avgCost]
    );
    await req.db.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add holding' });
  }
});

// DELETE /api/portfolio/holdings/:symbol
router.delete('/holdings/:symbol', async (req, res) => {
  try {
    const { rows: ports } = await req.db.query(
      'SELECT id FROM portfolios WHERE user_id = $1 LIMIT 1',
      [req.user.id]
    );
    await req.db.query(
      'DELETE FROM holdings WHERE portfolio_id = $1 AND symbol = $2',
      [ports[0].id, req.params.symbol.toUpperCase()]
    );
    await req.db.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove holding' });
  }
});

export default router;
