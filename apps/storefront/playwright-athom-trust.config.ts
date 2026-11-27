import { defineConfig } from "@playwright/test";
import base from "./playwright-read-actions.config.js";

export default defineConfig({ ...base, testMatch: "athom-trust-badges.spec.ts", timeout: 60_000,
  outputDir: "../../.audit/athom-remediation-20261116/storefront-trust-results",
  use: { ...base.use, channel: "msedge" } });
