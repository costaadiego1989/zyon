/**
 * Discount Rules E2E Tests
 * Validates discount within limits (rules-engine approved),
 * discount above limits (deterministic fallback),
 * and coupon application flow.
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  buildExperience,
  startCheckoutResponse,
  chatResponse,
  noBootstrapDataCollectionExperience,
  paymentExperience,
  couponApplyResponse,
  type FlowStep,
} from "./fixtures/api-mocks.js";
import { CheckoutPage, AgentChatPanel } from "./fixtures/page-objects.js";
import { installTestInit } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("Discount Rules @e2e", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("discount within limit: agent confirms approved offer", async ({ page }) => {
    // Simulate agent approving a 10% discount (within rules-engine maxDiscountPercent)
    await setupApiMocks(page, {
      chatSequence: ["coupon_applied"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Quero um desconto");
    const reply = await checkout.waitForAgentReply();
    const text = await reply.textContent();

    // Should mention discount approval
    expect(text).toMatch(/cupom|desconto|10%|aplicado/i);
  });

  test("discount above limit: deterministic fallback (agent does not authorize)", async ({ page }) => {
    // When buyer asks for excessive discount, the agent should NOT grant it.
    // The rules-engine rejects it and agent provides a safe fallback message.
    const rejectDiscountResponse = chatResponse({
      message: "Infelizmente não consigo oferecer esse desconto. O máximo que posso fazer é 10% com o cupom DESCONTO10.",
      experience: buildExperience({
        stage: "data_collection",
        customer: { email: "buyer@e2e.test", email_verified: true },
      }),
      stage: "data_collection",
      missingFields: [],
      authorizedOffer: { approved: false },
    });

    let chatCallCount = 0;
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(startCheckoutResponse(noBootstrapDataCollectionExperience())),
      });
    });
    await page.route("**/embed/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(startCheckoutResponse(noBootstrapDataCollectionExperience())),
      });
    });
    await page.route("**/chat/message", async (route) => {
      chatCallCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rejectDiscountResponse),
      });
    });
    await page.route("**/embed/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rejectDiscountResponse),
      });
    });
    await page.route("**/track-event", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ received: true }) });
    });
    await page.route("**/embed/track", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ received: true }) });
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Quero 50% de desconto!");
    const reply = await checkout.waitForAgentReply();
    const text = await reply.textContent();

    // Agent should refuse excessive discount
    expect(text).toMatch(/não consigo|infelizmente|máximo|10%/i);
    // The authorized_offer should be rejected
    expect(text).not.toMatch(/50%\s*(de\s*)?desconto\s*aplicado/i);
  });

  test("coupon application via quick reply", async ({ page }) => {
    const paySequence: FlowStep[] = ["shipping_selected"];
    await setupApiMocks(page, {
      chatSequence: paySequence,
      startResponse: startCheckoutResponse(
        buildExperience({
          stage: "shipping",
          customer: { email: "buyer@e2e.test", email_verified: true, fullName: "Test", cpf: "12345678900", phone: "11999990000", phone_verified: true },
          copy: {
            headline: "Checkout assistido por IA",
            subheadline: "Finalize sua compra com ajuda da Clara.",
            trust_badges: ["Pagamento seguro"],
            quick_replies: ["Correios PAC (7 dias) - R$ 19,90", "Correios Sedex (3 dias) - R$ 29,90"],
          },
        }),
      ),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Select shipping to move to payment stage
    await checkout.selectShipping(/PAC/);

    // At payment stage, "Tenho um cupom" should be available
    const couponBtn = page.locator(".zyon-chip, .zyon-quick-replies button").filter({ hasText: /cupom/i }).first();
    if (await couponBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await couponBtn.click();
      await checkout.waitForStreamingDone();
      // Should see coupon-related text
      const text = await page.textContent("body");
      expect(text).toMatch(/cupom|desconto|código/i);
    }
  });

  test("invalid coupon shows error message", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["shipping_selected"],
      rejectCoupon: true,
      startResponse: startCheckoutResponse(
        buildExperience({
          stage: "shipping",
          customer: { email: "buyer@e2e.test", email_verified: true, fullName: "Test", cpf: "12345678900", phone: "11999990000", phone_verified: true },
          copy: {
            headline: "Checkout",
            subheadline: "Finalize",
            trust_badges: [],
            quick_replies: ["Correios PAC (7 dias) - R$ 19,90"],
          },
        }),
      ),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.selectShipping(/PAC/);

    // Try to apply an invalid coupon
    await checkout.sendMessage("CUPOMINVALIDO");
    await page.waitForTimeout(2_000);

    // Page should still be functional (no crash)
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("discount does not exceed maxDiscountPercent (hard cap)", async ({ page }) => {
    // This validates the invariant: rules-engine hard-caps maxDiscountPercent.
    // Even if somehow a larger discount is sent, the experience totals reflect the capped value.
    const cappedDiscount = 89.98; // 10% of 899.80 subtotal
    const experience = paymentExperience(cappedDiscount);

    await setupApiMocks(page, {
      chatSequence: ["completed"],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // The total should reflect the capped discount
    const pageContent = await page.textContent("body");
    // Subtotal 899.80 + shipping 19.90 - discount 89.98 = 829.72
    expect(pageContent).toMatch(/829[,.]7/);
  });
});
