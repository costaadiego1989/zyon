import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  SHIPPING_OPTIONS,
  type FlowStep,
  buildExperience,
  chatResponse,
  startCheckoutResponse,
  dataCollectionExperience,
  shippingExperience,
  paymentExperience,
  completedExperience,
} from "./fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// Disable streaming animation in e2e tests for deterministic behavior
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).process = { env: { AACP_DISABLE_STREAMING: "1" } };
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForGreeting(page: import("@playwright/test").Page) {
  const thread = page.locator(".aacp-thread");
  await expect(thread).toBeVisible({ timeout: 10_000 });
  const firstBubble = thread.locator(".aacp-bubble-agent").first();
  await expect(firstBubble).toBeVisible({ timeout: 10_000 });
  return firstBubble;
}

async function waitForStreamingDone(page: import("@playwright/test").Page) {
  // Give streaming a moment to start (caret appears), then wait for it to finish
  await page.waitForTimeout(500);
  // Wait for any active streaming caret to disappear (streaming complete)
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
  // If composer is visible (non-payment stages), wait for it to confirm unlock
  const input = page.locator("input[aria-label='Mensagem para o assistente']");
  if (await input.isVisible()) {
    await expect(input).toBeVisible({ timeout: 5_000 });
  }
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
  const input = page.locator("input[aria-label='Mensagem para o assistente']");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(text);
  await page.keyboard.press("Enter");
}

async function waitForAgentReply(page: import("@playwright/test").Page) {
  // Wait for the API call to complete and streaming to start
  await page.waitForTimeout(500);
  const typing = page.locator(".aacp-typing");
  if (await typing.isVisible()) {
    await expect(typing).toBeHidden({ timeout: 15_000 });
  }
  // Wait for streaming caret to disappear (if it appeared)
  await page.waitForTimeout(300);
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
  const bubbles = page.locator(".aacp-bubble-agent");
  const count = await bubbles.count();
  return bubbles.nth(count - 1);
}

async function getQuickReplyLabels(page: import("@playwright/test").Page): Promise<string[]> {
  const chips = page.locator(".aacp-quick-replies .aacp-chip");
  await expect(chips.first()).toBeVisible({ timeout: 5_000 });
  return chips.allTextContents();
}

async function clickQuickReply(page: import("@playwright/test").Page, text: string | RegExp) {
  const chip = page.locator(".aacp-chip", { hasText: text }).first();
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await chip.click();
}

// ─── 1. Quick Replies - Data Collection Stage ────────────────────────────────

test.describe("Quick Replies - Data Collection Stage", () => {
  test("shows contextual quick replies for name field", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_name"],
      startResponse: startCheckoutResponse(
        buildExperience({
          stage: "data_collection",
          copy: {
            headline: "Checkout assistido por IA",
            subheadline: "Finalize sua compra.",
            trust_badges: ["Pagamento seguro"],
            quick_replies: ["Por que precisa do meu nome?", "Posso usar nome de empresa?", "É seguro informar dados aqui?"],
          },
        })
      ),
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    const labels = await getQuickReplyLabels(page);
    expect(labels).toContain("Por que precisa do meu nome?");
    expect(labels).toContain("Posso usar nome de empresa?");
    expect(labels).toContain("É seguro informar dados aqui?");
  });

  test("clicking 'Por que precisa do meu nome?' gets contextual response", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_name"],
      startResponse: startCheckoutResponse(
        buildExperience({
          stage: "data_collection",
          copy: {
            headline: "Checkout assistido por IA",
            subheadline: "Finalize sua compra.",
            trust_badges: ["Pagamento seguro"],
            quick_replies: ["Por que precisa do meu nome?", "Posso usar nome de empresa?"],
          },
        })
      ),
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await clickQuickReply(page, /Por que precisa do meu nome/);
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    // Should get a contextual answer about why name is needed, not a generic fallback
    expect(text).toMatch(/nome|nota fiscal|personalizar/i);
  });

  test("shows email-related quick replies after name is provided", async ({ page }) => {
    const emailExperience = buildExperience({
      stage: "data_collection",
      copy: {
        headline: "Checkout assistido por IA",
        subheadline: "Finalize sua compra.",
        trust_badges: ["Pagamento seguro"],
        quick_replies: ["Vão me mandar SPAM?", "Posso usar outro e-mail?", "Vocês enviam a nota por e-mail?"],
      },
    });

    const startBody = JSON.stringify(startCheckoutResponse(emailExperience));
    const chatBody = JSON.stringify(chatResponse({
      message: "Obrigada! Agora preciso do seu e-mail para enviar a confirmação.",
      experience: emailExperience,
      stage: "data_collection",
      missingFields: ["customer.email"],
    }));
    const trackBody = JSON.stringify({ received: true });

    // Intercept both embed and legacy paths
    await page.route("**/embed/start", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/embed/chat", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/chat/message", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/embed/track", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });
    await page.route("**/track-event", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });

    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "João Silva");
    await waitForAgentReply(page);

    const labels = await getQuickReplyLabels(page);
    expect(labels).toContain("Vão me mandar SPAM?");
    expect(labels).toContain("Posso usar outro e-mail?");
  });
});

// ─── 2. Quick Replies - Shipping Stage ───────────────────────────────────────

