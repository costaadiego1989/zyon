import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".", testMatch: "cart-line-selection.spec.ts", fullyParallel: false, workers: 1, retries: 0,
  timeout: 30_000, reporter: "list", outputDir: "../test-results/cart-line-selection",
  use: { baseURL: "http://127.0.0.1:5198", screenshot: "only-on-failure", serviceWorkers: "block" },
  webServer: { cwd: path.resolve(__dirname, ".."),
    command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/cart-line-selection/vite.config.mjs",
    url: "http://127.0.0.1:5198", reuseExistingServer: false, timeout: 60_000 },
});
