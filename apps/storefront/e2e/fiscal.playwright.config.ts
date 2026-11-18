import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "fiscal-invoicing.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalSetup: "./fiscal.global-setup.ts",
  globalTeardown: "./fiscal.global-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },
  webServer: [
    {
      command:
        "node --loader ./apps/api/tests/platform-support-loader.mjs ./apps/api/tests/fiscal-buyer-browser-server.ts",
      cwd: path.resolve(__dirname, "../../.."),
      url: "http://127.0.0.1:3024/v1/__health",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        REDIS_URL: "",
        REDIS_ENABLED: "false",
        BILLING_TRIAL_QUEUE_REQUIRED: "false",
      },
    },
    {
      command: "pnpm dev",
      cwd: path.resolve(__dirname, ".."),
      url: "http://localhost:3001",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        AACP_API_URL: "http://127.0.0.1:3024",
        NEXT_PUBLIC_API_BASE_URL: "/api/v1",
        INTERNAL_SERVICE_TOKEN: "fiscal-browser-synthetic-service",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
        AACP_VISUAL_REVIEW: "1",
      },
    },
  ],
});
