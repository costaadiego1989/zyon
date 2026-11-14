import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "storefront-links.spec.ts", fullyParallel: false, workers: 1,
  timeout: 60000, expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: "http://localhost:4318", screenshot: "only-on-failure", trace: "retain-on-failure", permissions: ["clipboard-read", "clipboard-write"] },
  projects: [
    { name: "desktop-links", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-links", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node e2e/fixtures/links-api.mjs", url: "http://127.0.0.1:4319/health", reuseExistingServer: false },
    { command: "pnpm exec next dev -p 4318", url: "http://localhost:4318", timeout: 120000, reuseExistingServer: false,
      env: { AACP_API_URL: "http://127.0.0.1:4319", NEXT_PUBLIC_API_BASE_URL: "/api/v1", NEXT_PUBLIC_SITE_URL: "http://localhost:4318", AACP_VISUAL_REVIEW: "1", INTERNAL_SERVICE_TOKEN: "local-links-service-token" } },
  ],
});
