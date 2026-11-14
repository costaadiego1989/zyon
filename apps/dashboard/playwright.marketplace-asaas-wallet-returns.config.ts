import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "marketplace-asaas-wallet-returns.spec.ts", workers: 1, retries: 0,
  reporter: [["list"]], outputDir: "C:/tmp/zyon-marketplace-readiness-20260929/.audit/marketplace-readiness/phase40-asaas-wallet-return-browser-v1",
  timeout: 30000, use: { baseURL: "http://localhost:5196", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"], viewport: { width: 320, height: 720 } } },
  ],
  webServer: { command: "node node_modules/vite/bin/vite.js --host localhost --port 5196 --strictPort", url: "http://localhost:5196",
    env: { VITE_API_BASE_URL: "http://localhost:5196/audit-api" }, reuseExistingServer: false, timeout: 60000 },
});
