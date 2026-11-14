import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "cross-sell-one-click.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  timeout: 30_000, reporter: "list", outputDir: "../test-results/cross-sell-one-click",
  use: { baseURL: "http://127.0.0.1:5197", screenshot: "only-on-failure", serviceWorkers: "block" },
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/cross-sell-one-click/vite.config.mjs",
    url: "http://127.0.0.1:5197", reuseExistingServer: false, timeout: 60_000,
  },
});
