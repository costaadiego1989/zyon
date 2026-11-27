import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({ testDir: ".", testMatch: "recovery-history.spec.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:5189", browserName: "chromium" },
  webServer: { command: "pnpm exec vite --config e2e/recovery-history.vite.config.ts --host 127.0.0.1 --port 5189", cwd: fileURLToPath(new URL("..", import.meta.url)), url: "http://127.0.0.1:5189", reuseExistingServer: true },
});

