import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "cashback.spec.ts",
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "../../../.specs/features/cashback/evidence/widget-results",
});
