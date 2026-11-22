import { defineConfig } from "@playwright/test";

const baseURL = process.env.PROSPECTING_CONTROL_TEST_URL ?? "http://127.0.0.1:5179";
const url = new URL(baseURL);
if (url.origin !== "http://127.0.0.1:5179" || url.pathname !== "/" || url.search || url.hash) throw new Error("prospecting_browser_requires_loopback");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /prospecting.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, ignoreHTTPSErrors: true, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 10_000 },
  projects: [1440, 390, 320].map(width => ({ name: `control-${width}`, use: { browserName: "chromium" as const, viewport: { width, height: 900 } } })),
  globalSetup: "./tests/prospecting-playwright-runtime.ts",
});
