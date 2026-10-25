import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "storefront-read-actions.spec.ts", fullyParallel: false,
  workers: 1, retries: 0, timeout: 45_000, reporter: "list",
  outputDir: "./test-results/read-actions",
  use: { baseURL: "http://127.0.0.1:33117", ...devices["Desktop Chrome"], serviceWorkers: "block" },
  webServer: {
    command: "node tests/read-actions-browser-server.mjs", url: "http://127.0.0.1:33117/store/read-actions",
    stdout: "pipe",
    env: { NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1" },
    reuseExistingServer: false, timeout: 120_000,
  },
});
