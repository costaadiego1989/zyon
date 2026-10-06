import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "voice-composer.spec.ts", workers: 1, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5203", screenshot: "only-on-failure" },
  webServer: { cwd: path.resolve(__dirname, ".."), command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/voice-composer/vite.config.mjs",
    url: "http://127.0.0.1:5203", reuseExistingServer: false, timeout: 60000 },
});
