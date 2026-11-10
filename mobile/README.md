# A-Zee mobile app

Native app for iPhone, iPad, Android phones and Android tablets, built with Expo (React Native).
It signs in to your A-Zee server and offers chat (Chat and Code modes), History, Favorites, the Prompt
Library, Notifications and Account (change password, sign out everywhere, **delete account**).
On tablets, and phones turned sideways, saved chats appear in a sidebar beside the conversation.

It talks to the same API as the website. The app is **free-tier friendly by design**: plans and
payments are managed on the website, and the app has no purchase screens (see "Store rules" below).

## Run it

```bash
cd mobile
npm install
# Point the app at your server (the web app must be running):
#   LAN testing from your PC:   run `npm run dev:lan` in the project root, then use the address it prints
EXPO_PUBLIC_API_URL=http://10.0.0.237:3000 npx expo start        # PowerShell: $env:EXPO_PUBLIC_API_URL="http://10.0.0.237:3000"; npx expo start
```

Scan the QR code with **Expo Go** (iOS Camera / Android Expo Go app) on a phone or tablet on the same
Wi-Fi. For store builds the server address must be **HTTPS**.

> Server side: the app signs in with `Authorization: Bearer <token>` and the `X-AZ-Client: mobile`
> header (no cookies, no Origin header). That support, and account deletion, are in `lib/users/auth.ts`
> and `lib/users/deletion.ts` in the web project; run `npm run db:migrate` there first (migration 028).

## Build for the stores

You need your own accounts: **Apple Developer Program** (US$99/year) and **Google Play Console** (one-time
US$25), and an **Expo account** for EAS Build.

1. Pick your identifiers in `app.json`: `ios.bundleIdentifier` and `android.package` (currently `com.azee.app`).
2. Put your production server address in `eas.json` (`build.production.env.EXPO_PUBLIC_API_URL`, HTTPS).
3. Replace the placeholder icons in `assets/` with your artwork (or rerun `node scripts/make-assets.cjs`).
4. Build and submit:
   ```bash
   npm install -g eas-cli
   eas login
   eas build:configure            # first time only
   eas build --platform all --profile production
   eas submit --platform ios      # uploads to App Store Connect / TestFlight
   eas submit --platform android  # uploads to Google Play (create the app in the Console first)
   ```
5. Quick testing without stores: `eas build --platform android --profile preview` makes an installable `.apk`
   you can send to testers; `--profile development` makes a development client for iOS/Android.
6. After release, put the store links in the web server's environment (`APP_STORE_URL`, `PLAY_STORE_URL`)
   so the website's "Download apps" menu shows them.

## Store rules this app is built around

- **Account deletion** (Apple 5.1.1(v), Google Play): in the app under Account → Delete account, and on the
  web at `/account/delete`. Put `https://<your domain>/account/delete` in Play Console's "Data deletion" field.
- **Payments**: Apple and Google require their own in-app purchase for digital subscriptions, so the app does
  not sell plans or link out to buy them. Plans are managed on the website. If you later want purchases inside
  the app, that needs StoreKit / Play Billing (for example through RevenueCat) and server changes.
- **Privacy**: publish a privacy policy that matches the "Your data" notice (`docs/your-data-notice.md`) and
  fill in Apple's "App Privacy" and Google's "Data safety" forms: account info (name, email), user content
  (chats, prompts), identifiers (a random install id), and diagnostics for abuse prevention.
- **Review access**: Apple and Google reviewers need a working login. Create a demo account (verified email)
  and put its credentials in the review notes.
- **Sign in with Apple**: only required if you add third-party social login (Google, Facebook...). The app
  uses its own email + password, so it isn't required.
- **Age rating / content**: the app is a general AI assistant; answer the questionnaires honestly (user-generated
  content, AI-generated content) and keep your server-side moderation on.

## Layout

```
src/app/(auth)      sign-in, register, verify email
src/app/(app)       signed-in screens: tabs (Chat, History, Favorites, Library, Alerts, Account), delete-account
src/lib             api (headers, errors), auth (session in secure storage), chat, theme
src/components      shared UI, chat list, message text
```

The session token and a random install id are kept in the device's secure storage (iOS Keychain,
Android Keystore-backed storage).
