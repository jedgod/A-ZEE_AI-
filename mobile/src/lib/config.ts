// The A-Zee server the app talks to. Set EXPO_PUBLIC_API_URL when you build or start the app:
//   development on your PC:   EXPO_PUBLIC_API_URL=http://<your PC's LAN address>:3000   (npm run dev:lan)
//   a store build:             EXPO_PUBLIC_API_URL=https://your-domain.example      (HTTPS is required)
// Store builds must use HTTPS: iOS blocks plain http by default, and Android does too.

const raw = process.env.EXPO_PUBLIC_API_URL ?? "";

export const API_URL = raw.replace(/\/+$/, "");
export const API_CONFIGURED = /^https?:\/\/[^/\s]+/.test(API_URL);

export const MAX_MESSAGE_CHARACTERS = 20_000; // the server's limit for one message
export const MAX_CONTEXT_MESSAGES = 24;       // the server's limit for one request
