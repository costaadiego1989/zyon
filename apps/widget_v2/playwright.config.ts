import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI = !!process.env.CI;
const WIDGET_URL = "http://127.0.0.1:5174";
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  // 1 local retry absorbs the vite cold-boot dep-optimization race on the very
  // first worker; steady-state runs need none.
  retries: CI ? 2 : 1,
  // Cap workers so the cold vite server isn't hammered by 8 parallel navigations
  // before its dependency pre-bundle settles.
  workers: CI ? 1 : 4,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: WIDGET_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "widget-v2-mocked",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort",
    cwd: __dirname,
    url: WIDGET_URL,
    reuseExistingServer: !CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
});
