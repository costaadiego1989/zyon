/**
 * @realapi Error paths — OTP inválido, cupom inválido, payment failure surfaces.
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

test.describe("@realapi error paths", () => {
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

  test("OTP inválido não derruba API e permite nova tentativa", async ({ page, request }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as { process?: { env: Record<string, string> } }).process = {
        env: { AACP_DISABLE_STREAMING: "1" },
      };
    });

    // Provide a fresh, unverified email (no name) so the checkout bootstrap
    // auto-submits it and deterministically advances to the e-mail OTP step.
    // Passing customerJson overrides the demo page's prefilled customer,
    // keeping the buyer email under test control.
    const buyerEmail = `otp_err_${Date.now()}@test.aacp`;
    const startResponse = page.waitForResponse(
      (res) => res.url() === `${REALAPI_URL}/embed/start` && res.request().method() === "POST",
    );
    await page.goto(
      checkoutUrl(merchantId, embedToken, productId, {
        customer: { email: buyerEmail, isReturning: false },
      }),
    );
    await page.waitForSelector(".zyon-thread", { timeout: 15_000 });
    await dismissChannelGate(page, "chat");
    const started = await startResponse;
    const startedBody = await started.json();
    const sessionId = startedBody.session_id as string;

    // Wait for the agent to ask for the e-mail verification code.
    await expect(page.locator(".zyon-thread")).toContainText(/c[oó]digo|verifica/i, {
      timeout: 15_000,
    });

    const sessionLookup = await request.get(`${REALAPI_URL}/checkout/${merchantId}/${sessionId}`);
    expect(sessionLookup.ok()).toBe(true);
    const session = await sessionLookup.json();
    const otpCode = session.customer?.otp_code as string | undefined;
    expect(otpCode).toMatch(/^\d{6}$/);

    await sendChat(page, "000000");
    await expect(page.locator(".zyon-shipping-selector")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Falha ao falar com a IA/i)).toHaveCount(0);

    await sendChat(page, otpCode!);
    // Valid code accepted → checkout advances past e-mail verification
    // (next the agent collects the buyer's name for the invoice).
    await expect(page.locator(".zyon-thread")).toContainText(/nome|CPF|telefone|celular/i, {
      timeout: 15_000,
    });
  });

  test("cupom inválido na etapa de pagamento não confirma pedido", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as { process?: { env: Record<string, string> } }).process = {
        env: { AACP_DISABLE_STREAMING: "1" },
      };
    });

    const customer = { ...E2E_VERIFIED_CUSTOMER, email: `coupon_err_${Date.now()}@test.aacp` };
    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    await page.waitForSelector(".zyon-thread", { timeout: 15_000 });
    await dismissChannelGate(page, "chat");
    await waitForChatIdle(page);

    await sendChat(page, "1000");
    await sendChat(page, "Nao tem");

    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await selector.locator("button").first().click();
    await waitForChatIdle(page);

    // Coupon gate offers Sim/Não quick replies. "Sim" opens the coupon box.
    await expect(page.getByRole("button", { name: "Não" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Sim" }).click();

    const couponBox = page.locator(".zyon-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 5_000 });
    await couponBox.locator("input").fill("CODIGO_INEXISTENTE_999");
    await couponBox.locator("button", { hasText: /aplicar/i }).click();
    await page.waitForTimeout(2_000);

    await expect(page.locator(".zyon-order-confirmation")).not.toBeVisible();
    await expect(page.locator(".zyon-thread")).toBeVisible();
  });
});
