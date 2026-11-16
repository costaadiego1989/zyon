import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "./e2e", testMatch: "athom-trust-badges.spec.ts", workers: 1,
  retries: 0, timeout: 60_000, reporter: "list",
  outputDir: "../../.audit/athom-remediation-20261116/checkout-trust-results",
  use: { browserName: "chromium", channel: "msedge", baseURL: "http://127.0.0.1:18176" },
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 18176 --strictPort",
    url: "http://127.0.0.1:18176", reuseExistingServer: false, timeout: 60_000 } });
