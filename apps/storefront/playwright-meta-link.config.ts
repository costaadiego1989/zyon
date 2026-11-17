import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "meta-account-link.spec.ts", workers: 1, retries: 0,
  timeout: 30000, reporter: "list", outputDir: "./test-results/meta-link",
  use: { baseURL: "http://127.0.0.1:18177", ...devices["Desktop Edge"], channel: "msedge", serviceWorkers: "block" },
  webServer: { command: "node ../dashboard/node_modules/vite/bin/vite.js --config tests/meta-link/vite.config.mjs --host 127.0.0.1 --port 18177 --strictPort", url: "http://127.0.0.1:18177", reuseExistingServer: false, timeout: 60000 },
});
