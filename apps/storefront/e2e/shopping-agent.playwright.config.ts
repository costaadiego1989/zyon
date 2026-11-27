import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "shopping-agent.spec.ts", fullyParallel: true, workers: 2,
  use: { baseURL: "http://127.0.0.1:5188", screenshot: "only-on-failure" },
  reporter: "list",
  webServer: { cwd: path.resolve(__dirname, ".."),
    command: "pnpm --dir ../widget_v2 exec vite --config ../storefront/e2e/fixtures/shopping-agent/vite.config.mjs",
    url: "http://127.0.0.1:5188", reuseExistingServer: true, timeout: 60000 },
});
