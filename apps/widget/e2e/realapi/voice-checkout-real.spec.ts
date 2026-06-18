/**
 * @realapi Voice checkout — smoke + happy path curto com API NestJS real.
 */
import { expect, test } from "@playwright/test";
import {
  checkoutUrl,
  E2E_VERIFIED_CUSTOMER,
  REALAPI_URL,
  seedCheckout,
  waitForChatIdle,
} from "../fixtures/realapi-helpers.js";
import {
  answerAndWaitForPrompt,
  answerByVoice,
  installVoiceBrowserMocks,
  selectVoiceShipping,
  skipCouponByVoice,
  waitForVoicePrompt,
} from "../fixtures/voice-helpers.js";

test.describe("@realapi voice checkout", () => {
  test.describe.configure({ mode: "serial" });

  let merchantId: string;
  let embedToken: string;
  let productId: string;

  test.beforeEach(async ({ page, request }) => {
    await installVoiceBrowserMocks(page);
    await page.addInitScript(() => {
      window.localStorage.clear();
      (globalThis as { process?: { env: Record<string, string> } }).process = {
        env: { AACP_DISABLE_STREAMING: "1" },
      };
    });

    const seed = await seedCheckout(request);
    if (!seed) {
      test.skip(true, "Seed endpoint not available (E2E_SEED_ENABLED not set)");
      return;
    }
    ({ merchantId, embedToken, productId } = seed);
  });

  test("smoke: channel gate voz abre experiência com API real", async ({ page }) => {
    await page.goto(checkoutUrl(merchantId, embedToken, productId));
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Comprar por voz/i }).click();
    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aacp-voice-mic")).toBeVisible();
  });

  test("happy path: cliente verificado → frete por voz → PIX → Pedido confirmado", async ({ page }) => {
    test.setTimeout(180_000);

    const customer = { ...E2E_VERIFIED_CUSTOMER, email: `voice_${Date.now()}@test.aacp` };
    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Comprar por voz/i }).click();
    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });

    await waitForVoicePrompt(page, /numero|complemento|frete|endereco/i);
    await answerAndWaitForPrompt(page, "1000 apartamento 12", /frete|pac|sedex|cupom|pagamento/i);

    const selector = page.locator(".aacp-shipping-selector");
    if (await selector.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await selectVoiceShipping(page, "PAC");
    } else {
      await answerAndWaitForPrompt(page, "PAC", /cupom|pagamento|pagar/i);
    }

    await skipCouponByVoice(page);

    const paymentResponse = page.waitForResponse(
      (res) => res.url() === `${REALAPI_URL}/embed/payment/intents` && res.request().method() === "POST",
    );
    await answerByVoice(page, "pix");
    const paid = await paymentResponse;
    expect(paid.ok()).toBe(true, `Payment failed: ${await paid.text()}`);
    const paymentBody = await paid.json();
    expect(paymentBody.status).toBe("approved");

    await expect(page.locator("[data-channel='voice'][data-stage='completed']")).toBeVisible({
      timeout: 15_000,
    });
    await waitForVoicePrompt(page, /confirmado|aprovado/i);
    await waitForChatIdle(page);
  });
});
