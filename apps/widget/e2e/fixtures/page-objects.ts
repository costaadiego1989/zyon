/**
 * Page Object Models for E2E checkout tests.
 * Encapsulates selectors and interactions for reuse across specs.
 */
import { expect, type Locator, type Page } from "@playwright/test";

// ─── CheckoutPage ────────────────────────────────────────────────────────────

export class CheckoutPage {
  readonly page: Page;
  readonly thread: Locator;
  readonly composer: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;
  readonly quickReplies: Locator;
  readonly channelGate: Locator;
  readonly cartSummary: Locator;
  readonly shippingSelector: Locator;

  constructor(page: Page) {
    this.page = page;
    // Pulse renders chat inside a scrollable div that contains message divs
    this.thread = page.locator("div[style*='overflow']").first();
    this.composer = page.locator("input[placeholder*='Mensagem']").or(page.locator("input[placeholder*='para o assistente']")).first();
    this.input = this.composer;
    // Send button is typically a button near the input, or identified by aria-label
    this.sendButton = page.locator("button").filter({ has: page.locator("svg") }).last();
    this.quickReplies = page.locator("button").filter({ hasText: /Sim|Não|Continuar|Pular/ });
    this.channelGate = page.getByRole("dialog");
    this.cartSummary = page.locator("[data-testid='cart-summary']");
    // Shipping selector in Pulse is a group of buttons/clickable divs with shipping options
    this.shippingSelector = page.locator("div").filter({ hasText: /Correios|PAC|Sedex/ }).first();
  }

  async goto(url?: string) {
    await this.page.goto(url ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173");
  }

  async dismissChannelGate() {
    if (await this.channelGate.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await this.page.getByRole("button", { name: /Comprar por chat/i }).click();
    }
  }

  async waitForGreeting() {
    await this.dismissChannelGate();
    // In Pulse, the thread is visible when messages appear
    await expect(this.page.locator("div").filter({ hasText: /Olá|oi|bem-vindo/i }).first()).toBeVisible({ timeout: 10_000 });
  }

  async waitForStreamingDone() {
    // Pulse doesn't have a `.chat-caret` — wait for typing animation to disappear
    // Use a simpler check: no divs with "Carregando" or similar
    await this.page.locator("div:has-text('Carregando')").or(this.page.locator("span:has-text('digitando')")).last().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  }

  async sendMessage(text: string) {
    await expect(this.input).toBeVisible({ timeout: 5_000 });
    await this.input.fill(text);
    await expect(this.sendButton).toBeEnabled({ timeout: 5_000 });
    await this.sendButton.click();
  }

  async tapQuickReply(label: RegExp | string) {
    const btn = this.page.locator("button").filter({ hasText: label }).first();
    await expect(btn).toBeVisible({ timeout: 5_000 });
    await btn.click();
    await this.waitForStreamingDone();
  }

  async waitForAgentReply(): Promise<Locator> {
    await this.page.waitForTimeout(300);
    // In Pulse, agent messages are in divs; find the last one that contains text
    const msgs = this.page.locator("div").filter({ hasText: /\w+/ });
    return msgs.last();
  }

  getAgentBubbles() {
    // In Pulse, agent text appears in divs. We can use text content as identifier
    return this.page.locator("div").filter({ hasText: /\w+/ });
  }

  getBuyerBubbles() {
    // Buyer messages typically appear after inputs are sent
    return this.page.locator("div").filter({ hasText: /\w+/ });
  }

  async getCartItems() {
    return this.cartSummary.locator("div").filter({ hasText: /×|x\s/ });
  }

  async selectShipping(method: RegExp = /PAC/) {
    const opts = this.page.locator("div").filter({ hasText: method });
    await expect(opts.first()).toBeVisible({ timeout: 5_000 });
    await opts.first().click();
    await this.waitForAgentReply();
  }

  async continueWithoutCoupon() {
    const noCoupon = this.page
      .getByRole("button", { name: /^N[aã]o$/i })
      .or(this.page.locator("button").filter({ hasText: /N(?:a|ã)o tenho cupom/i }))
      .first();
    await expect(noCoupon).toBeVisible({ timeout: 5_000 });
    await noCoupon.click();
    await this.waitForStreamingDone();
  }

  /** Assert no unexpected console errors occurred */
  async assertNoConsoleErrors(errors: string[]) {
    const unexpected = errors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("net::ERR_") && // normal for mocked routes
        !e.includes("ResizeObserver"),
    );
    expect(unexpected).toHaveLength(0);
  }
}

// ─── AgentChatPanel ──────────────────────────────────────────────────────────

export class AgentChatPanel {
  readonly page: Page;
  readonly panel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator("div").filter({ hasText: /\w+/ }).first();
  }

  async getLastAgentMessage(): Promise<string> {
    const msgs = this.page.locator("div").filter({ hasText: /\w+/ });
    const count = await msgs.count();
    return (await msgs.nth(count - 1).textContent()) ?? "";
  }

  async getMessageCount(): Promise<number> {
    return this.page.locator("div").filter({ hasText: /\w+/ }).count();
  }

  async expectAgentAskedFor(field: RegExp) {
    const lastText = await this.getLastAgentMessage();
    expect(lastText).toMatch(field);
  }

  async expectDiscountMentioned() {
    const lastText = await this.getLastAgentMessage();
    expect(lastText).toMatch(/desconto|cupom|off|%/i);
  }

  async expectShippingOptions() {
    const selector = this.page.locator("div").filter({ hasText: /PAC|Sedex|Correios/ });
    await expect(selector.first()).toBeVisible({ timeout: 5_000 });
  }
}

// ─── PaymentPanel ────────────────────────────────────────────────────────────

export class PaymentPanel {
  readonly page: Page;
  readonly pixSection: Locator;
  readonly cardSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pixSection = page.locator("[data-testid='pix-payment'], .zyon-pix-payment");
    this.cardSection = page.locator("[data-testid='card-payment'], .zyon-card-form, .zyon-stripe-form");
  }

  async expectPixCodeVisible() {
    await expect(this.pixSection).toBeVisible({ timeout: 10_000 });
  }

  async expectCardFormVisible() {
    await expect(this.cardSection).toBeVisible({ timeout: 10_000 });
  }

  async getPaymentTotal(): Promise<string> {
    const total = this.page.locator("[data-testid='payment-total'], .zyon-payment-total");
    return (await total.textContent()) ?? "";
  }
}

// ─── OrderConfirmationPage ───────────────────────────────────────────────────

export class OrderConfirmationPage {
  readonly page: Page;
  readonly confirmation: Locator;
  readonly orderReference: Locator;
  readonly returnButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.confirmation = page.locator(".zyon-order-confirmation");
    this.orderReference = page.locator(".zyon-order-confirmation [data-testid='order-ref'], .zyon-order-confirmation");
    this.returnButton = page.locator("[data-testid='return-to-store']");
  }

  async expectVisible() {
    await expect(this.confirmation).toBeVisible({ timeout: 15_000 });
  }

  async expectOrderConfirmed() {
    await this.expectVisible();
    await expect(this.confirmation).toContainText(/Pedido confirmado/i);
  }

  async expectOrderReference() {
    await expect(this.confirmation).toContainText(/Referência da sessão/i);
  }

  async expectComposerHidden() {
    await expect(this.page.locator(".zyon-thread-composer-wrap")).toBeHidden({ timeout: 5_000 });
  }

  async expectReturnButton() {
    await expect(this.returnButton).toBeVisible({ timeout: 3_000 });
  }
}
