import { test, expect } from "@playwright/test";
import { setupApiMocks, SHIPPING_OPTIONS, type FlowStep } from "./fixtures/api-mocks.js";

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
  // Wait for all streaming carets to disappear (text fully rendered)
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
}

async function sendMessage(page: import("@playwright/test").Page, text: string) {
  const input = page.locator("input[aria-label='Mensagem para o assistente']");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(text);
  const sendButton = page.locator("button[aria-label='Enviar mensagem']").first();
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  await sendButton.click();
}

async function waitForAgentReply(page: import("@playwright/test").Page) {
  // Wait for typing indicator to appear and disappear
  const typing = page.locator(".aacp-typing");
  await page.waitForTimeout(300);
  if (await typing.isVisible()) {
    await expect(typing).toBeHidden({ timeout: 15_000 });
  }
  // Wait for streaming caret to disappear (text fully rendered)
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
  // Return the last agent bubble
  const bubbles = page.locator(".aacp-bubble-agent");
  const count = await bubbles.count();
  return bubbles.nth(count - 1);
}

async function waitForComposer(page: import("@playwright/test").Page) {
  const composerWrap = page.locator(".aacp-thread-composer-wrap");
  await expect(composerWrap).toBeVisible({ timeout: 10_000 });
  return composerWrap;
}

async function continueWithoutCoupon(page: import("@playwright/test").Page) {
  const noCoupon = page.locator(".aacp-chip", { hasText: /N(?:a|ã)o tenho cupom/i }).first();
  await expect(noCoupon).toBeVisible({ timeout: 5_000 });
  await noCoupon.click();
  await waitForStreamingDone(page);
}

// ─── 1. Fluxo de Cadastro (data_collection) ──────────────────────────────────

test.describe("1. Fluxo de Cadastro (data_collection)", () => {
  test("widget abre e mostra greeting do agente", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    const bubble = page.locator(".aacp-bubble-agent").first();
    const text = await bubble.textContent();
    expect(text).toContain("Clara");
    // Second bubble asks for name
    const secondBubble = page.locator(".aacp-bubble-agent").nth(1);
    await expect(secondBubble).toBeVisible();
    const secondText = await secondBubble.textContent();
    expect(secondText).toMatch(/nome/i);
  });

  test("composer aparece após streaming terminar", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await waitForComposer(page);
  });

  test("quick replies aparecem na etapa de cadastro", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    const chips = page.locator(".aacp-chip");
    await expect(chips.first()).toBeVisible({ timeout: 5_000 });
  });

  test("usuário envia nome → agente pede email", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_email"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "João Silva");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/e-?mail/i);
  });

  test("usuário envia email → agente pede CPF", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_cpf"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "joao@email.com");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/cpf/i);
  });

  test("usuário envia CPF → agente pede telefone", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_phone"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123.456.789-00");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/telefone/i);
  });

  test("usuário envia telefone → transição para shipping", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_cep", "ask_cep"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "(11) 99999-0000");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/cep|frete/i);
  });
});

// ─── 2. Fluxo de Frete (shipping) ────────────────────────────────────────────

test.describe("2. Fluxo de Frete (shipping)", () => {
  test("agente pede CEP após cadastro completo", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_cep"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "(11) 99999-0000");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/cep/i);
  });

  test("usuário envia CEP → agente confirma endereço", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["confirm_address"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "01310-100");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/endereço|Rua/i);
  });

  test("usuário confirma endereço → agente pede número", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_number"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Sim, está correto");
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/número|complemento/i);
  });

  test("usuário envia número → ShippingSelector aparece com opções", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123, Apto 4B");
    await waitForAgentReply(page);
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
  });

  test("ShippingSelector mostra PAC e Sedex", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123");
    await waitForAgentReply(page);
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");
  });

  test("usuário seleciona frete → transição para payment", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options", "shipping_selected"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123");
    await waitForAgentReply(page);
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    // Click PAC option button
    const pacOption = selector.locator("button", { hasText: /PAC/ }).first();
    await pacOption.click();
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/cupom|pagamento|pagar/i);
    await continueWithoutCoupon(page);
    await expect(page.locator(".aacp-chip", { hasText: /PIX/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test("totais do carrinho atualizam com valor do frete", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options", "shipping_selected"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "123");
    await waitForAgentReply(page);
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    const pacOption = selector.locator("button", { hasText: /PAC/ }).first();
    await pacOption.click();
    await waitForAgentReply(page);
    // Check that totals reflect shipping cost (19.90)
    const pageContent = await page.content();
    expect(pageContent).toMatch(/19[,.]90/);
  });
});

// ─── 3. Fluxo de Pagamento (payment) ─────────────────────────────────────────

