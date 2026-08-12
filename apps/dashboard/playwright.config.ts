import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI = !!process.env.CI;
const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175";
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
  ],

  /* ── Web Server ───────────────────────────────────────────────── */
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host localhost --port 5175 --strictPort",
    cwd: __dirname,
    url: "http://localhost:5175",
    reuseExistingServer: !CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
