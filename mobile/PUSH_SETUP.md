# Lock-screen price alerts: one-time setup

The server side is done (token route, Expo push sender, alert worker). The app registers its token automatically
(`src/lib/push.ts`) once it is a build that includes the notification module and the project has push credentials.
Until then alerts still arrive in the in-app Notifications (the bell).

## What only you can provide
1. **Firebase project** (console.firebase.google.com) with an Android app whose package name is `com.azee.app`.
   Download **google-services.json** into `mobile/android/app/`.
2. **EAS project**: run `npx eas-cli@latest init` in `mobile/`. It writes `extra.eas.projectId` into `app.json`.
3. **FCM credentials on Expo**: in the Firebase console create a service-account key (Project settings > Service accounts),
   then upload it to Expo (`npx eas-cli@latest credentials`, Android > Google Service Account Key for push notifications (FCM V1)).

## Native changes (hand-made in this project: do NOT run `expo prebuild`, it regenerates and can wipe `android/`)
- `android/build.gradle`: add `classpath 'com.google.gms:google-services:<current version>'` to the buildscript dependencies.
- `android/app/build.gradle`: add `apply plugin: 'com.google.gms.google-services'` below the existing `apply plugin` lines.
- `AndroidManifest.xml`: `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>` (Android 13+).
- Then rebuild once: `npx expo run:android --device <id>` (same command used for the earlier builds).

## Test
Sign in on the phone, accept the notification prompt, then trigger an alert (a rule such as "price rises to 1") and run
`npm run monitor:worker -- --once`. The alert should arrive on the lock screen as well as in the bell.
