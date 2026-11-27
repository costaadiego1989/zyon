import {defineConfig} from "@playwright/test";
export default defineConfig({testDir: "./e2e", testMatch: "meta-ads-agent.spec.ts", fullyParallel: false, workers: 1, retries: 0, timeout: 120000, expect: {timeout: 20000}, reporter: [["list"]], outputDir: "../../.specs/features/meta-growth-agent/browser-results", use: {baseURL: "http://127.0.0.1:5178", channel: "msedge", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure"}, webServer: [
  {command: "node --loader ./tests/ready-prod-loader.mjs ./tests/meta-ads-browser-runtime.ts", cwd: "../api", url: "http://127.0.0.1:3018/__test/health", reuseExistingServer: false, timeout: 60000},
  {command: "pnpm exec vite --config e2e/meta-ads-agent/vite.config.ts", url: "http://127.0.0.1:5178", reuseExistingServer: false, timeout: 60000},
]});