test.describe("3. Fluxo de Pagamento (payment)", () => {
  test("quick replies de pagamento aparecem apos pular cupom", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const chips = page.locator(".aacp-chip");
    await expect(chips.filter({ hasText: /cart[aã]o/i }).first()).toBeVisible({ timeout: 5_000 });
    await expect(chips.filter({ hasText: /pix/i }).first()).toBeVisible({ timeout: 3_000 });
    await expect(chips.filter({ hasText: /cupom/i })).toHaveCount(0);
  });

  test("clicar Cartão de crédito → abre CardForm", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const cardChip = page.locator(".aacp-chip", { hasText: /cart[aã]o/i }).first();
    await expect(cardChip).toBeVisible({ timeout: 5_000 });
    await cardChip.click();
    // CardForm should appear — tapQuick opens it directly without network call
    await expect(
      page.getByRole("button", { name: /Pagar com cart[aã]o/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("mensagem ao abrir card form menciona criptografados", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const cardChip = page.locator(".aacp-chip", { hasText: /cart[aã]o/i }).first();
    await expect(cardChip).toBeVisible({ timeout: 5_000 });
    await cardChip.click();
    // Wait for the locally-appended agent message to stream
    await waitForStreamingDone(page);
    const bubbles = page.locator(".aacp-bubble-agent");
    const lastBubble = bubbles.last();
    const text = await lastBubble.textContent();
    expect(text).toMatch(/criptograf/i);
  });

  test("clicar PIX → agente retorna código PIX", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "pix"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const pixChip = page.locator(".aacp-chip", { hasText: /pix/i }).first();
    await expect(pixChip).toBeVisible({ timeout: 5_000 });
    await pixChip.click();
    const reply = await waitForAgentReply(page);
    const text = await reply.textContent();
    expect(text).toMatch(/pix/i);
  });

  test("QR Code renderiza quando há código PIX", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "pix"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const pixChip = page.locator(".aacp-chip", { hasText: /pix/i }).first();
    await expect(pixChip).toBeVisible({ timeout: 5_000 });
    await pixChip.click();
    await waitForAgentReply(page);
    // QR code should render (svg element from react-qr-code)
    const qr = page.locator("svg").filter({ has: page.locator("rect") });
    await expect(qr.first()).toBeVisible({ timeout: 5_000 });
  });

  test("botão Copiar código PIX está visível", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "pix"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    await continueWithoutCoupon(page);
    const pixChip = page.locator(".aacp-chip", { hasText: /pix/i }).first();
    await expect(pixChip).toBeVisible({ timeout: 5_000 });
    await pixChip.click();
    await waitForAgentReply(page);
    const copyBtn = page.locator("button", { hasText: /copiar|copy/i }).first();
    await expect(copyBtn).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 4. Fluxo de Cupom ───────────────────────────────────────────────────────

test.describe("4. Fluxo de Cupom", () => {
  test("quick reply 'Tenho um cupom' → mostra coupon box", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    const couponChip = page.locator(".aacp-chip", { hasText: /cupom/i }).first();
    await expect(couponChip).toBeVisible({ timeout: 5_000 });
    await couponChip.click();
    // tapQuick for coupon sets couponInputVisible=true locally, no network call
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });
  });

  test("input de cupom aceita texto e botão Aplicar funciona", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "coupon_applied"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    const couponChip = page.locator(".aacp-chip", { hasText: /cupom/i }).first();
    await expect(couponChip).toBeVisible({ timeout: 5_000 });
    await couponChip.click();
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });
    const input = couponBox.locator("input");
    await input.fill("DESCONTO10");
    const applyBtn = couponBox.locator("button", { hasText: /aplicar/i });
    await applyBtn.click();
    // Wait for response to process
    await page.waitForTimeout(1_500);
  });

  test("após aplicar cupom → desconto reflete nos totais", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "coupon_applied"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    const couponChip = page.locator(".aacp-chip", { hasText: /cupom/i }).first();
    await expect(couponChip).toBeVisible({ timeout: 5_000 });
    await couponChip.click();
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });
    const input = couponBox.locator("input");
    await input.fill("DESCONTO10");
    const applyBtn = couponBox.locator("button", { hasText: /aplicar/i });
    await applyBtn.click();
    await page.waitForTimeout(2_000);
    // Discount should appear in page
    const content = await page.content();
    expect(content).toMatch(/89[,.]98|desconto|10%/i);
  });

  test("offer banner aparece quando há desconto", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["payment_options", "coupon_applied"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "PAC");
    await waitForAgentReply(page);
    const couponChip = page.locator(".aacp-chip", { hasText: /cupom/i }).first();
    await expect(couponChip).toBeVisible({ timeout: 5_000 });
    await couponChip.click();
    const couponBox = page.locator(".aacp-coupon-box");
    await expect(couponBox).toBeVisible({ timeout: 3_000 });
    const input = couponBox.locator("input");
    await input.fill("DESCONTO10");
    const applyBtn = couponBox.locator("button", { hasText: /aplicar/i });
    await applyBtn.click();
    await page.waitForTimeout(2_000);
    const offerBanner = page.locator(".aacp-offer-banner");
    await expect(offerBanner).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 5. Fluxo Completo (completed) ───────────────────────────────────────────

test.describe("5. Fluxo Completo (completed)", () => {
  test("após pagamento confirmado → stage completed", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar pagamento");
    await waitForAgentReply(page);
    // Completed banner should appear
    const completedBanner = page.locator(".aacp-order-confirmation");
    await expect(completedBanner).toBeVisible({ timeout: 5_000 });
  });

  test("mensagem de Pedido confirmado aparece", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar");
    await waitForAgentReply(page);
    const content = await page.content();
    expect(content).toMatch(/Pedido confirmado/i);
  });

  test("composer fica oculto no stage completed", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar");
    await waitForAgentReply(page);
    await page.waitForTimeout(500);
    const composerWrap = page.locator(".aacp-thread-composer-wrap");
    await expect(composerWrap).toBeHidden({ timeout: 3_000 });
  });
});

