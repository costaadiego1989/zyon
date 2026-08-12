/**
 * Full Checkout Journey E2E Test
 * Sequence: cart → chat → agent → discount → shipping → buyer data → payment → order
 *
 * Tests the complete happy path and validates each stage transition.
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  buildExperience,
  startCheckoutResponse,
  noBootstrapDataCollectionExperience,
  type FlowStep,
} from "./fixtures/api-mocks.js";
import { CheckoutPage, AgentChatPanel, PaymentPanel, OrderConfirmationPage } from "./fixtures/page-objects.js";
import { createSessionFixture, installTestInit, setupFullJourneyMocks } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("Checkout Full Journey @e2e", () => {
  test.setTimeout(120_000);

  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    await installTestInit(page);
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
  });

  test("complete journey: cart → chat → registration → shipping → PIX payment → order confirmed", async ({ page }) => {
    const session = createSessionFixture();
    const sequence: FlowStep[] = [
      "ask_email",
      "ask_cpf",
      "ask_phone",
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
      "shipping_selected",
    ];

    await setupApiMocks(page, {
      chatSequence: sequence,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    const chat = new AgentChatPanel(page);
    const orderConfirm = new OrderConfirmationPage(page);

    // Stage 1: Load widget and see cart items
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Stage 2: Chat with agent — provide buyer data
    await checkout.sendMessage("João Silva");
    let reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/e-?mail/i);

    await checkout.sendMessage("joao@email.com");
    reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/cpf/i);

    await checkout.sendMessage("123.456.789-00");
    reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/telefone/i);

    await checkout.sendMessage("(11) 99888-7766");
    reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/cep/i);

    // Stage 3: Shipping — provide CEP and confirm address
    await checkout.sendMessage("01310-100");
    reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/endereço|correto/i);

    await checkout.sendMessage("Sim, está correto");
    reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/número|complemento/i);

    await checkout.sendMessage("42, Bloco A");
    reply = await checkout.waitForAgentReply();

    // Stage 4: Select shipping method
    await checkout.selectShipping(/PAC/);

    // Stage 5: Payment — tap PIX quick reply
    await checkout.tapQuickReply(/PIX/i);

    // Stage 6: Order confirmation
    await orderConfirm.expectOrderConfirmed();
    await orderConfirm.expectOrderReference();
    await orderConfirm.expectComposerHidden();

    // Validate no unexpected console errors
    await checkout.assertNoConsoleErrors(consoleErrors);
  });

  test("complete journey with card payment", async ({ page }) => {
    const sequence: FlowStep[] = [
      "ask_email",
      "ask_cpf",
      "ask_phone",
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
      "shipping_selected",
    ];

    await setupApiMocks(page, {
      chatSequence: sequence,
      cardInstantApproval: true,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    const orderConfirm = new OrderConfirmationPage(page);

    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Complete registration
    await checkout.sendMessage("Maria Santos");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("maria@example.com");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("987.654.321-00");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("(21) 97777-6655");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("20040-020");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("Correto");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("500, Sala 12");
    await checkout.waitForAgentReply();

    // Shipping
    await checkout.selectShipping(/PAC/);

    // Payment — card
    await checkout.tapQuickReply(/cart[aã]o/i);

    // Order confirmation
    await orderConfirm.expectVisible();
    await expect(orderConfirm.confirmation).toContainText(/Pedido confirmado|Pagamento confirmado/i);
  });

  test("journey with coupon discount applied before payment", async ({ page }) => {
    const sequence: FlowStep[] = [
      "ask_email",
      "ask_cpf",
      "ask_phone",
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
      "shipping_selected",
      "coupon_applied",
    ];

    await setupApiMocks(page, {
      chatSequence: sequence,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);

    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Fast-forward through registration
    await checkout.sendMessage("Ana Souza");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("ana@test.com");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("111.222.333-44");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("(31) 96666-5544");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("30130-000");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("Sim");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("200");
    await checkout.waitForAgentReply();

    // Shipping
    await checkout.selectShipping(/PAC/);

    // Apply coupon
    await checkout.tapQuickReply(/cupom/i);
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/cupom|desconto|10%/i);
  });

  test("validates HTTP responses are 200/201 (no 5xx)", async ({ page }) => {
    const requestStatuses: { url: string; status: number }[] = [];

    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("localhost:3009") || url.includes("127.0.0.1:3009")) {
        requestStatuses.push({ url, status: response.status() });
      }
    });

    await setupApiMocks(page, {
      chatSequence: ["ask_email", "ask_cpf"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Test User");
    await checkout.waitForAgentReply();
    await checkout.sendMessage("test@email.com");
    await checkout.waitForAgentReply();

    // Assert no 5xx responses
    const serverErrors = requestStatuses.filter((r) => r.status >= 500);
    expect(serverErrors).toHaveLength(0);
  });

  test("responsive: mobile viewport (375x667)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Thread should be visible and usable on mobile
    await expect(checkout.thread).toBeVisible();
    await expect(checkout.input).toBeVisible();

    // Send a message on mobile
    await checkout.sendMessage("Teste mobile");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toBeTruthy();
  });

  test("responsive: desktop viewport (1280x720)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });

    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await expect(checkout.thread).toBeVisible();
    await checkout.sendMessage("Teste desktop");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toBeTruthy();
  });
});
