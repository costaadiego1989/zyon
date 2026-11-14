import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const cwd = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: ".", testMatch: "one-buy-click-mobile.spec.ts", workers: 1, timeout: 60000,
  outputDir: "test-results/one-buy-click",
  use: { baseURL: "http://localhost:5199", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  webServer: [
    { cwd, command: "node e2e/fixtures/one-buy-click/api.mjs", url: "http://127.0.0.1:5202", reuseExistingServer: false },
    { cwd, command: "pnpm exec next dev -H localhost -p 5199", url: "http://localhost:5199", reuseExistingServer: false, timeout: 120000,
      env: { AACP_API_URL: "http://127.0.0.1:5202", NEXT_PUBLIC_API_BASE_URL: "/api/v1", INTERNAL_SERVICE_TOKEN: "local-fixture-only" } },
  ],
});
