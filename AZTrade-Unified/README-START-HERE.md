# AZTrade Unified Source

This folder consolidates the AZTrade v3 baseline and security/finance/authorization patches.

Read `IMPLEMENTATION_STATUS.md` before running anything. This is **not** production GO.

Backend: `backend/` | Frontend: `frontend/` | PostgreSQL migrations: `backend/sql/migrations/`

Apply database migrations only to a disposable PostgreSQL instance after inspecting existing schema and data.
Do not apply old `backend/sql/rls/001_rls.sql` after migration 004; it contains older permissive policies.
Keep `AZTRADE_PAPER_EXECUTION_CERTIFIED=false` and real-money trading disabled.
