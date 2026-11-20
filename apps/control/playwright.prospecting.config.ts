import { defineConfig } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = process.env.PROSPECTING_CONTROL_TEST_URL ?? "http://127.0.0.1:5179";
const url = new URL(baseURL);
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("prospecting_browser_requires_loopback");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /prospecting.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 10_000 },
  projects: [1440, 390, 320].map(width => ({ name: `control-${width}`, use: { browserName: "chromium" as const, viewport: { width, height: 900 } } })),
  // T52 adds the real local Nest/browser runtime. This scaffolding starts only
  // this checkout's Control and refuses to reuse an unrelated process.
  webServer: { command: `pnpm exec vite --host 127.0.0.1 --port ${url.port || "5179"} --strictPort`, cwd: dirname(fileURLToPath(import.meta.url)), url: baseURL, reuseExistingServer: false, timeout: 60_000 },
});
