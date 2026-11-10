# AZLinqext Android: install and end-to-end certification runbook

**Certification status: NOT CERTIFIED.** No physical-device run has been recorded. Nothing below may be reported as
passed until a real Android device completes it and the evidence table at the end is filled in by the tester.
Scope: Android keyboard only. iOS is out of scope for this release (architecture stays extensible; no iOS work started).
Release status: **NO-GO** until the security, deployment and physical-device gates all pass.

## 1. Prerequisites
- A physical Android device (not an emulator), USB debugging enabled, `adb devices` shows it as `device`.
- A **staging** A-Zee server reachable over HTTPS. The staging environment name/host is to be confirmed from real
  infrastructure; `mobile/eas.json` currently holds only a placeholder (`https://your-staging-server.example`).
  Do not point a build at production.
- Test accounts: Free, Plus, Business/Premium, and one with its monthly allowance exhausted.
- The inference path must go through the A-Zee chat pipeline. The app/keyboard must never contain or show a third-party AI provider name or credential.

## 2. Build the installable APK
Preview profile (installable `.apk`, staging URL):
```
cd mobile
# set EXPO_PUBLIC_API_URL for the preview profile in eas.json to the CONFIRMED staging URL first
eas build --platform android --profile preview
```
Local alternative (release variant straight to a connected device):
```
cd mobile
npx expo run:android --variant release --device
```
A debug APK from an earlier local build exists at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`; do not use a
debug build for certification (it is not minified or release-signed).

## 3. Install
```
adb devices
adb install -r path\to\app.apk
adb shell pm list packages | findstr com.azee.app
adb shell dumpsys package com.azee.app | findstr versionName
```
Record the device model, Android version and the build/version in the evidence table.

### 3a. Device-impact check (read-only, performed 2026-11-09 on device R9TT703HH0Y, SM-A037U, Android 13)
Nothing was installed. Findings:
- Package `com.azee.app`, version 1.0.0 (versionCode 1), **already installed** (first install 2026-11-08, last update 2026-11-09 00:49), debuggable, minSdk 24 / targetSdk 36.
- The local candidate `mobile/android/app/build/outputs/apk/debug/app-debug.apk` has the **same SHA-256** as the installed base.apk
  (`4FC5FF70766B35957845A70662BC1AC4C00AE1FF5BDE1F4394D791489B2927AD`) and the same signer (CN=Android Debug, cert SHA-256
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`). Reinstalling it would change nothing.
- The AZLinqext IME `com.azee.app/expo.modules.azlinqext.ime.AzKeyboardService` is registered on the device today.
- Only one AZ package exists on the device; no other app is affected by an install of this package.
- Device storage is 96% used (~0.9 GB free); a ~70 MB update is possible but leaves little room.
- **Backend gap:** this is a *debug* build (it loads a development JS bundle) and no staging backend exists, so it cannot yet exercise
  authentication, consent, AI replies, revocation or entitlements end to end. A preview build needs a confirmed staging HTTPS URL
  (`mobile/eas.json` still holds a placeholder) and disposable test accounts.

If a **different** build is later installed, use (replaces in place, **preserves app data**, keeps the keyboard registration, restarts the app process):
```
adb -s R9TT703HH0Y install -r path\to\new.apk
```
This works only if the new build has the same package ID and signing certificate; a different signature fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, and the only way past that is uninstalling, which **erases app data and the keyboard
credential**. Do not uninstall without explicit approval. Back up nothing sensitive: use disposable accounts only.
**Explicit approval is still required before any install.**

## 4. Run the tests
Execute every item in [`azlinqext-device-test-plan.md`](azlinqext-device-test-plan.md) (setup, typing, reply suggestions
and user-controlled insertion, privacy, authentication/session revocation, subscription limits, robustness). Items that map
directly to this release's scope:

| Scope item | Plan section | Must observe |
|---|---|---|
| Authentication | 5 | sign-out / sign-out-everywhere / password change / revoke each disconnect the keyboard on its next request |
| Consent | 1 | switch off by default; off disconnects at once; nothing sent without consent |
| AI reply generation | 3 | replies arrive; one charge per reply; retry after airplane mode gives one reply, one charge |
| User-controlled insertion | 3 | reply is inserted only on tap; **never auto-sent**; stale cursor/field blocks insertion |
| Session revocation | 5 | server-side `revoked_at` forces reconnect |
| Subscription enforcement | 6 | downgrade drops options on the next request; exhausted allowance refuses without charging |
| Provider secrecy | 4 | inspect traffic/logs/app strings: no third-party AI provider name or credential |

Useful evidence commands:
```
adb logcat -d -s AZLinqext > logcat.txt          # confirm no message text, tokens or credentials appear
adb shell dumpsys meminfo com.azee.app            # 30-minute soak: memory stays flat
adb shell ime list -s                             # keyboard registered
```
On the server, confirm for the privacy cases that **zero** requests arrived from protected fields and that logs contain no message text.

## 5. Evidence table (tester fills in; leave blank until actually run)
| Device | Android | Build | Date | Tester | Sections passed | Defects | Result |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

A device row counts only when every box in the test plan is ticked or tracked as a defect. Physical-device certification is
claimed only when the table has a completed row for the required device matrix.
