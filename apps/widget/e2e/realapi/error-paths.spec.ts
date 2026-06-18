/**
 * @realapi Error paths — OTP inválido, cupom inválido, payment failure surfaces.
 */
import { expect, test } from "@playwright/test";
import {
  checkoutUrl,
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

    const startResponse = page.waitForResponse(
      (res) => res.url() === `${REALAPI_URL}/embed/start` && res.request().method() === "POST",
    );
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    const started = await startResponse;
    const startedBody = await started.json();
    const sessionId = startedBody.session_id as string;

    await sendChat(page, "Diego Costa");
    const buyerEmail = `otp_err_${Date.now()}@test.aacp`;
    await sendChat(page, buyerEmail);

    const sessionLookup = await request.get(`${REALAPI_URL}/checkout/${merchantId}/${sessionId}`);
    expect(sessionLookup.ok()).toBe(true);
    const session = await sessionLookup.json();
    const otpCode = session.customer?.otp_code as string | undefined;
    expect(otpCode).toMatch(/^\d{6}$/);

    await sendChat(page, "000000");
    await expect(page.locator(".aacp-shipping-selector")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Falha ao falar com a IA/i)).toHaveCount(0);

    await sendChat(page, otpCode!);
    await expect(page.locator(".aacp-thread")).toContainText(/CPF|telefone|celular/i, {
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
    await page.waitForSelector(".aacp-thread", { timeout: 15_000 });
    await waitForChatIdle(page);

    await sendChat(page, "1000");
    await sendChat(page, "Nao tem");

    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await selector.locator("button").first().click();
    await waitForChatIdle(page);

    await expect(page.getByRole("button", { name: "Nao tenho cupom" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Tenho um cupom" }).click();

    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 5_000 });
    await couponBox.locator("input").fill("CODIGO_INEXISTENTE_999");
    await couponBox.locator("button", { hasText: /aplicar/i }).click();
    await page.waitForTimeout(2_000);

    await expect(page.locator(".aacp-order-confirmation")).not.toBeVisible();
    await expect(page.locator(".aacp-thread")).toBeVisible();
  });
});
