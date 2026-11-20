import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: ["fiscal-current-orders.spec.ts", "buyer-orders.spec.ts"], workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:5199", screenshot: "only-on-failure" }, reporter: "list",
  webServer: {
    cwd: path.resolve(__dirname, ".."),
    command: "node ../widget_v2/node_modules/vite/bin/vite.js --config e2e/fixtures/tracking/vite.config.mjs",
    url: "http://127.0.0.1:5199", reuseExistingServer: false, timeout: 60000,
  },
});
