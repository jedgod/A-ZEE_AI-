# AZLinqext: physical-device test plan

Run on real hardware with a release-signed (or `preview` profile) build. Record the device, Android version,
build number and result for every line. A box is only ticked when it passed on a physical device.

Build: `cd mobile && eas build --platform android --profile preview` (installable `.apk`), or
`npx expo run:android --variant release --device`.

Devices (minimum): one Samsung (One UI), one Pixel (stock), one other OEM (Xiaomi/OnePlus/Motorola); Android 8, 11, 14 and the latest;
one small phone (<=5.5"), one large phone, one tablet; one device with gesture navigation, one with 3-button.
Server: a staging A-Zee server over **HTTPS**, test accounts on **Free**, **Plus** and **Business/Premium** plans, and one account with its monthly allowance used up.

## 1. Setup and activation
- [ ] App: Account > AZLinqext keyboard opens. Step 1 lists exactly what is sent and not sent; the switch is off by default.
- [ ] Switching consent on connects the keyboard ("Connected to your account" shows a tick).
- [ ] "Turn on AZLinqext" opens Android's keyboard list; after enabling and returning, step 2 shows a tick without restarting the app.
- [ ] "Choose keyboard" shows the system picker; after choosing, step 3 ticks.
- [ ] Android's own "AZLinqext" entry appears in Settings > System > Languages & input > On-screen keyboard.
- [ ] Switching consent **off** disconnects at once; Suggest then says to turn it on.

## 2. Typing (physical typing quality)
- [ ] Letters, shift (one letter), caps lock, numbers/symbols layers, comma, period, space, backspace (tap and hold), enter.
- [ ] Auto-capitalise at the start of a sentence in a chat app; no capital in a username field.
- [ ] Enter shows the right label (Send/Go/Search/Next/Done) and does that action; in a multi-line note it inserts a line break.
- [ ] Globe key switches to the previous keyboard; works when AZLinqext is the only keyboard (shows the picker).
- [ ] Portrait and landscape; keys are reachable on the small phone; no key overlaps the nav bar; split-screen and tablet width.
- [ ] Dark and light themes follow the system; text is readable in both.
- [ ] Rotation and app switch while typing do not lose text or crash.
- [ ] TalkBack: every key and button is announced ("Backspace", "Shift", "Space", "Reply 1 of 3 ..."); the status line is announced when it changes.
- [ ] Large font / display size: nothing is clipped beyond use.

## 3. Reply suggestions and insertion (end to end)
Run in each: Google Messages (SMS), WhatsApp, Telegram, Signal, Gmail compose, Outlook, Slack, Chrome (a text box), a notes app.
- [ ] Select a received message (or paste it), tap **Suggest**: replies appear within ~15 s.
- [ ] Tapping a reply puts it in the field (replacing the selected/typed message). **The message is NOT sent**; the app's send button still has to be pressed.
- [ ] Typing a message, tapping Suggest and tapping a reply replaces exactly that text.
- [ ] **Clipboard** button: copy a message elsewhere, then tap it; the reply is typed at the cursor.
- [ ] If you type or move the cursor after Suggest and then tap a reply, nothing is inserted and the bar says why.
- [ ] Switching app or field while it is "Writing a reply..." leaves nothing in the new field and no stale suggestions.
- [ ] Hiding the keyboard clears the suggestions.
- [ ] Tone and reply-count buttons: only the options the plan allows are offered.
- [ ] Airplane mode: a clear "Can't reach A-Zee" message; typing still works. Toggle it off mid-request: one retry, one reply, one charge.
- [ ] Double-tapping Suggest quickly does not produce two charges for one tap (check the remaining count).

## 4. Privacy
- [ ] In a password field (login screen of any app), a web address bar, an email-address field, a name field, a phone/number field: the AI buttons are greyed out and say so; typing still works; nothing is sent (confirm in the server log).
- [ ] In an incognito tab: AI off.
- [ ] The keyboard never reads text without a tap: leave it open while typing a long message; confirm zero requests on the server.
- [ ] No message text appears in the server's logs for these tests.
- [ ] Android 13+: the clipboard "pasted from AZLinqext" toast appears only when Clipboard is tapped.

## 5. Authentication and sessions
- [ ] After sign-out in the app, the keyboard shows "Not connected" and Suggest does nothing; reconnecting works.
- [ ] Sign-out on **another device** (sign out everywhere) disconnects this keyboard within one request.
- [ ] Changing the password on another device disconnects this keyboard; this device's own change keeps it.
- [ ] Switching accounts (sign out, sign in as someone else) never shows the first account's plan or lets it send.
- [ ] Deleting the account removes the keyboard credential; the keyboard says "Not connected".
- [ ] Leave the phone idle for >15 minutes: the next Suggest works without reconnecting (silent renewal).
- [ ] Revoke the link on the server (set `revoked_at`): next Suggest prompts to reconnect.
- [ ] Uninstall and reinstall: keyboard is not connected (no backup restored).
- [ ] Device with a screen lock removed/changed (Keystore key lost): keyboard asks to reconnect, does not crash.

## 6. Subscription and limits
- [ ] Free: 1 reply, casual/professional, short replies, no earlier-message context; plan card shows the allowance.
- [ ] Plus: up to 3 replies and more tones. Premium/Business: up to 5, custom tone.
- [ ] Downgrade a test account on the server: the keyboard drops to the lower options on its next request (within the plan refresh), and an over-limit request is refused with a plain message.
- [ ] Exhausted allowance: Suggest says the month's replies are used; nothing is charged; typing still works.
- [ ] The remaining count in the bar and in the app agree and decrease by one per reply.
- [ ] No purchase screens or purchase links in the app or keyboard (store policy).

## 7. Robustness
- [ ] Low memory / battery saver / Doze: the keyboard still appears and types.
- [ ] 30 minutes of normal typing in a chat app: no crash, no ANR, no visible lag. `adb shell dumpsys meminfo <package>` stays flat.
- [ ] Rapid switching between apps with the keyboard open.
- [ ] Android's "Remove" of the keyboard from settings, then re-enable.
- [ ] Release build only: confirm minification does not break anything (the module has no reflection).

## Sign-off
Device matrix filled in, every box above ticked or tracked as a defect, privacy review (`azlinqext-privacy-review.md`) signed off, Play Data Safety and keyboard policy declarations submitted.
