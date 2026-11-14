# AZTrade AI V3–V10 incremental source patch

Integrate with A-Zee's existing authenticated application and AZTrade-Unified-step3 backend. **Do not copy this over existing identity, billing, AI bridge, or order procedure files.** Based on inspected `fix/audit-gaps-2026-11-10` branch. V2 UI components are in the previous package.

## Copy paths
- `backend/lib/*.js` -> `AZTrade-Unified-step3/backend/lib/`
- `backend/routes/intelligence.js` -> `AZTrade-Unified-step3/backend/routes/`
- `backend/sql/009_ai_companion_foundation.sql` -> the next unused, reviewed AZTrade SQL migration path
- `azee/lib/aztrade/research-access.ts` -> A-Zee `lib/aztrade/research-access.ts`
- `azee/app/api/aztrade/research/route.ts` -> A-Zee matching route

## Express integration (only after verifying existing middleware)
```js
import { intelligenceRouter } from './routes/intelligence.js';
import { BrokerRegistry } from './lib/broker-readonly.js';
// Auth middleware and scoped requestDb MUST run first.
const registry = { async find(_sourceId) { return null; } }; // fail-closed until approved licence registry adapter
const adapters = new Map(); // no vendor configured
app.use('/api/intelligence', authMiddleware, requestDb,
  intelligenceRouter({ registry, adapters, brokerRegistry: new BrokerRegistry() }));
```

## Safe configuration
```dotenv
AZTRADE_AI_COMPANION_ENABLED=true
AZTRADE_RESEARCH_ENABLED=false
AZTRADE_RESEARCH_V3_ENABLED=false
AZTRADE_HISTORICAL_BACKTEST_CERTIFIED=false
AZTRADE_PAPER_EXECUTION_CERTIFIED=false
AZTRADE_REAL_MONEY_TRADING_ENABLED=false
AZTRADE_LIVE_ORDER_ROUTING_ENABLED=false
```
All production credentials must reside in the existing secret manager. No commercial data feed or broker vendor is bundled.

## Run isolated unit tests
```sh
cd backend
npm test
```
Then independently run the real A-Zee TypeScript type-check, backend tests, PostgreSQL 16/RLS test suite, and web/mobile E2E tests after integration.

## Current limitations
- **Not a final production-ready live trading app.** Provider onboarding, broker OAuth, data licensing, mobile integration, release certification and approved financial compliance review cannot be completed from source code alone.
- No certified live prices, backtests in HTTP route or permitted broker connections. The historical simulator is a deterministic isolated engine, not yet production integrated.
- SQL quota counter needs security grants and concurrency/recovery tests in your deployed PostgreSQL instance. No response-replay cache is implemented in the new educational API; replays are deliberately rejected.
- The research route uses existing A-Zee pipeline; in the absence of vetted sources it is general education only.

See `docs/ROADMAP-V3-V10.md` for milestone closure gates.
