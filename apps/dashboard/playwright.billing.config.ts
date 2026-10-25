import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "billing-annual.spec.ts", workers: 1, retries: 0,
  reporter: [["list"]], outputDir: "test-results/billing-annual",
  use: { baseURL: "http://localhost:5187", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: { command: "node node_modules/vite/bin/vite.js --host localhost --port 5187 --strictPort", url: "http://localhost:5187", reuseExistingServer: false, timeout: 60000 },
});
