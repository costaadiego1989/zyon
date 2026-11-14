import { defineConfig, devices } from "@playwright/test";

// Real local browser, simulated authenticated API transport. No provider writes.
export default defineConfig({
  testDir: "./e2e", testMatch: "marketplace-refunds.spec.ts", workers: 1, retries: 0,
  reporter: [["list"]], outputDir: "test-results/marketplace-refunds", timeout: 30000,
  use: { baseURL: "http://localhost:5191", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: { command: "node node_modules/vite/bin/vite.js --host localhost --port 5191 --strictPort", url: "http://localhost:5191",
    env: { VITE_API_BASE_URL: "http://localhost:5191/audit-api" }, reuseExistingServer: false, timeout: 60000 },
});
