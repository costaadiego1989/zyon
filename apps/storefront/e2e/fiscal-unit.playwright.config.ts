import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: ["fiscal-client.spec.ts", "fiscal-proxy.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: "list",
});
