import { Router } from 'express';

const router = Router();

// GET /api/risk
router.get('/', async (req, res) => {
  try {
    const { rows: holdings } = await req.db.query(
      `SELECT h.symbol, h.shares, p.price, i.type
       FROM holdings h
       JOIN portfolios pf ON pf.id = h.portfolio_id
       JOIN market_prices p ON p.symbol = h.symbol
       JOIN instruments i ON i.symbol = h.symbol
       WHERE pf.user_id = $1`,
      [req.user.id]
    );

    const total = holdings.reduce((s, h) => s + Number(h.shares) * Number(h.price), 0);
    const tech = holdings
      .filter(h => ['AAPL','MSFT','NVDA','GOOGL','QQQ'].includes(h.symbol))
      .reduce((s, h) => s + Number(h.shares) * Number(h.price), 0);
    const crypto = holdings
      .filter(h => h.type === 'crypto')
      .reduce((s, h) => s + Number(h.shares) * Number(h.price), 0);

    const { rows: alerts } = await req.db.query(
      `SELECT id, message, severity, created_at FROM alerts
       WHERE user_id = $1 AND active = true ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({
      totalValue: total,
      techExposurePct: total ? (tech / total) * 100 : 0,
      cryptoExposurePct: total ? (crypto / total) * 100 : 0,
      concentration: tech / total > 0.6 ? 'High' : 'Moderate',
      alerts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute risk' });
  }
});

// POST /api/risk/alerts
router.post('/alerts', async (req, res) => {
  try {
    const { message, severity = 'info' } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const { rows } = await req.db.query(
      `INSERT INTO alerts (user_id, message, severity) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, message, severity]
    );
    await req.db.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// DELETE /api/risk/alerts/:id
router.delete('/alerts/:id', async (req, res) => {
  try {
    await req.db.query(
      'UPDATE alerts SET active = false WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    await req.db.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to dismiss alert' });
  }
});

export default router;
