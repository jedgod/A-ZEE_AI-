-- Seed instruments and initial prices for development / demo
INSERT INTO instruments (symbol, name, type, sector) VALUES
  ('AAPL', 'Apple Inc.', 'stock', 'Technology'),
  ('MSFT', 'Microsoft', 'stock', 'Technology'),
  ('NVDA', 'NVIDIA', 'stock', 'Technology'),
  ('GOOGL', 'Alphabet', 'stock', 'Communication'),
  ('AMZN', 'Amazon', 'stock', 'Consumer'),
  ('TSLA', 'Tesla', 'stock', 'Consumer'),
  ('SPY', 'SPDR S&P 500', 'etf', 'Broad Market'),
  ('QQQ', 'Invesco QQQ', 'etf', 'Technology'),
  ('IWM', 'iShares Russell 2000', 'etf', 'Small Cap'),
  ('BTC-USD', 'Bitcoin', 'crypto', 'Crypto'),
  ('ETH-USD', 'Ethereum', 'crypto', 'Crypto'),
  ('EURUSD', 'EUR/USD', 'forex', 'Forex'),
  ('GBPUSD', 'GBP/USD', 'forex', 'Forex')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO market_prices (symbol, price, change_abs, change_pct, rsi) VALUES
  ('AAPL', 228.45, 1.82, 0.80, 62),
  ('MSFT', 418.90, 3.15, 0.76, 58),
  ('NVDA', 142.80, -2.10, -1.45, 41),
  ('GOOGL', 172.35, 0.95, 0.55, 55),
  ('AMZN', 198.20, 1.45, 0.74, 61),
  ('TSLA', 248.60, -5.40, -2.13, 38),
  ('SPY', 581.20, 1.85, 0.32, 57),
  ('QQQ', 501.45, -1.20, -0.24, 52),
  ('IWM', 224.10, 0.65, 0.29, 54),
  ('BTC-USD', 67420, 1240, 1.87, 68),
  ('ETH-USD', 3420, 85, 2.55, 71),
  ('EURUSD', 1.0852, 0.0012, 0.11, 49),
  ('GBPUSD', 1.2945, -0.0021, -0.16, 45)
ON CONFLICT (symbol) DO UPDATE SET
  price = EXCLUDED.price,
  change_abs = EXCLUDED.change_abs,
  change_pct = EXCLUDED.change_pct,
  rsi = EXCLUDED.rsi,
  updated_at = now();
