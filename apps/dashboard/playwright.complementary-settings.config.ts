import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "complementary-settings.spec.ts",
  workers: 1,
  reporter: [["list"]],
  outputDir: "../../.audit/complementary-settings-20261007/playwright",
  use: { baseURL: "http://localhost:5175", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: "pnpm dev", url: "http://localhost:5175", reuseExistingServer: true, timeout: 60000 },
});
