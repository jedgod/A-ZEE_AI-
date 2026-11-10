# Server-backed paper trading client
Serve this folder on the same HTTPS origin as A-Zee. Reverse proxy `/api/paper` to the AZTrade backend and `/api/aztrade/token` to A-Zee. Sign in to A-Zee before connecting. Tokens remain in memory only; reconnect after expiry. Use the step3 identity backend with its provisioning migration and reviewed role grants. The original backend still requires provisioned signed internal identity claims.

The previous offline simulation has been replaced: no local financial balances, fabricated prices, chart/backtest results, or HTML interpolation. API data renders as text. Orders keep the same idempotency key after uncertain responses; retry before starting another order. Reloading loses pending retry state: inspect server order history before placing another order.

Deploy with CSP `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Keep execution disabled until database, identity and licensed-feed certification passes.
