# AZTrade AI — Full Stack (Development Baseline v3)

**Status: Development baseline — NO-GO for production.**

See `docs/RELEASE_EVIDENCE_MATRIX.md` for the current gate status.

## This revision (Stage A/B partial)

- Production process exits if `AUTH_MODE !== jwt` when `NODE_ENV=production`
- Helmet security headers + request audit logging
- PostgreSQL RLS scaffolding (`sql/rls/001_rls.sql`)
- Double-entry `paper_ledger` retained
- Mandatory idempotency with request-hash binding retained
- Strategy backtest gated by `requireTier('plus')`

## Still blocked for Production GO

G01 (real A-Zee JWT), G05 (licensed market data), G07 (real backtests), G08 (AI orchestration), G11 (API-backed frontend), G12 (AZLinqTrade), G14 (full test matrix).

Live trading remains disabled.

## Tests

```bash
cd backend
node --test tests/smoke.test.js
```