test.describe("Quick Replies - Shipping Stage", () => {
  test("shows shipping quick replies when asking for CEP", async ({ page }) => {
    const shippingExp = buildExperience({
      stage: "shipping",
      copy: {
        headline: "Checkout assistido por IA",
        subheadline: "Finalize sua compra.",
        trust_badges: ["Pagamento seguro"],
        quick_replies: ["Como calculo o frete?", "Entregam em todo o Brasil?", "Não sei meu CEP, como faço?"],
      },
    });

    const startBody = JSON.stringify(startCheckoutResponse(shippingExp));
    const chatBody = JSON.stringify(chatResponse({
      message: "Ótimo! Agora vamos calcular o frete. Qual é o seu CEP?",
      experience: shippingExp,
      stage: "shipping",
      missingFields: ["shipping.address.zipCode"],
    }));
    const trackBody = JSON.stringify({ received: true });

    await page.route("**/embed/start", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/embed/chat", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/chat/message", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/embed/track", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });
    await page.route("**/track-event", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });

    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "(11) 99999-0000");
    await waitForAgentReply(page);

    const labels = await getQuickReplyLabels(page);
    expect(labels).toContain("Como calculo o frete?");
    expect(labels).toContain("Entregam em todo o Brasil?");
  });

  test("shows freight selection quick replies after address confirmed", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123, Apto 4B");
    await waitForAgentReply(page);

    // ShippingSelector should appear
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");
  });

  test("clicking 'Tem frete grátis?' gets contextual response", async ({ page }) => {
    const shippingExp = shippingExperience({ withOptions: true });
    shippingExp.copy.quick_replies = ["Tem frete grátis?", "O prazo está muito longo"];

    const startBody = JSON.stringify(startCheckoutResponse(shippingExp));
    const chatBody = JSON.stringify(chatResponse({
      message: "O frete é calculado com base no CEP e peso do pedido. Não posso garantir frete grátis, mas vou mostrar as melhores opções disponíveis. Selecione uma das opções de frete acima.",
      experience: shippingExp,
      stage: "shipping",
      missingFields: ["frete"],
    }));
    const trackBody = JSON.stringify({ received: true });

    await page.route("**/embed/start", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: startBody });
    });
    await page.route("**/embed/chat", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/chat/message", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: chatBody });
    });
    await page.route("**/embed/track", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });
    await page.route("**/track-event", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: trackBody });
    });

    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await clickQuickReply(page, /Tem frete gr/);
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/frete|opções|CEP/i);
  });
});

// ─── 3. Quick Replies - Payment Stage ────────────────────────────────────────

test.describe("Quick Replies - Payment Stage", () => {
  test("shows payment method quick replies", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);

    const labels = await getQuickReplyLabels(page);
    expect(labels.some(l => /cart[aã]o/i.test(l))).toBe(true);
    expect(labels.some(l => /pix/i.test(l))).toBe(true);
  });

  test("clicking 'Cartão de crédito' opens card form", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);

    await clickQuickReply(page, /cart[aã]o/i);
    const cardForm = page.locator("form").filter({ hasText: /Pagar|Número do cartão|Card|Validade/i });
    await expect(cardForm).toBeVisible({ timeout: 5_000 });
  });

  test("clicking 'PIX' triggers payment intent", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);

    await clickQuickReply(page, /^pix$/i);
    // Should show PIX-related content (QR code or payment message)
    await waitForAgentReply(page);
    const bubbles = page.locator(".aacp-bubble-agent");
    const lastBubble = bubbles.last();
    const text = await lastBubble.textContent();
    expect(text).toMatch(/pix|pagamento|confirmado/i);
  });

  test("clicking 'Tenho um cupom' shows coupon input", async ({ page }) => {
    const payExp = paymentExperience();
    payExp.copy.quick_replies = ["Tenho um cupom de desconto", "Cartão de crédito", "PIX"];
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(payExp),
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await clickQuickReply(page, /cupom/i);
    // Coupon box should appear
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });
    // Should also show a contextual message
    await waitForStreamingDone(page);
    const bubbles = page.locator(".aacp-bubble-agent");
    const lastBubble = bubbles.last();
    const text = await lastBubble.textContent();
    expect(text).toMatch(/cupom|código|desconto/i);
  });

  test("coupon input submits code and hides after apply", async ({ page }) => {
    const payExp = paymentExperience();
    payExp.copy.quick_replies = ["Tenho um cupom de desconto", "Cartão de crédito", "PIX"];
    await setupApiMocks(page, {
      chatSequence: ["coupon_applied"],
      startResponse: startCheckoutResponse(payExp),
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await clickQuickReply(page, /cupom/i);
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });

    // Type coupon code
    const couponInput = page.locator(".aacp-coupon-box input");
    await couponInput.fill("DESCONTO10");
    // Submit
    const applyBtn = page.locator(".aacp-coupon-box button[type='submit']");
    await applyBtn.click();

    // Agent should respond with coupon applied
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/cupom|desconto|aplicado/i);
  });

  test("clicking 'Boleto' shows unavailable message", async ({ page }) => {
    const payExp = paymentExperience();
    payExp.copy.quick_replies = ["Cartão de crédito", "PIX", "Boleto"];
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(payExp),
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await clickQuickReply(page, /^boleto$/i);
    await waitForStreamingDone(page);
    const bubbles = page.locator(".aacp-bubble-agent");
    const lastBubble = bubbles.last();
    const text = await lastBubble.textContent();
    expect(text).toMatch(/boleto.*não.*disponível|não.*disponível.*boleto|escolha.*cartão.*pix/i);
  });
});
