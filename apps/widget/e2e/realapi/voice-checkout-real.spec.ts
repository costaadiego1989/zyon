/**
 * @realapi Voice checkout — smoke + happy path curto com API NestJS real.
 */
import { expect, test } from "@playwright/test";
import {
  checkoutUrl,
  dismissChannelGate,
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
    // Wait for channel gate to render (it appears once the widget initializes)
    const gate = page.locator(".zyon-channel-gate");
    await expect(gate).toBeVisible({ timeout: 20_000 });
    const voiceButton = page.getByRole("button", { name: /Comprar por voz/i });
    await expect(voiceButton).toBeEnabled({ timeout: 15_000 });
    await voiceButton.click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".zyon-voice-mic")).toBeVisible();
  });

  test("happy path: cliente verificado → frete por voz → PIX → Pedido confirmado", async ({ page, request }) => {
    test.setTimeout(180_000);

    const customer = { ...E2E_VERIFIED_CUSTOMER, email: `voice_${Date.now()}@test.aacp` };
    await page.goto(checkoutUrl(merchantId, embedToken, productId, { customer }));
    // Wait for channel gate to render
    const gate = page.locator(".zyon-channel-gate");
    await expect(gate).toBeVisible({ timeout: 20_000 });
    const voiceButton = page.getByRole("button", { name: /Comprar por voz/i });
    await expect(voiceButton).toBeEnabled({ timeout: 15_000 });
    await voiceButton.click();
    await expect(gate).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });

    // The agent opens with a greeting (no field ask); the buyer speaks first.
    await waitForVoicePrompt(page, /ajudar|finalizar|pedido|compra/i);
    await answerAndWaitForPrompt(page, "1000 apartamento 12", /frete|pac|sedex|cupom|pagamento/i);

    const selector = page.locator(".zyon-shipping-selector");
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
    // PIX never approves synchronously: the intent stays in requires_action and
    // the widget polls status until the provider webhook confirms. Drive that
    // confirmation through the real Asaas webhook so the voice flow completes.
    expect(paymentBody.status).toBe("requires_action");
    const approveWebhook = await request.post(`${REALAPI_URL}/webhooks/asaas`, {
      data: {
        id: `evt_voice_${Date.now()}`,
        event: "PAYMENT_RECEIVED",
        payment: {
          id: `asaas_pay_voice_${Date.now()}`,
          value: (paymentBody.amountCents as number) / 100,
          externalReference: paymentBody.id,
        },
      },
    });
    expect(approveWebhook.ok()).toBe(true, `Asaas webhook failed: ${await approveWebhook.text()}`);

    await expect(page.locator("[data-channel='voice'][data-stage='completed']")).toBeVisible({
      timeout: 15_000,
    });
    await waitForVoicePrompt(page, /confirmado|aprovado/i);
    await waitForChatIdle(page);
  });
});
