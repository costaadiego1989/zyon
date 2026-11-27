import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "cashback.spec.ts",
  workers: 1,
  reporter: [["list"]],
  outputDir: "../../.specs/features/cashback/evidence/dashboard-playwright",
  use: { baseURL: "http://127.0.0.1:5187", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 5187 --strictPort", url: "http://127.0.0.1:5187", reuseExistingServer: false, timeout: 60000 },
});
