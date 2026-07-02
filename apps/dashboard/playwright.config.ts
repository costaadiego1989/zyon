import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI = !!process.env.CI;
const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5174";
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
    baseURL: DASHBOARD_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "dashboard-chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort",
    cwd: __dirname,
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000
  }
});
