# Your data

This is the text shown in the app under **Privacy → Your data** (see `app/page.tsx`). Keep the two in sync.

**Preventing abuse of the free plan.** When you sign up, sign in or use the app we keep a small amount of technical information:

- **Device cookie**: a random identifier in an HttpOnly cookie (`az_dev`), so we can recognize the same browser. The mobile app uses a random install id instead.
- **Browser fingerprint**: a hash of basic properties (browser, language, screen size, time zone). It isn't used to identify you across the internet.
- **IP address**: recorded only when a trusted proxy reports it, and never used on its own to link accounts.

This is used only to spot several free accounts on one device after the free allowance has been used, in which case we may ask you to upgrade. Paying customers are never affected, and no one is banned for this. We don't sell this information or use it for advertising. It is deleted after 90 days.

**Deleting your account.** You can delete your account and its data at any time at `/account/delete`, on the website or in the mobile app. Your chats, projects, favorites, prompts, notifications, saved payment methods, subscription and usage records are deleted. Payment records are kept without a link to you, as accounting rules require. If you had used your free allowance, the device signals from it are kept for up to 90 days under an id that points at no one, so the free plan can't be reset by deleting and re-registering.

## Store listing checklist

- Privacy policy URL: your published privacy policy (must mention the above).
- Google Play "Delete account" URL: `https://<your domain>/account/delete`.
- App Store: the in-app **Delete account** (Account tab) satisfies guideline 5.1.1(v).
