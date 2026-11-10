# AZLinqext reference implementation

This is a security-oriented **integration starter**, not a certified production release. It provides a Fastify API, PostgreSQL schema, tier rules, server-side quota enforcement, JWT verification, idempotency, and an Android IME example.

## Integration
1. Install Node.js >=22, PostgreSQL and dependencies (`cd server && npm ci` after generating/committing a lockfile).
2. Apply `server/sql/001_init.sql` using the migration role, not the runtime application role.
3. Configure `DATABASE_URL`, `AZEE_JWKS_URL`, `AZEE_JWT_ISSUER`, `AZEE_JWT_AUDIENCE`, `AZEE_INFERENCE_URL`, `AZEE_INFERENCE_TOKEN`, `PG_SSL=true` for hosted TLS, and `PORT`.
4. Configure a private A-Zee inference endpoint accepting `{task,instructions,message,context,variants,maxWords,tier}` and returning `{replies:[...]}`. The inference gateway must authenticate callers and enforce policy itself.
5. Integrate billing events using a verified, replay-safe provider webhook worker that writes entitlements with the same per-user advisory lock as reply reservations. Never trust the client tier.
6. Wire `SessionTokenProvider` to the existing A-Zee mobile auth flow and define `BuildConfig.AZ_API_URL` as the trusted HTTPS API origin. Add the IME service to the actual app manifest. This sample does not include a full keyboard layout or complete Android project.
7. Run `npm test` and add database concurrency, failure recovery, mobile device, security and billing integration tests before release.

## Outstanding release blockers
- Provider-signed billing webhooks, durable entitlement projections and reconciliation.
- Durable reservation expiration, recovery and refunds after inference failure; crash recovery for `running` requests.
- Enforced global abuse limits, per-user request concurrency, and idempotency retention cleanup.
- Production inference deployment, prompt-injection red-team testing, output factuality/safety checks.
- Complete Android keyboard UX (typing keys, accessibility, secure field classification, text-selection UX), lifecycle and sign-in integration.
- iOS extension, notification listener, and supported external app integrations are not implemented.
- Consent records, retention/deletion workflows, privacy review, telemetry and incident response.
- Full production readiness gate: TLS, secrets, backup, load, failover, penetration test, staged rollout.

## API contract
`GET /v1/entitlements` -> tier and plan features.
`POST /v1/replies` -> requestId UUID, message, optional context, tone, variants, consent:true. Returns `replies` and tier. No auto-send endpoint exists.

## Integrated into A-Zee (this repository)

The server half is built into the main A-Zee web app instead of running the standalone `server/` service
(which is kept here as the reference it was ported from):

| Reference | A-Zee integration |
|---|---|
| Fastify `GET /v1/entitlements` | `GET /api/linqext/entitlements` (`app/api/linqext/entitlements`) |
| Fastify `POST /v1/replies` | `POST /api/linqext/replies` (`app/api/linqext/replies`) |
| JWT + JWKS verification | A-Zee's own session (Bearer token from the mobile app, `X-AZ-Client: mobile`) |
| `az_entitlements`, billing webhook | The real plan and billing (`lib/plans.ts`, Stripe); `lib/linqext/policy.ts` maps Free/Go -> free/plus, Plus -> plus, Pro/Business/Enterprise -> premium |
| `az_usage` quota | The plan's existing monthly **messages** allowance (one reply = one message), reserved and refunded by the chat pipeline |
| `az_requests` idempotency | `linqext_requests` (migration 029): replay, conflict, retry after failure, 7-day retention, deleted with the account |
| Inference gateway | The A-Zee chat pipeline (moderation, PII redaction, provider failover) |
| Fastify tests | `tests/linqext.test.ts` |

Code: `lib/linqext/policy.ts`, `lib/linqext/service.ts`. Run `npm run db:migrate` for migration 029.

Still open (unchanged from the blockers above): Android `SessionTokenProvider` is fail-closed. The keyboard runs in
its own process and cannot read the Expo app's secure storage, so a native bridge is needed to hand it the session
token (and a native Android project via `expo prebuild`). iOS, a complete keyboard UI, and consent records are not
built. Per-user concurrency limits use the shared `linqext` rate limit (20 requests/minute).

## Android keyboard (production module)

The prototype under `android/` is superseded by the Expo local module in `mobile/modules/azlinqext`:

| Piece | Where |
|---|---|
| Keyboard service (typing keys, suggestion bar, insert) | `modules/azlinqext/android/.../ime/` |
| Suggestion flow, API client, field privacy policy, insert planner | `modules/azlinqext/android/.../ai/` |
| Encrypted credential store (Android Keystore, no-backup storage) | `modules/azlinqext/android/.../store/` |
| App <-> keyboard bridge (`linkKeyboard`, `unlinkKeyboard`, `getStatus`, settings/picker) | `AzLinqextModule.kt`, `modules/azlinqext/index.ts` |
| Setup, privacy choice, plan and allowance screen | `src/app/(app)/keyboard.tsx`, `src/lib/keyboard.ts` |
| Server: scoped keyboard credentials, consent, usage | `lib/linqext/*`, `app/api/linqext/*`, migrations 029 and 030 |

Authentication: the keyboard never gets the app's session. `POST /api/linqext/keyboard/link` (app session) mints a
15-minute access token plus a rotating refresh token that only `/api/linqext/*` accepts and that dies with the
app session. See `docs/azlinqext-privacy-review.md`.

Draft only: replies are shown in the keyboard and typed into the field only when the user taps one. Nothing is
sent. `NoAutoSendTest` fails the build if the AI code or manifest gains a send mechanism.

Run the unit tests: `cd mobile && npx expo prebuild --platform android --no-install && cd android && ./gradlew :azlinqext:testDebugUnitTest`.
Physical-device checklist: `docs/azlinqext-device-test-plan.md`.

Known limits of this version: English (US) QWERTY only, no swipe typing, no predictions or auto-correct, no emoji
panel, no iOS keyboard, and no reading of earlier messages from other apps (the server supports context, the keyboard
sends only the selected message). Only the user's own typing app is involved: there is no accessibility service or
notification access.
