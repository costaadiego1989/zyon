import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "buyer-support-inbox.spec.ts", workers: 2,
  use: { baseURL: "http://127.0.0.1:5208", screenshot: "only-on-failure", channel: "msedge" }, reporter: "list",
  webServer: { cwd: path.resolve(__dirname, ".."), command: "pnpm --dir ../dashboard exec vite --config ../storefront/e2e/fixtures/support-inbox/vite.config.mjs",
    url: "http://127.0.0.1:5208", reuseExistingServer: false, timeout: 60000 },
});
