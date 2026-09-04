/**
 * Cross-sell configuration E2E tests for widget_v2.
 *
 * Tests ALL cross-sell scenarios:
 * - Config enabled/disabled
 * - pre_payment touchpoint on/off
 * - Chat response cross-sell
 * - Max suggestions limit
 * - Product click → sendMessage
 * - No products → no block rendered
 */
import { test, expect } from "@playwright/test";
import {
  setupCrossSellMocks,
  navigateToCheckout,
  selectChatChannel,
  CROSS_SELL_PRODUCTS,
  type MockProduct,
} from "./fixtures/cross-sell-mocks.js";

// ─── Helper ─────────────────────────────────────────────────────────────────

async function waitForActiveCheckout(page: import("@playwright/test").Page) {
  // selectChatChannel already waits for the welcome message to render.
  await selectChatChannel(page);
}

// ─── Test 1: Cross-sell disabled → no block ─────────────────────────────────

test("cross-sell disabled: no cross-sell block rendered", async ({ page }) => {
  await setupCrossSellMocks(page, {
    // No startProducts → simulates config.enabled = false (API returns nothing)
    startProducts: undefined,
    chatProducts: undefined,
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Should NOT see the cross-sell header
  await expect(page.locator("text=Você também pode gostar")).not.toBeVisible();
});

// ─── Test 2: pre_payment enabled, products in start response ─────────────────

test("pre_payment enabled: cross-sell block appears after welcome", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: CROSS_SELL_PRODUCTS.slice(0, 2),
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Cross-sell block should be visible
  await expect(page.locator("text=Você também pode gostar")).toBeVisible({ timeout: 5_000 });

  // Both products shown
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
  await expect(page.locator("text=Boné Developer")).toBeVisible();

  // Prices formatted correctly (BRL) — scoped to the cross-sell block
  const crossSellBlock = page.locator("div", { has: page.locator("text=Você também pode gostar") }).first();
  await expect(crossSellBlock.locator("text=/R\\$\\s*199/")).toBeVisible();
  await expect(crossSellBlock.locator("text=/R\\$\\s*59/")).toBeVisible();
});

// ─── Test 3: pre_payment disabled → no cross-sell at start ───────────────────

test("pre_payment disabled: no cross-sell at checkout start", async ({ page }) => {
  // API returns empty suggestedProducts (simulates pre_payment touchpoint OFF)
  await setupCrossSellMocks(page, {
    startProducts: [],
    chatProducts: undefined,
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  await expect(page.locator("text=Você também pode gostar")).not.toBeVisible();
});

// ─── Test 4: Cross-sell from chat response ───────────────────────────────────

test("chat response with cross-sell: block appears in agent message", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: undefined, // No cross-sell at start
    chatProducts: [
      { sku: "MUG-001", name: "Caneca TypeScript", unit_price: 39.9 },
    ],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // No cross-sell at start
  await expect(page.locator("text=Você também pode gostar")).not.toBeVisible();

  // Send a message to trigger chat response
  const input = page.locator("input, textarea").first();
  await input.fill("Quero pagar com PIX");
  await input.press("Enter");

  // Wait for agent response with cross-sell
  await expect(page.locator("text=Você também pode gostar")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("text=Caneca TypeScript")).toBeVisible();
});

// ─── Test 5: Max suggestions respected (API limits at server, widget renders all received) ──

test("max suggestions: renders only products received from API", async ({ page }) => {
  // Simulate maxSuggestionsPerSession = 1 (API sends only 1 product)
  await setupCrossSellMocks(page, {
    startProducts: [CROSS_SELL_PRODUCTS[0]],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  await expect(page.locator("text=Você também pode gostar")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
  // Should NOT see the second product
  await expect(page.locator("text=Boné Developer")).not.toBeVisible();
});

// ─── Test 6: Display mode inline renders in chat thread ──────────────────────

test("display mode inline: renders inline block in chat thread", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [{ ...CROSS_SELL_PRODUCTS[0], display_mode: "inline" }],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Inline variant present, modal/banner absent
  await expect(page.locator("[data-testid='cross-sell-inline']")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("[data-testid='cross-sell-modal']")).not.toBeVisible();
  await expect(page.locator("[data-testid='cross-sell-banner']")).not.toBeVisible();
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
});

// ─── Test 6b: Display mode MODAL ─────────────────────────────────────────────

test("display mode modal: renders overlay dialog, dismissable", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [{ ...CROSS_SELL_PRODUCTS[0], display_mode: "modal" }],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Modal dialog present
  const modal = page.locator("[data-testid='cross-sell-modal']");
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();

  // Dismiss closes it
  await page.locator("[data-testid='cross-sell-dismiss']").first().click();
  await expect(modal).not.toBeVisible();
});

// ─── Test 6c: Display mode BANNER ────────────────────────────────────────────

test("display mode banner: renders sticky banner strip, dismissable", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [{ ...CROSS_SELL_PRODUCTS[0], display_mode: "banner" }],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  const banner = page.locator("[data-testid='cross-sell-banner']");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("[data-testid='cross-sell-modal']")).not.toBeVisible();
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();

  // Dismiss closes it
  await page.locator("[data-testid='cross-sell-dismiss']").first().click();
  await expect(banner).not.toBeVisible();
});

// ─── Test 7: Product click sends message ─────────────────────────────────────

test("product click sends 'Adicionar' message", async ({ page }) => {
  let chatRequestBody: string | null = null;

  await setupCrossSellMocks(page, {
    startProducts: [CROSS_SELL_PRODUCTS[0]],
  });

  // Capture the chat request when product is clicked
  await page.route("**/embed/chat", async (route) => {
    const req = route.request();
    chatRequestBody = await req.postData();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Adicionado ao carrinho!",
        blocks: [],
        quick_replies: [],
      }),
    });
  });

  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  await expect(page.locator("text=Hoodie Agentic")).toBeVisible({ timeout: 5_000 });

  // Click the product button
  await page.locator("button:has-text('Hoodie Agentic')").click();

  // Wait for the chat request to be sent
  await page.waitForTimeout(1_000);

  // Verify the message sent contains the product name
  expect(chatRequestBody).toBeTruthy();
  const parsed = JSON.parse(chatRequestBody!);
  expect(parsed.user_message).toContain("Adicionar Hoodie Agentic");
});

