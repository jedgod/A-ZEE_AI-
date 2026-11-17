# Image classification and public copy discovery

The image check now supports four independent evidence sources: signed C2PA declarations, the configured local copy index, Sightengine's `genai` pixel classifier, and Google Cloud Vision `WEB_DETECTION`. Gemini visual observations remain separate. A signed-origin verdict is never overwritten by a classifier score or a public-copy match.

## Local activation

Configure these server-only values in `AZ_AI/.env.local` or your secret manager, then restart the local Next server. Empty placeholders are present in `.env.local`; no existing values were replaced.

```dotenv
SIGHTENGINE_API_USER=
SIGHTENGINE_API_SECRET=
GOOGLE_VISION_API_KEY=
```

Sightengine requires an enabled account for its `genai` model. Google Cloud Vision requires an enabled Vision API, billing/quota and an API key restricted to that service. A Gemini key does not establish Vision API availability. Never put these credentials into mobile `EXPO_PUBLIC_*` variables.

Run `node scripts/migrate.cjs` before serving the new routes. Migrations `047_image_provider_requests.sql` and `048_image_provider_usage.sql` were applied to the configured local PostgreSQL database on 2026-11-16. Results already persist inside `image_scans.verification`; no image blobs or public image-hosting service are added. Provider estimates and public links survive normal scan-history reloads.

The local development server launched for this change uses `http://localhost:3001`, matching the configured app origin. This is a local development run, not a production deployment. A physical phone needs a reachable API origin and the normal LAN development configuration; its `localhost` is the phone itself.

## Request and consent contract

Authenticated `POST /api/vision/detect-ai` accepts one image file and independent multipart fields:

| Field | Exact opt-in value | Recipient and purpose |
| --- | --- | --- |
| `googleConsent` | `true` | Google Gemini visual observations |
| `classifierConsent` | `true` | Sightengine AI-generation estimation |
| `discoveryConsent` | `true` | Google Cloud Vision public image matching |

Missing fields and `false` do not authorize that provider. Duplicate or malformed consent fields are rejected. Choices are per image and are never reused. Mobile and web query capabilities without sending an image, then ask only about configured providers. A failed capability lookup leaves every optional upload disabled. Canceling the mobile image check before submission sends no image.

`GET /api/vision/capabilities` reports implementation and configuration separately, without returning credentials. `AZ_PROVIDER_MODE=ollama-only` disables all external image processing regardless of client consent.

## Evidence interpretation

`verification.classification` reports the provider, `genai` model, provider-managed version, score, timestamp, and `calibrated: false`. Scores at or above 0.9 yield `LIKELY_AI`; scores at or below 0.1 yield `LOW_AI_SIGNAL`; intermediate scores abstain as `INCONCLUSIVE`. These conservative display thresholds have not been calibrated on an A-Zee real-world benchmark. Low AI signal does not establish camera capture or absence of editing. This model estimates full AI generation, not all possible manipulations or deepfakes.

`verification.discovery` reports public provider-index matches, query time, match category and domain-based platform labels. Matching pages, full visual image matches and partial visual image matches are distinguished; none is labeled a byte-exact match. Only the local SHA-256 comparison can establish identical bytes. Search time is not first publication time.

Domain labels include TikTok, Facebook, Instagram, X, LinkedIn, YouTube, Telegram, WhatsApp, Signal, Tinder, Bumble and Hinge when those domains actually appear in provider results. This does not grant direct access to those platforms. No platform-wide completeness, private messages, private profiles, closed groups, identity/face search or dating-profile coverage is promised. No specific "Vibe" service has been identified or integrated. Unknown domains are labeled public web. Public search and AI classification can both return evidence for the same image.

Statuses distinguish `skipped`, `not_configured`, `unavailable` and `checked`. A successful empty search means only that this provider returned no matches. Provider errors never become an authenticity or no-internet-copy verdict.

## Hardening and operations

- Local decoding, supported-format, input-byte and pixel limits run before external work. Discovery uses a metadata-stripped, resized JPEG copy to bound inline request size; Sightengine receives the validated original file. No temporary public image is hosted.
- New provider requests use fixed HTTPS endpoints, no redirects or retries, 12-second deadlines, bounded response reads and strict parsed output. Neither provider-returned error text nor secrets are persisted or returned.
- Returned links are validated and deduplicated; at most twenty are retained. The app does not fetch provider-returned URLs, render remote thumbnails or follow them for crawling. Opening a link is a user action.
- Before configured external processing, PostgreSQL reserves an attempt under a transaction-level advisory lock: twenty attempts per account and two hundred globally over a rolling 24 hours, one active scan per account and six active scans globally. Failed attempts count, and deleting scan history does not reset usage. Stale active leases expire for concurrency counting after ninety seconds. The anonymous global usage counter survives account deletion and uses conservative hourly buckets covering the last 24-25 hours. These limits cover all app workers; they do not replace provider-account spending caps.
- `image_provider_requests` stores owner, exact provider consent, timestamps, completion state and an optional scan reference. Deleting a scan clears that reference; deleting its account cascades the receipt. It stores no image bytes. Set a retention policy for consent receipts appropriate to the deployment.
- Existing authentication, same-origin protection, account-owned history and request rate limiting remain in force. A failed database reservation prevents provider work.

## Validation and remaining checks

The provider and vision tests include one optional real-corpus benchmark that is skipped without a supplied manifest. Tests cover independent consent, private mode, missing keys, malformed scores, provider errors, timeouts, oversized responses, URL filtering, domain boundaries, result limits, database budgets and local-image behavior. TypeScript checks cover web/server and mobile.

Live provider acceptance, billing setup, real-corpus accuracy calibration and physical-device verification require configured credentials and deployment evidence. Functional tests must not be represented as detector accuracy certification. The optional real-corpus benchmark uses `AZ_IMAGE_BENCHMARK_MANIFEST`.

Provider contracts were checked against [Sightengine's AI image API](https://sightengine.com/docs/ai-generated-image-detection), [Google Web Detection](https://docs.cloud.google.com/vision/docs/detecting-web), and the [Cloud Vision REST endpoint](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate).

Local smoke check: `node scripts/check-image-providers.cjs` verified authenticated capabilities, all-false consent, PostgreSQL result persistence, history reload, duplicate-consent rejection, origin checks and unauthenticated rejection. It creates and cleans up a temporary account and makes no external provider call. Mobile lint setup was attempted but failed on an existing React/React DOM peer-dependency conflict; partial dependency additions were removed.

Final validation: the full vision suite passed 63 tests with one optional corpus benchmark skipped; the final anonymous-counter budget regression passed all seven tests. Final web/server and mobile TypeScript checks passed. Both local database migrations and the HTTP/PostgreSQL smoke check passed. Live classifier/search calls remain pending provider-key configuration.

Activation verified on 2026-11-16: Sightengine credentials were synchronized from the older .mirror configuration into the updated app configuration. The live classifier smoke check passed against http://localhost:3001, including persistence and consent receipts. Run node scripts/check-image-providers.cjs --live-classifier only when explicitly intending to send its generated test image to Sightengine; the default smoke check still makes no external upload. Google Cloud Vision remains unconfigured. No secrets are recorded here.
