import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "marketplace-host-fees.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "C:/tmp/zyon-marketplace-readiness-20260929/.audit/marketplace-readiness/host-fee-dashboard-browser-v1",
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://localhost:5198",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 320, height: 720 } } },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host localhost --port 5198 --strictPort",
    url: "http://localhost:5198",
    env: { VITE_API_BASE_URL: "http://localhost:5198/audit-api" },
    reuseExistingServer: false,
    timeout: 60000,
  },
});