// ─── Test 8: Empty suggestedProducts → no block ─────────────────────────────

test("empty suggestedProducts array: no cross-sell block", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [],
    chatProducts: [],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Send a chat message too
  const input = page.locator("input, textarea").first();
  if (await input.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await input.fill("Vamos prosseguir");
    await input.press("Enter");
    await page.waitForTimeout(2_000);
  }

  // No cross-sell anywhere
  await expect(page.locator("text=Você também pode gostar")).not.toBeVisible();
});

// ─── Test 9: Multiple products display correctly ─────────────────────────────

test("3 products: all rendered with name and price", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: CROSS_SELL_PRODUCTS, // 3 products
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  await expect(page.locator("text=Você também pode gostar")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
  await expect(page.locator("text=Boné Developer")).toBeVisible();
  await expect(page.locator("text=Sticker Pack")).toBeVisible();
});

// ─── Test 10: Cross-sell on start AND chat (double display) ──────────────────

test("cross-sell on start + chat: both blocks render", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [CROSS_SELL_PRODUCTS[0]], // Hoodie at start
    chatProducts: [CROSS_SELL_PRODUCTS[1]], // Boné on chat
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // First cross-sell (from start)
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible({ timeout: 5_000 });

  // Send message to get second cross-sell
  const input = page.locator("input, textarea").first();
  await input.fill("Quero finalizar");
  await input.press("Enter");

  // Second cross-sell (from chat)
  await expect(page.locator("text=Boné Developer")).toBeVisible({ timeout: 8_000 });

  // Both cross-sell headers visible (2 blocks total)
  const crossSellHeaders = page.locator("text=Você também pode gostar");
  await expect(crossSellHeaders).toHaveCount(2);
});

// ─── Test A: Narration at checkout start ─────────────────────────────────────

test("narration (a): cross-sell at checkout start shows agent text", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [CROSS_SELL_PRODUCTS[0], CROSS_SELL_PRODUCTS[1]],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // The agent must SPEAK when showing cross-sell (not just render the component silently)
  await expect(page.locator("text=separei alguns itens que combinam")).toBeVisible({ timeout: 5_000 });

  // Products are still rendered alongside the narration
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
  await expect(page.locator("text=Boné Developer")).toBeVisible();
});

test("narration (a): single product uses singular text", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: [CROSS_SELL_PRODUCTS[0]], // only 1 product
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Singular narration for 1 item
  await expect(page.locator("text=separei um item que combina")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
});

// ─── Test B: Narration on chat response ──────────────────────────────────────

test("narration (b): cross-sell on chat response has agent text when LLM message empty", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: undefined,
    chatProducts: [CROSS_SELL_PRODUCTS[0]],
    chatMessage: "", // LLM returned empty text — widget must generate narration
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  // Send message to trigger chat
  const input = page.locator("input, textarea").first();
  await input.fill("Quero ver mais opções");
  await input.press("Enter");

  // Narration fallback when LLM text is empty (uses narrateBlock for cross_sell)
  await expect(page.locator("text=Separei")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
});

test("narration (b): cross-sell on chat preserves LLM text when present", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: undefined,
    chatProducts: [CROSS_SELL_PRODUCTS[0]],
    chatMessage: "Olha essa sugestão especial pra você!", // LLM provided its own text
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  const input = page.locator("input, textarea").first();
  await input.fill("Tem algo a mais?");
  await input.press("Enter");

  // LLM text preserved (not overwritten by fallback)
  await expect(page.locator("text=Olha essa sugestão especial pra você")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("text=Hoodie Agentic")).toBeVisible();
  // Narration fallback should NOT appear (LLM text wins)
  await expect(page.locator("text=Separei alguns itens que combinam")).not.toBeVisible();
});

// ─── Test C: Universal narration for non-cross-sell blocks ───────────────────

test("narration (c): payment_methods block narrated when LLM text empty", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: undefined,
    chatMessage: "", // empty LLM text
    chatBlocks: [{ type: "payment_methods", data: { methods: [
      { key: "pix", label: "Pix", sub: "Instantâneo" },
      { key: "credito", label: "Cartão de crédito", sub: "Até 12x" },
    ] } }],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  const input = page.locator("input, textarea").first();
  await input.fill("Quero pagar");
  await input.press("Enter");

  // Payment component renders WITH narration (not silent)
  await expect(page.locator("text=Como você prefere pagar?")).toBeVisible({ timeout: 8_000 });
});

test("narration (c): shipping_options block narrated when LLM text empty", async ({ page }) => {
  await setupCrossSellMocks(page, {
    startProducts: undefined,
    chatMessage: "",
    chatBlocks: [{ type: "shipping_options", data: { options: [
      { key: "sedex", label: "correios_sedex", cost: 1990 },
    ] } }],
  });
  await navigateToCheckout(page);
  await waitForActiveCheckout(page);

  const input = page.locator("input, textarea").first();
  await input.fill("Calcular frete");
  await input.press("Enter");

  await expect(page.locator("text=Escolha como prefere receber")).toBeVisible({ timeout: 8_000 });
});
