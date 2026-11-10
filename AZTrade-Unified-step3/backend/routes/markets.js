import { Router } from 'express';
import { query } from '../lib/db.js';

const router = Router();

// GET /api/markets?type=stock|etf|crypto|forex
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    let sql = `
      SELECT i.symbol, i.name, i.type, i.sector,
             p.price, p.change_abs, p.change_pct, p.rsi, p.updated_at
      FROM instruments i
      JOIN market_prices p ON p.symbol = i.symbol
      WHERE i.active = true
    `;
    const params = [];
    if (type) {
      sql += ` AND i.type = $1`;
      params.push(type);
    }
    sql += ` ORDER BY i.type, i.symbol`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

// GET /api/markets/:symbol
router.get('/:symbol', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT i.symbol, i.name, i.type, i.sector,
              p.price, p.change_abs, p.change_pct, p.rsi, p.updated_at
       FROM instruments i
       JOIN market_prices p ON p.symbol = i.symbol
       WHERE i.symbol = $1`,
      [req.params.symbol.toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Symbol not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch symbol' });
  }
});

export default router;
