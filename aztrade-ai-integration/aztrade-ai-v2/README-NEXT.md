# AZTrade AI V2 — navigation and native mobile companion

This extends **aztrade-ai-integration**. Target: `jedgod/A-ZEE_AI-` at branch `fix/audit-gaps-2026-11-10`, **not** `main`. Do not copy over or replace existing A-Zee `lib/aztrade/identity.ts`, `lib/aztrade/ai.ts`, or billing services.

## New components
- `mobile/aztrade/AZTradeAIScreen.tsx`: React Native screen using injected existing A-Zee mobile session (not new authentication). Requires Expo/React Native, secure `crypto.randomUUID()` polyfill, and real A-Zee native navigation wiring. `apiBaseUrl` must be A-Zee origin, not port 4010.
- `components/aztrade-nav-link.tsx`: reusable icon rail link.
- `lib/aztrade/companion-gateway.ts` updated: `Authorization: Bearer <A-Zee mobile session>` **plus** `X-AZTrade-Token: Bearer <AZTrade short-lived JWT>`; existing cookie web clients remain compatible.
- `app/aztrade/page.tsx` updated to send the AZTrade header and reuse request ID across auth retries.
- `tests/mobile-auth-contract.test.ts`: static contract smoke checks; full E2E needed.

## Add navigation to the existing A-Zee workspace
In `components/user/icon-rail.tsx`, import `ChartCandlestick` from `lucide-react` and insert this existing `link` call in the rail:

```tsx
{link('/aztrade', 'AZTrade AI', <ChartCandlestick size={20} />)}
```

For the expanded sidebar, add a `NavItem` with `{id:'aztrade',label:'AZTrade AI',href:'/aztrade',icon:'chart-candlestick'}` wherever your sidebar group data is built. The existing `components/sidebar-nav.tsx` ICONS registry needs `chart-candlestick: ChartCandlestick`. Do not add a fake link when feature disabled; show a disabled state or 503.

## Mobile app hookup
Add a screen to your existing Expo router/navigation, importing `mobile/aztrade/AZTradeAIScreen`. Provide `getAzeeSessionToken` from the *existing app login session manager*; do not read secrets from AsyncStorage, share Expo storage with a keyboard, or create a second login. Example:

```tsx
<AZTradeAIScreen
  apiBaseUrl={APP_API_BASE_URL}
  getAzeeSessionToken={() => auth.getValidAccessToken()}
  onSignInRequired={() => navigation.navigate('SignIn')}
/>
```

This is a host integration example, not copy-ready without your real `auth`, `navigation`, and `APP_API_BASE_URL` definitions. This screen is a normal mobile page, **not** an IME/keyboard.

## Important gates
1. Check `X-AZ-Client` and origin policy with real mobile auth. Never trust X-AZ-Client alone as an identity token.
2. Keep server-side `requireUser`, live AZTrade introspection, subscription authority and tenant RLS.
3. Keep backend `AZTRADE_PAPER_EXECUTION_CERTIFIED=false`; no real-money routes.
4. The production mobile build must provide secure random UUIDs and HTTPS with proper certificate verification.
5. Run the whole repository tests, TS check, physical-device tests, revoked session and downgrade tests. The static contract tests alone are not certification.

## Run
```sh
npx vitest run tests/companion-policy.test.ts tests/mobile-auth-contract.test.ts
npx tsc --noEmit
```

Status: implementation patch, not deployed or certified.
