/**
 * @realapi Payment failure — a PIX charge that is never paid (provider marks it
 * overdue/cancelled) must surface a retry message to the buyer and must NOT
 * confirm the order.
 *
 * Regression guard for the authoritative webhook-driven failure path:
 *   intent (requires_action) → Asaas PAYMENT_OVERDUE webhook → status "failed"
 *   → widget poll surfaces the retry copy, order confirmation never appears.
 */
import { expect, test } from "@playwright/test";
import {
  checkoutUrl,
  dismissChannelGate,
  E2E_VERIFIED_CUSTOMER,
  REALAPI_URL,
  seedCheckout,
  sendChat,
  waitForChatIdle,
} from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi payment failure", () => {
  test.describe.configure({ mode: "serial" });

  let merchantId: string;
  let embedToken: string;
  let productId: string;

  test.beforeEach(async ({ request }) => {
    const seed = await seedCheckout(request);
    if (!seed) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    ({ merchantId, embedToken, productId } = seed);
  });

  test("PIX overdue webhook fails the charge and never confirms the order", async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as { process?: { env: Record<string, string> } }).process = {
        env: { AACP_DISABLE_STREAMING: "1" },
      };
    });

    const customer = { ...E2E_VERIFIED_CUSTOMER, email: `pay_fail_${Date.now()}@test.aacp` };
    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    await page.waitForSelector(".zyon-thread", { timeout: 15_000 });
    await dismissChannelGate(page, "chat");
    await waitForChatIdle(page);

    // Reach payment: pick shipping, decline the coupon.
    await sendChat(page, "1000");
    await sendChat(page, "Nao tem");
    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await selector.locator("button").first().click();
    await waitForChatIdle(page);
    await expect(page.getByRole("button", { name: "Não" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Não" }).click();
    await waitForChatIdle(page);

    // Create the PIX intent — it starts in requires_action (never auto-approved).
    const paymentResponse = page.waitForResponse(
      (res) => res.url() === `${API}/embed/payment/intents` && res.request().method() === "POST",
    );
    await page.locator(".zyon-chip", { hasText: /^PIX$/i }).click();
    const paid = await paymentResponse;
    expect(paid.ok()).toBe(true, `Payment failed: ${await paid.text()}`);
    const paymentBody = await paid.json();
    expect(paymentBody.status).toBe("requires_action");

    // The provider never receives the money and reports the charge overdue.
    // The webhook flips the authoritative status to "failed".
    const overdue = await request.post(`${API}/webhooks/asaas`, {
      data: {
        id: `evt_overdue_${Date.now()}`,
        event: "PAYMENT_OVERDUE",
        payment: {
          id: `asaas_overdue_${Date.now()}`,
          value: (paymentBody.amountCents as number) / 100,
          externalReference: paymentBody.id,
        },
      },
    });
    expect(overdue.ok()).toBe(true, `Asaas overdue webhook failed: ${await overdue.text()}`);

    // The widget polls the authoritative status and surfaces the retry copy.
    await expect(page.locator(".zyon-thread")).toContainText(/expirou ou foi recusado|gere uma nova cobran/i, {
      timeout: 30_000,
    });

    // The order is never confirmed on a failed charge.
    await expect(page.locator(".zyon-order-confirmation")).toHaveCount(0);
  });
});
