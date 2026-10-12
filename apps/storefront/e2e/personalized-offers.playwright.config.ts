import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "personalized-offers.spec.ts", workers: 2,
  use: { baseURL: "http://127.0.0.1:5197", screenshot: "only-on-failure" },
  reporter: "list",
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/personalized-offers/vite.config.mjs",
    url: "http://127.0.0.1:5197", reuseExistingServer: false, timeout: 60000,
  },
});
