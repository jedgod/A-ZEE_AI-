import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:3000", channel: "msedge", headless: true },
  timeout: 60000,
});