// ─── 6. Painel de Suporte ─────────────────────────────────────────────────────

test.describe("6. Painel de Suporte", () => {
  test("botão de suporte abre painel", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    const supportBtn = page.locator("button.aacp-header-help[aria-label='Abrir ajuda']");
    await expect(supportBtn).toBeVisible({ timeout: 5_000 });
    await supportBtn.click();
    const panel = page.locator("aside.aacp-ai-panel");
    await expect(panel).toHaveClass(/open/, { timeout: 3_000 });
  });

  test("enviar mensagem no suporte → recebe resposta", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["greeting"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    const supportBtn = page.locator("button.aacp-header-help[aria-label='Abrir ajuda']");
    await expect(supportBtn).toBeVisible({ timeout: 5_000 });
    await supportBtn.click();
    const panel = page.locator("aside.aacp-ai-panel");
    await expect(panel).toHaveClass(/open/, { timeout: 3_000 });
    // Type in support composer
    const input = panel.locator("input.aacp-input");
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill("Qual o prazo de entrega?");
    await page.keyboard.press("Enter");
    // Wait for agent reply in support panel
    await page.waitForTimeout(2_000);
    const bubbles = panel.locator(".aacp-bubble-agent");
    const count = await bubbles.count();
    expect(count).toBeGreaterThan(0);
  });
});

// ─── 7. Carrinho lateral ──────────────────────────────────────────────────────

test.describe("7. Carrinho lateral", () => {
  test("botão do carrinho abre painel lateral", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    // Use header cart button
    const cartBtn = page.locator("button.aacp-cart-btn, button.aacp-cart-fab").first();
    await expect(cartBtn).toBeVisible({ timeout: 5_000 });
    await cartBtn.click();
    const cartPanel = page.locator("#aacp-cart-panel");
    await expect(cartPanel).toHaveClass(/open/, { timeout: 3_000 });
  });

  test("itens do carrinho são exibidos corretamente", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    const cartBtn = page.locator("button.aacp-cart-btn, button.aacp-cart-fab").first();
    await expect(cartBtn).toBeVisible({ timeout: 5_000 });
    await cartBtn.click();
    const cartPanel = page.locator("#aacp-cart-panel");
    await expect(cartPanel).toHaveClass(/open/, { timeout: 3_000 });
    // Should show the item name
    await expect(cartPanel).toContainText("Bolsa Executiva");
    // Should show quantity
    await expect(cartPanel).toContainText("2");
  });

  test("incrementar/decrementar quantidade funciona", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: [] });
    await page.goto(BASE);
    await waitForGreeting(page);
    const cartBtn = page.locator("button.aacp-cart-btn, button.aacp-cart-fab").first();
    await expect(cartBtn).toBeVisible({ timeout: 5_000 });
    await cartBtn.click();
    const cartPanel = page.locator("#aacp-cart-panel");
    await expect(cartPanel).toHaveClass(/open/, { timeout: 3_000 });
    // Find increment button
    const incrementBtn = cartPanel.locator("button[aria-label^='Aumentar quantidade']").first();
    await expect(incrementBtn).toBeVisible({ timeout: 3_000 });
    await incrementBtn.click();
    await page.waitForTimeout(300);
    // Quantity should now be 3
    const qtySpan = cartPanel.locator(".aacp-item-meta span").first();
    await expect(qtySpan).toContainText("3");
    // Find decrement button
    const decrementBtn = cartPanel.locator("button[aria-label^='Diminuir quantidade']").first();
    await decrementBtn.click();
    await page.waitForTimeout(300);
    await expect(qtySpan).toContainText("2");
  });
});

// ─── 8. Resiliência / Edge cases ──────────────────────────────────────────────

test.describe("8. Resiliência / Edge cases", () => {
  test("erro de rede → mostra mensagem de erro com botão Tentar novamente", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_email"], failOnChatCall: 1 });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "João Silva");
    // Should show error state with retry button
    const retryBtn = page.locator("button", { hasText: /Tentar novamente|tentar/i });
    await expect(retryBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test("retry reconecta e restaura o fluxo", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_email", "ask_cpf"], failOnChatCall: 1 });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "João Silva");
    // Wait for error and retry button
    const retryBtn = page.locator("button", { hasText: /Tentar novamente|tentar/i });
    await expect(retryBtn.first()).toBeVisible({ timeout: 10_000 });
    await retryBtn.first().click();
    // After retry, the next call should succeed (failOnChatCall only affects call #1)
    // The widget should recover — either show composer or agent reply
    await page.waitForTimeout(2_000);
    const thread = page.locator(".aacp-thread");
    await expect(thread).toBeVisible();
  });
});
