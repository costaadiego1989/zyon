import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx", "src/**/*.test.ts", "src/**/*.test.tsx", "../widget_v2/tests/service-booking-picker.spec.tsx", "../widget_v2/tests/service-booking-auth-expiry.spec.tsx"]
  }
});
