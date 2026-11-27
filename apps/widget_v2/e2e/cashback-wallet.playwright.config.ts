import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: ".", testMatch: "cashback-wallet.spec.ts", workers: 1, retries: 0, reporter: "list",
  outputDir: "../../../.specs/features/cashback/evidence/buyer-results",
  use: { baseURL: "http://127.0.0.1:5184", trace: "retain-on-failure" },
  projects: [{ name: "cashback-wallet", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "node node_modules/vite/bin/vite.js --config e2e/cashback-wallet.vite.config.ts", cwd: resolve(__dirname, ".."), url: "http://127.0.0.1:5184/e2e/fixtures/cashback-wallet.html", reuseExistingServer: false, timeout: 60000 },
});
