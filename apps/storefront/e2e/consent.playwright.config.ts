import { defineConfig } from "@playwright/test";
import path from "node:path";

const cwd = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: ".", testMatch: "storefront-consent.spec.ts", workers: 1, retries: 0,
  reporter: [["list"], ["json", { outputFile: path.resolve(cwd, "../../.audit/storefront-consent-20261005/browser-results.json") }]], timeout: 90_000,
  use: { baseURL: "http://localhost:3001", browserName: "chromium", screenshot: "only-on-failure" },
  webServer: [
    { command: "node e2e/fixtures/consent-api.mjs", cwd, url: "http://localhost:3009", reuseExistingServer: false },
    { command: "pnpm exec next dev --port 3001", cwd, url: "http://localhost:3001", reuseExistingServer: false, timeout: 120_000,
      env: { AACP_API_URL: "http://localhost:3009", NEXT_PUBLIC_API_BASE_URL: "/api/v1", AACP_VISUAL_REVIEW: "1", INTERNAL_SERVICE_TOKEN: "local-consent-fixture-only" } },
  ],
});
