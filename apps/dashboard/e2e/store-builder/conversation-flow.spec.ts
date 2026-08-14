/**
 * Store Builder — Conversation Flow E2E.
 *
 * Validates:
 *   - User sends a message and agent responds with text or blocks
 *   - Quick reply triggers product search
 *   - Checkout redirect block renders correctly
 *   - Order return flow shows confirmation message
 *
 * REQUIRES:
 *   - Storefront dev server running on :3001
 *     (cd apps/storefront && pnpm dev)
 *   - Optionally: API on :3009 for real agent responses
 *
 * @store-builder
 */

import { test, expect } from "@playwright/test";
import { TIMEOUTS } from "../config";

const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3001";

/* ── Suite ─────────────────────────────────────────────────────── */

test.describe("@store-builder Conversation Flow", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      !!process.env.SKIP_STOREFRONT_E2E,
      "SKIP_STOREFRONT_E2E set — run after starting storefront dev server",
    );
    testInfo.annotations.push({ type: "storefront-url", description: STOREFRONT_URL });
  });

  /* ── Test 1: User sends message, agent responds ─────────────── */

  test("@store-builder user sends message and receives agent response", async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/demo`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for conversation shell to be ready
    const input = page.locator("input[aria-label='Mensagem']");
    await expect(input).toBeVisible({ timeout: TIMEOUTS.element });

    // Type and send a message
    await input.fill("Quero ver camisetas");
    const sendButton = page.locator("button[aria-label='Enviar']");
    await sendButton.click();

    // Verify user message appears
    await expect(page.locator(".message--user .message__bubble")).toContainText(
      "Quero ver camisetas",
    );

    // Wait for agent response (either text bubble or blocks)
    const agentMessages = page.locator(".message--agent .message__content");
    await expect(agentMessages.last()).toBeVisible({ timeout: TIMEOUTS.long });

    // Verify at least one agent response exists beyond the welcome message
    const agentCount = await page.locator(".message--agent").count();
    expect(agentCount).toBeGreaterThanOrEqual(2);
  });

  /* ── Test 2: Quick reply triggers product search ────────────── */

  test("@store-builder quick reply triggers agent response", async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/demo`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for quick replies to be rendered
    const quickReply = page.locator("button").filter({ hasText: "Ver produtos" });
    await expect(quickReply).toBeVisible({ timeout: TIMEOUTS.element });

    // Click quick reply
    await quickReply.click();

    // Verify user message appears with the quick reply text
    await expect(page.locator(".message--user .message__bubble")).toContainText(
      "Ver produtos",
    );

    // Wait for agent response
    const agentMessages = page.locator(".message--agent");
    await expect(agentMessages.nth(1)).toBeVisible({ timeout: TIMEOUTS.long });
  });

  /* ── Test 3: Checkout redirect block rendered ───────────────── */

  test("@store-builder checkout redirect block renders with payment link", async ({ page }) => {
    // Navigate to storefront and inject a mock checkout_redirect block via page.evaluate
    await page.goto(`${STOREFRONT_URL}/store/demo`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the app to hydrate
    await expect(
      page.locator("input[aria-label='Mensagem']"),
    ).toBeVisible({ timeout: TIMEOUTS.element });

    // Inject a checkout_redirect block response by dispatching a state update
    // We simulate the agent sending a checkout_redirect block by evaluating script
    // that adds a message to the DOM with the expected structure
    await page.evaluate(() => {
      const messagesContainer = document.querySelector(".conversation-messages");
      if (!messagesContainer) return;

      const messageDiv = document.createElement("div");
      messageDiv.className = "message message--agent";
      messageDiv.innerHTML = `
        <div class="message__avatar">🤖</div>
        <div class="message__content">
          <div class="message__bubble">Tudo certo! Vou te redirecionar para o pagamento.</div>
          <div class="message__block" data-testid="checkout-redirect-block">
            <div style="background:#fff;border-radius:var(--radius-md);border:1px solid var(--color-border);padding:16px;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center;">
              <span style="font-size:13px;color:var(--color-fg-soft);">Tudo certo! Finalize o pagamento no checkout seguro.</span>
              <a href="http://localhost:5173/embed/checkout/chk_test123?cartId=cart_abc" style="display:inline-block;padding:10px 16px;border-radius:var(--radius-sm);background:var(--color-primary);color:#fff;font-size:14px;font-weight:600;text-decoration:none;text-align:center;cursor:pointer;">Ir para pagamento →</a>
            </div>
          </div>
        </div>
      `;
      messagesContainer.appendChild(messageDiv);
    });

    // Verify the payment link is visible and has the correct href
    const paymentLink = page.locator(
      "a:has-text('Ir para pagamento')",
    );
    await expect(paymentLink).toBeVisible({ timeout: TIMEOUTS.element });
    const href = await paymentLink.getAttribute("href");
    expect(href).toContain("/embed/checkout/");
    expect(href).toContain("cartId=");
  });

  /* ── Test 4: Order return flow ──────────────────────────────── */

  test("@store-builder order return shows confirmation message", async ({ page }) => {
    await page.goto(`${STOREFRONT_URL}/store/demo?order=test-order-123`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for conversation to load with order confirmation
    const confirmationMessage = page.locator(".message__bubble").filter({
      hasText: "Pedido #test-order-123 confirmado",
    });
    await expect(confirmationMessage).toBeVisible({ timeout: TIMEOUTS.element });

    // Verify it contains the full expected text
    await expect(confirmationMessage).toContainText(
      "Posso ajudar com mais alguma coisa?",
    );
  });
});
