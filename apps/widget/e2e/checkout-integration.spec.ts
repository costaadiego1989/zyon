/**
 * Integration tests (mocked API) — full journeys + error paths.
 */
import { expect, test } from "@playwright/test";
import { setupApiMocks, type FlowStep, noBootstrapDataCollectionExperience, startCheckoutResponse } from "./fixtures/api-mocks.js";
import {
  CHAT_REGISTRATION_SEQUENCE,
  completeChatRegistration,
  continueWithoutCoupon,
  installChatTestInit,
  openChatCheckout,
  openChatFromChannelGate,
  selectChatShipping,
  sendMessage,
  tapQuickReply,
  waitForAgentReply,
  waitForGreeting,
  waitForStreamingDone,
} from "./fixtures/chat-helpers.js";

test.beforeEach(async ({ page }) => {
  await installChatTestInit(page);
});

test.describe("Integração chat — fluxo completo até completed", () => {
  test.setTimeout(120_000);

  test("cadastro → frete → PIX (polling) → Pedido confirmado", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: CHAT_REGISTRATION_SEQUENCE,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await completeChatRegistration(page);
    await selectChatShipping(page);

    await tapQuickReply(page, /PIX/i);
    await waitForStreamingDone(page);

    const confirmation = page.locator(".zyon-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await expect(confirmation).toContainText(/Pedido confirmado/i);
    await expect(page.locator(".zyon-thread-composer-wrap")).toBeHidden({ timeout: 5_000 });
  });

  test("cadastro → frete → cartão (aprovado pelo mock) → Pedido confirmado", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: CHAT_REGISTRATION_SEQUENCE,
      cardInstantApproval: true,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await completeChatRegistration(page);
    await selectChatShipping(page);
    await tapQuickReply(page, /cart[aã]o/i);

    const confirmation = page.locator(".zyon-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 15_000 });
    await expect(confirmation).toContainText(/Pedido confirmado|Pagamento confirmado/i);
  });
});

test.describe("Integração chat — channel gate", () => {
  test("Comprar por chat fecha dialog e inicia thread", async ({ page }) => {
    await openChatFromChannelGate(page, []);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".zyon-thread")).toBeVisible();
  });
});

test.describe("Integração chat — error paths", () => {
  test.setTimeout(90_000);

  test("OTP inválido mantém etapa de verificação", async ({ page }) => {
    await openChatCheckout(page, {
      chatSequence: ["ask_name", "ask_email", "existing_buyer_otp_sent", "existing_buyer_otp_sent"],
      rejectBuyerLogin: true,
    });
    await sendMessage(page, "Diego Costa");
    await waitForAgentReply(page);
    await sendMessage(page, "costaadiego1989@gmail.com");
    await waitForAgentReply(page);
    await sendMessage(page, "000000");
    await waitForAgentReply(page);

    await expect(page.locator(".zyon-order-confirmation")).not.toBeVisible();
    await expect(page.locator(".zyon-thread")).toContainText(/codigo|verifica/i);
  });

  test("cupom inválido mantém fluxo e não aplica desconto", async ({ page }) => {
    const sequence: FlowStep[] = [...CHAT_REGISTRATION_SEQUENCE];
    await setupApiMocks(page, {
      chatSequence: sequence,
      rejectCoupon: true,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await completeChatRegistration(page);
    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await selector.locator("button", { hasText: /PAC/ }).first().click();
    await waitForAgentReply(page);

    await tapQuickReply(page, /tenho um cupom|^sim$/i);
    const couponBox = page.locator(".zyon-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 5_000 });
    await couponBox.locator("input").fill("INVALIDO");
    await couponBox.locator("button", { hasText: /aplicar/i }).click();
    await page.waitForTimeout(1_500);

    await expect(page.locator(".zyon-order-confirmation")).not.toBeVisible();
    const content = await page.content();
    expect(content).toMatch(/inv[aá]lido|cupom|n[aã]o/i);
  });

  test("falha ao criar payment intent mostra mensagem ao usuário", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: CHAT_REGISTRATION_SEQUENCE,
      failPaymentIntent: true,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });
    await page.goto(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await completeChatRegistration(page);
    await selectChatShipping(page);
    await tapQuickReply(page, /PIX/i);
    await waitForStreamingDone(page);

    const lastBubble = page.locator(".zyon-bubble-agent").last();
    await expect(lastBubble).toContainText(/falha|tente|pagamento|cobran/i, { timeout: 10_000 });
    await expect(page.locator(".zyon-order-confirmation")).not.toBeVisible();
  });

  test("erro de rede no chat → Tentar novamente restaura fluxo", async ({ page }) => {
    await openChatCheckout(page, {
      chatSequence: ["ask_name", "ask_email", "ask_cpf"],
      failOnChatCall: 2,
    });
    await sendMessage(page, "João Silva");

    const retryBtn = page.locator(".zyon-network-error button", { hasText: /Tentar novamente/i });
    await expect(retryBtn).toBeVisible({ timeout: 10_000 });
    await retryBtn.click();
    await page.waitForTimeout(2_000);
    await expect(page.locator(".zyon-thread")).toBeVisible();
  });
});
