import { defineConfig } from '@playwright/test';

// These contracts replace fetch explicitly and never request a browser fixture.
// Do not start Next, call a provider or treat them as sandbox E2E proof.
export default defineConfig({
  testDir: '.',
  testMatch: 'conversation-access.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../test-results/conversation-access-contracts',
});
