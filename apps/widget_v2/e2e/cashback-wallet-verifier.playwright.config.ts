import { defineConfig } from "@playwright/test";
import base from "./cashback-wallet.playwright.config";

const webServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
export default defineConfig({
  ...base,
  testMatch: "cashback-wallet-verifier.spec.ts",
  outputDir: "../../../.specs/features/cashback/evidence/verifier-buyer-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:5188" },
  webServer: { ...webServer!, command: "node node_modules/vite/bin/vite.js --config e2e/cashback-wallet.vite.config.ts --port 5188",
    url: "http://127.0.0.1:5188/e2e/fixtures/cashback-wallet.html" },
});
