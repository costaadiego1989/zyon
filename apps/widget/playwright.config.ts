import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
const WIDGET_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const wantsRealapi = process.argv.some((a) => a.includes("widget-realapi"));

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
      testMatch: /widget\.spec\.ts|checkout-shipping-flow\.spec\.ts|quick-replies\.spec\.ts|shipping-selection\.spec\.ts|checkout-flow-e2e\.spec\.ts/,
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
      command: "cmd /c npx vite --port 5173",
      port: 5173,
      reuseExistingServer: !CI
    },
    ...(wantsRealapi
      ? [
          {
            command: "cmd /c pnpm --filter @aacp/api start",
            port: 3000,
            reuseExistingServer: !CI,
            env: {
              PORT: "3000",
              E2E_SEED_ENABLED: "true",
              AACP_REPOSITORY: "memory",
              CHECKOUT_REPOSITORY: "in-memory",
              MERCHANT_REPOSITORY: "in-memory",
              BUYER_ACCOUNT_REPOSITORY: "in-memory",
              SUPPORT_SETTINGS_REPOSITORY: "in-memory",
              NODE_ENV: "test"
            }
          }
        ]
      : [])
  ]
});
