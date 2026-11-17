import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "recovery-resume-origin.spec.ts", workers: 1, retries: 0,
  timeout: 30000, reporter: "list", outputDir: "./test-results/recovery-origin",
  use: { baseURL: "http://127.0.0.1:18178", ...devices["Desktop Edge"], channel: "msedge", serviceWorkers: "block" },
  webServer: { command: "node ../dashboard/node_modules/vite/bin/vite.js --config tests/recovery-origin/vite.config.mjs --host 127.0.0.1 --port 18178 --strictPort", url: "http://127.0.0.1:18178", reuseExistingServer: false, timeout: 60000 },
});
