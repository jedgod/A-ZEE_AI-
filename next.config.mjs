// `npm run dev:lan` (scripts/dev-lan.cjs) passes this PC's LAN addresses so Next's dev server
// accepts requests from phones and tablets on the same Wi-Fi. Empty (a no-op) everywhere else.
import { fileURLToPath } from 'node:url';
const lanHosts = (process.env.AZ_DEV_LAN_HOSTS ?? "").split(",").map(h => h.trim()).filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  allowedDevOrigins: lanHosts,
};

export default nextConfig;
