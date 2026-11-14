import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Wave 4 — Advanced Product Layout regression suite.
    // Runs the same chromium profile but is filterable via
    // `pnpm e2e -- --grep @apl` so the heavy suite never blocks PR runs.
    {
      name: 'apl',
      testMatch: [
        'advanced-product-layout.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Production smoke tests target an explicit remote URL and must not launch
  // an unrelated local Next server before exercising that deployment.
  webServer: process.env.ZYON_VOICE_PRODUCTION_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
