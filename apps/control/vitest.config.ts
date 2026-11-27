import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { requireSelectedTests } from "./tests/require-selected-tests.js";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // The HTTP client has its own Node proof runner; React components use Vitest.
    include: ["src/ui/**/*.spec.ts", "src/ui/**/*.spec.tsx", "tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    setupFiles: ["./tests/setup.ts"],
    passWithNoTests: false,
    reporters: ["default", requireSelectedTests],
    restoreMocks: true,
    clearMocks: true,
    maxWorkers: 2,
  },
});
