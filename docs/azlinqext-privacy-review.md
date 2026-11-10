# AZLinqext privacy review

Scope: the AZLinqext Android keyboard, its two server endpoints, and the data they touch. This is the
engineering record for the privacy review. It is not legal advice; the privacy policy text, Google Play's
Data Safety form and any regional requirements (GDPR, UK GDPR, CCPA/CPRA, COPPA) still need sign-off from
whoever owns compliance.

## What the keyboard does with text

| Moment | What happens | Where it goes |
|---|---|---|
| The user types | Keys are handled on the device. Typed text is **not** read, stored, logged or transmitted. | Nowhere |
| The user taps **Suggest** | The keyboard reads the message the user **selected**, or the text before the cursor if nothing is selected (at most 4,000 characters). | Sent to A-Zee over HTTPS |
| The user taps **Clipboard** | The keyboard reads the clipboard once, at that tap. | Sent to A-Zee over HTTPS |
| A reply comes back | Shown in the bar. Held in memory only. | Nowhere |
| The user taps a reply | The reply is typed into the field (replacing the text it was made from). Nothing is sent. | The text field |
| The field changes, the keyboard hides, or the app switches | Everything shown is dropped. A late answer is discarded. | Nowhere |

The keyboard never reads text in the background, never sends a message, never presses Enter for a suggestion,
and has no accessibility service, notification listener or SMS permission. (`NoAutoSendTest` fails the build if
any of those appear in the AI code or the manifest.)

### Fields where the AI is switched off
Password fields (text, visible, web, number), email-address fields, web-address fields, person-name and
postal-address fields, number and phone fields, fields with no text input, and any field that asks keyboards
not to learn from it (`IME_FLAG_NO_PERSONALIZED_LEARNING`, used by incognito and private browsing). Typing
works everywhere; only "send this text to A-Zee" is off. Enforced in `FieldPolicy` and tested.

## Consent
- The user must switch on **"Let AZLinqext write replies to messages I choose"** in the app, with the list above shown next to the switch.
- The choice is stored **on the server** (`linqext_consents`, with a version). `POST /api/linqext/replies`
  refuses with `CONSENT_REQUIRED` without it, whatever the client claims. Changing what is sent means bumping
  `CONSENT_VERSION`, which asks everyone again.
- Withdrawing is one tap. It records the change and disconnects the keyboard immediately.
- "Earlier messages for context" is a separate server flag, and the keyboard never sends context: it sends only the one message.
- Consent and keyboard links are deleted with the account.

## Data inventory

| Data | Where | Retention |
|---|---|---|
| The selected message and the generated reply | In flight to the A-Zee server and the AI model provider, then discarded by A-Zee. The reply is kept in the idempotency record below. | See below |
| Idempotency record (`linqext_requests`): request id, a hash of the request, status and the **reply text** | A-Zee database | **7 days**, then deleted; deleted with the account. The message itself is **not** stored, only its hash. |
| Usage count (one per reply) | A-Zee database (`usage_counters`) | With the account |
| Consent record | A-Zee database | With the account |
| Keyboard link (`linqext_keyboard_links`): token **hashes**, device install id, timestamps | A-Zee database | Expires after 30 days; revoked links purged after 7 days; deleted with the account |
| Keyboard credential, cached plan and random install id | On the phone, in one file encrypted with a non-exportable Android Keystore key, in the app's no-backup storage | Erased on sign-out, on withdrawing consent, on account switch, and when the server revokes the link |
| Message text in logs | **None.** The pipeline's operations log stores metadata only, no prompt or answer text (see `lib/pipeline/operations.ts`); the pipeline redacts personal data before the model sees it; the keyboard logs nothing about text. Re-check this line against the logging configuration of the production host before sign-off. | n/a |

Not collected: contacts, location, advertising id, typed text, screen contents, other apps' data, analytics about what people type.

Processors: the AI model provider(s) configured on the A-Zee server receive the (PII-redacted) message to
write the reply. List them in the privacy policy.

## Credentials (what the keyboard can and can't do)
- The keyboard never holds the user's A-Zee session. The signed-in app asks the server for a **keyboard link**: a 15-minute access token and a rotating refresh token (30-day maximum life).
- Those tokens work **only** for `/api/linqext/*`. They cannot read chats, the account, billing or anything else, and an app session token cannot be stored in the keyboard (the native module refuses it).
- A link is **bound to the app session** that created it. Sign-out, sign-out-everywhere, a password change on another session, session expiry, or account deletion all end it on the server immediately.
- Refresh tokens rotate on every use. Reusing an old one (outside a 30-second tolerance for a lost response) revokes the whole link.
- On the phone the credential is AES-256-GCM encrypted under a hardware-backed, non-exportable key, in no-backup storage, so it is not backed up or restored onto another device.
- The keyboard talks HTTPS only (plain HTTP is allowed solely for development builds) and never follows redirects.

## Google Play Data Safety (suggested answers, to confirm)
- Data collected: **Personal info** (name, email: account), **Messages/User content** (the selected message text, transiently, to write a reply), **App activity** (usage count), **Device or other IDs** (random install id, abuse prevention).
- Collected data is **encrypted in transit**. Users can **request deletion** (in-app and at `/account/delete`).
- Not sold. Not used for ads. Shared with service providers (AI model providers) only to provide the feature.
- Keyboards are a sensitive category on Google Play: the listing must state plainly that selected text is sent to A-Zee **only when the user taps Suggest**, and the keyboard must stay usable without that.

## Risks accepted or open
- The model provider sees the redacted message text. If A-Zee adds a "no third-party processing" tier, route this feature through it.
- Redaction is best-effort (pattern based). Do not describe it as a guarantee.
- A user can still tap Suggest on a message that contains someone else's private information. This is the same trade-off as any assistant; the product copy says what is sent.
- Under-18 users: the keyboard has no age gate of its own. Follow the account-level policy.
- Device-level key loss (factory reset, new lock screen): the store can't be read, is discarded, and the keyboard asks the user to reconnect. No data is lost server-side.
