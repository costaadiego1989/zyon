import path from "node:path";
import { defineConfig } from "@playwright/test";
const cwd = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: ".", testMatch: "theme-budget-next.spec.ts", workers: 1, timeout: 60000,
  outputDir: "test-results/theme-budget-next",
  use: { baseURL: "http://localhost:5198", screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: "list",
  webServer: [
    { cwd, command: "node e2e/fixtures/theme-budget/api.mjs", url: "http://127.0.0.1:5201", reuseExistingServer: false },
    { cwd, command: "pnpm exec next start -H localhost -p 5198", url: "http://localhost:5198", reuseExistingServer: false, timeout: 60000,
      env: { AACP_API_URL: "http://127.0.0.1:5201", INTERNAL_SERVICE_TOKEN: "local-fixture-only" } },
  ],
});
