import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: "athom-content-editor.spec.ts", workers: 1,
  use: { browserName: "chromium", channel: "msedge", headless: true, baseURL: "http://127.0.0.1:18175" },
  outputDir: "../../.audit/athom-remediation-20261116/playwright-results",
  webServer: { command: "pnpm exec vite --config e2e/athom-content-editor.vite.config.ts",
    url: "http://127.0.0.1:18175/athom-content-editor.html", reuseExistingServer: false, timeout: 60000 } });
