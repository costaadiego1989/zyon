import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "commerce-rules.spec.ts", fullyParallel: true, workers: 2,
  use: { baseURL: "http://127.0.0.1:5186", screenshot: "only-on-failure" },
  reporter: "list",
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/commerce-rules/vite.config.mjs",
    url: "http://127.0.0.1:5186", reuseExistingServer: true, timeout: 60000,
  },
});
