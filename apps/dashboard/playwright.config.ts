import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI = !!process.env.CI;
const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175";
const RUN_LIVE_ERP_TESTS = process.env.RUN_LIVE_ERP_TESTS === "1";
const LIVE_ERP_STORAGE_STATE = process.env.ERP_LIVE_STORAGE_STATE;
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : 1,
  reporter: CI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "test-results/html" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ]
    : [
        ["list"],
        ["html", { open: "on-failure" }],
      ],

  /* ── Global settings ──────────────────────────────────────────── */
  use: {
    baseURL: DASHBOARD_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  /* ── Projects ─────────────────────────────────────────────────── */
  projects: [
    /* --- Setup: authenticate once and save state --- */
    {
      name: "auth-setup",
      testMatch: /auth-setup\.ts/,
    },

    /* --- Chrome (primary) --- */
    {
      name: "dashboard-chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/storage-state.json",
      },
      dependencies: ["auth-setup"],
      testIgnore: /erp-live-production\.spec\.ts/,
    },

    /* --- Firefox (CI only) --- */
    ...(CI
      ? [
          {
            name: "dashboard-firefox",
              use: {
                ...devices["Desktop Firefox"],
                storageState: "e2e/.auth/storage-state.json",
              },
              dependencies: ["auth-setup"],
              testIgnore: /erp-live-production\.spec\.ts/,
          },
        ]
      : []),

    /* --- Mobile Chrome --- */
    {
      name: "dashboard-mobile",
      use: {
        ...devices["Pixel 5"],
        storageState: "e2e/.auth/storage-state.json",
      },
      dependencies: ["auth-setup"],
      testMatch: /.*\.mobile\.spec\.ts/,
    },

    /* --- Unauthenticated tests (auth flow itself) --- */
    {
      name: "dashboard-auth",
      use: {
        ...devices["Desktop Chrome"],
        storageState: undefined as any,
      },
      testMatch: /auth-.*\.spec\.ts/,
    },
    {
      name: "dashboard-erp-live",
      testMatch: /erp-live-production\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: LIVE_ERP_STORAGE_STATE,
      },
    },
  ],

  /* ── Web Server ───────────────────────────────────────────────── */
  webServer: RUN_LIVE_ERP_TESTS ? undefined : {
    command: "node node_modules/vite/bin/vite.js --host localhost --port 5175 --strictPort",
    cwd: __dirname,
    url: "http://localhost:5175",
    reuseExistingServer: !CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
