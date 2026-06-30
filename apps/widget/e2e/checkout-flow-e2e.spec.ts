import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  startCheckoutResponse,
  buildExperience,
  chatResponse,
  completedExperience,
  paymentExperience,
  type FlowStep,
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
  // Dismiss the channel gate (AgentChannelWelcome) if present. On a fresh origin
  // the widget asks the buyer to pick chat vs voice before rendering the thread;
  // without choosing, the greeting turns are deferred and never appear.
  const gate = page.locator(".zyon-channel-gate__panel[role='dialog']");
  if (await gate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByRole("button", { name: /Comprar por chat/i }).click();
  }
  const thread = page.locator(".zyon-thread");
  await expect(thread).toBeVisible({ timeout: 10_000 });
  const firstBubble = thread.locator(".zyon-bubble-agent").first();
  await expect(firstBubble).toBeVisible({ timeout: 10_000 });
  return firstBubble;
}

async function waitForStreamingDone(page: import("@playwright/test").Page) {
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

async function tapQuickReply(page: import("@playwright/test").Page, label: RegExp | string) {
  const btn = page.locator(".zyon-quick-replies button", { hasText: label });
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
}

async function continueWithoutCoupon(page: import("@playwright/test").Page) {
  // ADR §8: coupon gate quick replies are "Sim" / "Não". Tap "Não" to decline.
  await tapQuickReply(page, /^N(?:a|ã)o$/i);
  await waitForStreamingDone(page);
}

async function waitForAgentReply(page: import("@playwright/test").Page) {
  const typing = page.locator(".zyon-typing");
  await page.waitForTimeout(300);
  if (await typing.isVisible()) {
    await expect(typing).toBeHidden({ timeout: 15_000 });
  }
  await expect(page.locator(".chat-caret")).toHaveCount(0, { timeout: 15_000 });
  const bubbles = page.locator(".zyon-bubble-agent");
  const count = await bubbles.count();
  return bubbles.nth(count - 1);
}

// ─── Payment Confirmation Component ─────────────────────────────────────────

test.describe("Payment Confirmation Component", () => {
  test("shows full confirmation with order reference after payment", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar pagamento");
    await waitForAgentReply(page);

    // Confirmation component should be visible
    const confirmation = page.locator(".zyon-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 5_000 });

    // Should show "Pedido confirmado"
    await expect(confirmation).toContainText("Pedido confirmado");

    // Should show order reference (ADR §10: "Referência da sessão {sessionRef}")
    await expect(confirmation).toContainText(/Referência da sessão/i);
  });

  test("shows order summary with items and totals", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar pagamento");
    await waitForAgentReply(page);

    const confirmation = page.locator(".zyon-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 5_000 });

    // Should show "Resumo do pedido"
    await expect(confirmation).toContainText("Resumo do pedido");

    // Should show item name
    await expect(confirmation).toContainText("Bolsa Executiva");

    // Should show total
    await expect(confirmation).toContainText("Total");
  });

  test("shows 'Voltar para a loja' button with correct URL", async ({ page }) => {
    // Use a config with emptyCartRedirectUrl
    await setupApiMocks(page, { chatSequence: ["completed"] });
    // Inject the attribute on the custom element before it initializes
    await page.addInitScript(() => {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement && node.tagName.toLowerCase() === "zyon-checkout-agent") {
              node.setAttribute("empty-cart-redirect-url", "https://loja.example.com");
              observer.disconnect();
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar pagamento");
    await waitForAgentReply(page);

    const confirmation = page.locator(".zyon-order-confirmation");
    await expect(confirmation).toBeVisible({ timeout: 5_000 });

    // Return button should be visible
    const returnBtn = page.locator("[data-testid='return-to-store']");
    await expect(returnBtn).toBeVisible({ timeout: 3_000 });
    await expect(returnBtn).toContainText("Voltar para a loja");
  });

  test("confirmation hides composer and quick replies", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["completed"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);
    await sendMessage(page, "Confirmar pagamento");
    await waitForAgentReply(page);

    // Composer should not be visible
    const composer = page.locator(".zyon-thread-composer-wrap");
    await expect(composer).toBeHidden({ timeout: 3_000 });

    // Quick replies should not be visible
    const quickReplies = page.locator(".zyon-quick-replies");
    await expect(quickReplies).toBeHidden({ timeout: 3_000 });
  });
});

// ─── Full End-to-End Checkout Flow ───────────────────────────────────────────

test.describe("Full Checkout Flow E2E", () => {
  test("complete flow: cadastro → frete → pagamento → PIX gerado", async ({ page }) => {
    const fullSequence: FlowStep[] = [
      "ask_email",
      "ask_cpf",
      "ask_phone",
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
      "shipping_selected",
    ];
    await setupApiMocks(page, { chatSequence: fullSequence });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    // Step 1: Send name
    await sendMessage(page, "João Silva");
    let reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/e-?mail/i);

    // Step 2: Send email
    await sendMessage(page, "joao@email.com");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/cpf/i);

    // Step 3: Send CPF
    await sendMessage(page, "123.456.789-00");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/telefone/i);

    // Step 4: Send phone
    await sendMessage(page, "(11) 99999-0000");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/cep|frete/i);

    // Step 5: Send CEP
    await sendMessage(page, "01310-100");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/endereço|Rua/i);

    // Step 6: Confirm address
    await sendMessage(page, "Sim, está correto");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/número|complemento/i);

    // Step 7: Send number
    await sendMessage(page, "123, Apto 4B");
    await waitForAgentReply(page);

    // ShippingSelector should appear
    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });

    // Step 8: Select shipping
    const pacBtn = selector.locator("button", { hasText: /PAC/ }).first();
    await pacBtn.click();
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/cupom|pagamento|pagar/i);
    await continueWithoutCoupon(page);

    // Step 9: Tap PIX quick reply — generates payment intent (does not complete order)
    await tapQuickReply(page, /PIX/i);
    // Wait for PIX intent response (appendAgentTurn with "Cobrança gerada")
    await page.waitForTimeout(500);
    await waitForStreamingDone(page);

    // Verify PIX payment was generated
    const bubbles = page.locator(".zyon-bubble-agent");
    const lastBubble = bubbles.last();
    await expect(lastBubble).toContainText(/Cobrança|PIX/i, { timeout: 5_000 });
  });

  test("cliente existente verifica email, loga e pula direto para escolha do frete", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email", "existing_buyer_otp_sent", "existing_buyer_shipping_options"],
    });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    await sendMessage(page, "Diego Costa");
    let reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/e-?mail/i);

    await sendMessage(page, "costaadiego1989@gmail.com");
    reply = await waitForAgentReply(page);
    expect(await reply.textContent()).toMatch(/codigo|verifica/i);

    const loginResponse = page.waitForResponse((res) =>
      res.url().includes("/buyer/login-from-session") && res.request().method() === "POST"
    );
    await sendMessage(page, "123456");
    await waitForAgentReply(page);

    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");

    const logged = await loginResponse;
    expect(logged.ok()).toBe(true);
    const stored = await page.evaluate(() => window.localStorage.getItem("aacp_global_auth_session"));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.email).toBe("costaadiego1989@gmail.com");
    expect(parsed.global_user_id).toBe("buyer_existing_e2e");
  });

  test("stage indicator updates through the flow", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["ask_cep", "show_shipping_options", "shipping_selected"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    // Initially should show "Cadastro"
    const stageLabel = page.locator(".zyon-stage-progress-title");
    await expect(stageLabel).toContainText("Cadastro");

    // Send phone → transition to shipping
    await sendMessage(page, "(11) 99999-0000");
    await waitForAgentReply(page);
    await expect(stageLabel).toContainText("Entrega");

    // Send number → show shipping options
    await sendMessage(page, "123");
    await waitForAgentReply(page);

    // Select shipping → transition to payment
    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    const pacBtn = selector.locator("button", { hasText: /PAC/ }).first();
    await pacBtn.click();
    await waitForAgentReply(page);
    await expect(stageLabel).toContainText("Pagamento");
  });

  test("cart totals remain consistent through the flow", async ({ page }) => {
    await setupApiMocks(page, { chatSequence: ["show_shipping_options", "shipping_selected"] });
    await page.goto(BASE);
    await waitForGreeting(page);
    await waitForStreamingDone(page);

    // Before shipping selection, total = subtotal
    const totalEl = page.locator(".zyon-cart-total dd");

    // Send message to get shipping options
    await sendMessage(page, "123");
    await waitForAgentReply(page);

    // Select PAC (19.90)
    const selector = page.locator(".zyon-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    const pacBtn = selector.locator("button", { hasText: /PAC/ }).first();
    await pacBtn.click();
    await waitForAgentReply(page);

    // After selection, total should include shipping
    const totalText = await totalEl.textContent();
    expect(totalText).toMatch(/919[,.]70/);
  });
});
