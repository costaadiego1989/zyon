import { defineConfig, devices } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CI = !!process.env.CI;
const WIDGET_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const wantsRealapi = process.argv.some((a) => a.includes("widget-realapi"));
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["junit", { outputFile: "test-results/junit.xml" }]
  ],
  use: {
    baseURL: WIDGET_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "widget-mocked",
      testMatch: /widget\.spec\.ts|checkout-shipping-flow\.spec\.ts|quick-replies\.spec\.ts|shipping-selection\.spec\.ts|checkout-flow-e2e\.spec\.ts|checkout-integration\.spec\.ts|voice-checkout\.spec\.ts|phone-login\.spec\.ts|voice-phone-login\.spec\.ts|phone-otp-userpanel\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "widget-realapi",
      testMatch: /realapi[\\/].*\.spec\.ts|regressions[\\/].*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: WIDGET_URL }
    }
  ],
  webServer: [
    {
      command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173",
      cwd: __dirname,
      port: 5173,
      reuseExistingServer: !CI
    },
    ...(wantsRealapi
      ? [
          {
            command: "node dist/main.js",
            cwd: resolve(__dirname, "../api"),
            port: 3000,
            reuseExistingServer: !CI,
            env: {
              PORT: "3000",
              E2E_SEED_ENABLED: "true",
              DATABASE_URL:
                process.env.DATABASE_URL ??
                "postgresql://postgres:postgres@localhost:55432/aacp_test?schema=public",
              WEBHOOK_DISPATCH_INTERVAL_MS: "250",
              NODE_ENV: "test"
            }
          }
        ]
      : [])
  ]
});
