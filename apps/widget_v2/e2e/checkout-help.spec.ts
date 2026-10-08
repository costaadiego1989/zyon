import { test, expect } from "@playwright/test";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks.js";

for (const embedded of [false, true]) {
  test(`${embedded ? "embedded" : "standalone"}: default inactivity is three minutes`, async ({ page }) => {
    await page.clock.install();
    await setupCrossSellMocks(page);
    await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: {
      mode: "silent_until_trigger", enabledTriggers: ["idle_30_seconds"],
      cooldownSeconds: 120, maxInterventionsPerSession: 3,
      triggerMessages: { idle_30_seconds: { message: "Posso ajudar a concluir sua compra?" } },
    } }));
    if (embedded) {
      await page.goto("/?embed=1&embedToken=tok&merchantId=mrc&apiBaseUrl=http://127.0.0.1:5174");
    } else await navigateToCheckout(page);
    await selectChatChannel(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 30000));
    await page.locator("body").press("Shift");
    await page.clock.runFor(179000);
    await expect(page.locator(".discount-banner")).toHaveCount(0);
    await page.clock.runFor(1000);
    await expect(page.locator(".discount-banner")).toContainText("Posso ajudar a concluir sua compra?");
  });

  test(`${embedded ? "embedded" : "standalone"}: configured inactivity resets after interaction`, async ({ page }) => {
    await page.clock.install();
    await setupCrossSellMocks(page);
    await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: {
      mode: "silent_until_trigger", enabledTriggers: ["idle_30_seconds"], idleSeconds: 600,
      cooldownSeconds: 120, maxInterventionsPerSession: 3,
      triggerMessages: { idle_30_seconds: { message: "Posso ajudar a concluir sua compra?" } },
    } }));
    if (embedded) {
      await page.goto("/?embed=1&embedToken=tok&merchantId=mrc&apiBaseUrl=http://127.0.0.1:5174");
    } else await navigateToCheckout(page);
    await selectChatChannel(page);
    await expect.poll(() => page.evaluate(async () => {
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
      return useCheckoutStore.getState().triggerConfig?.idleSeconds;
    })).toBe(600);
    // Freeze wall time so slow assertions cannot consume the final second of the deadline.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 30000));
    await page.locator("body").press("Shift");
    await page.clock.runFor(599000);
    await expect(page.locator(".discount-banner")).toHaveCount(0);
    await page.locator("body").press("Shift");
    await page.clock.runFor(599000);
    await expect(page.locator(".discount-banner")).toHaveCount(0);
    await page.clock.runFor(1000);
    await expect(page.locator(".discount-banner")).toContainText("Posso ajudar a concluir sua compra?");
  });

  test(`${embedded ? "embedded" : "standalone"}: refused payment keeps checkout accessible and presents help`, async ({ page }) => {
    const events: string[] = [];
    await setupCrossSellMocks(page);
    await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: {
      mode: "silent_until_trigger", enabledTriggers: ["payment_failed"], cooldownSeconds: 120,
      maxInterventionsPerSession: 3, idleSeconds: 180,
      triggerMessages: { payment_failed: { message: "Vamos escolher outra forma de pagamento?" } },
    } }));
    await page.route("**/embed/track", route => {
      events.push(route.request().postDataJSON().event);
      return route.fulfill({ json: { trigger_agent: true } });
    });
    await page.route("**/embed/payment/intents/intent/status**", route => route.fulfill({ json: { status: "failed" } }));
    if (embedded) {
      await page.goto("/?embed=1&embedToken=tok&merchantId=mrc&apiBaseUrl=http://127.0.0.1:5174");
    } else await navigateToCheckout(page);
    await selectChatChannel(page);
    await page.evaluate(async () => {
      // Inject an existing pending payment, then exercise the production HTTP poller.
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
      useCheckoutStore.setState({ paymentIntent: { intent_id: "intent", method: "card", status: "pending" },
        merchantPaymentConfig: { paymentMethods: { pix: true, card: false } } });
      useCheckoutStore.getState().pollPayment();
    });
    await expect(page.getByText("Vamos escolher outra forma de pagamento?", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Checkout indisponível", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
    expect(events.filter(event => event === "payment_failed")).toHaveLength(1);
    const snapshot = await page.evaluate(async () => {
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
      const { status, paymentPolling, paymentIntent } = useCheckoutStore.getState();
      return { status, paymentPolling, paymentStatus: paymentIntent.status };
    });
    expect(snapshot).toEqual({ status: "active", paymentPolling: false, paymentStatus: "failed" });
  });
}
