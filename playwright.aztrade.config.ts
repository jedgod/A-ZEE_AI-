import { defineConfig } from "@playwright/test";

// Real-browser certification of AZTrade inside A-Zee. Needs the services started by AZTrade's scripts/run-e2e.ps1.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /aztrade\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: process.env.AZTRADE_E2E_JSON ?? "aztrade-e2e.json" }]],
  use: { baseURL: process.env.AZTRADE_E2E_BASE ?? "http://localhost:3100", channel: process.env.AZTRADE_E2E_CHANNEL ?? "msedge", headless: true, trace: "off" },
});
