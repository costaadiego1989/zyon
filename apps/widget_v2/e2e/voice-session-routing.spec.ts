import { test, expect } from "@playwright/test";

test("voice uses the same signed embed proxy as chat, with direct API fallback for standalone", async ({ page }) => {
  const paths: string[] = [];
  await page.route("**/embed/**", route => {
    paths.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: route.request().url().endsWith('/start')
      ? { session_id: 'chk_proxy', experience: {} }
      : route.request().url().endsWith('/session') ? { value: 'test_ephemeral' } : { message: 'OK' } });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    // Exercise the actual transport with the same split bases as CheckoutPanel.
    const { CheckoutSession } = await import('/src/api/checkout-session.ts');
    for (const embedApiBaseUrl of ['/api', undefined]) {
      const session = new CheckoutSession({ embedToken: 'test', merchantId: 'test', apiBaseUrl: '/direct', embedApiBaseUrl });
      await session.start();
      await session.chat('Quero finalizar');
      await session.createRealtimeVoiceSession();
    }
  });
  expect(paths).toEqual([
    '/api/embed/start', '/api/embed/chat', '/api/embed/realtime/session',
    '/direct/embed/start', '/direct/embed/chat', '/direct/embed/realtime/session',
  ]);
});
