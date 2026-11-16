// `npm run dev:lan` (scripts/dev-lan.cjs) passes this PC's LAN addresses so Next's dev server
// accepts requests from phones and tablets on the same Wi-Fi. Empty (a no-op) everywhere else.
import { fileURLToPath } from 'node:url';
const lanHosts = (process.env.AZ_DEV_LAN_HOSTS ?? "").split(",").map(h => h.trim()).filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  allowedDevOrigins: lanHosts,
  serverExternalPackages: ["@contentauth/c2pa-node"],
  // Dev server only: keep compiled routes for an hour instead of ~25 s. Without this, the AZTrade AI route
  // recompiles (40-50 s) on almost every use, which is longer than the AZTrade backend waits for it.
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 40 },
};

export default nextConfig;
