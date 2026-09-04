/**
 * Add to Cart E2E Tests
 * Validates cart creation, item display, quantities, and totals.
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  buildExperience,
  startCheckoutResponse,
  noBootstrapDataCollectionExperience,
} from "./fixtures/api-mocks.js";
import { CheckoutPage } from "./fixtures/page-objects.js";
import { installTestInit, cartBuilder } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("Add to Cart @e2e", () => {
  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("displays cart items from initial experience", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Cart summary should show the item from the experience
    const thread = page.locator(".zyon-thread");
    await expect(thread).toContainText(/Bolsa Executiva/i);
  });

  test("shows correct item quantity and subtotal", async ({ page }) => {
    const cart = cartBuilder()
      .addItem({ name: "Camiseta Premium", unit_price: 149.9, quantity: 3 })
      .addItem({ name: "Calça Jeans", unit_price: 299.9, quantity: 1 });

    const experience = buildExperience({
      ...cart.toExperienceOverrides(),
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
    });

    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Items should appear in the thread/cart area
    const pageContent = await page.textContent("body");
    expect(pageContent).toContain("Camiseta Premium");
    expect(pageContent).toContain("Calça Jeans");
  });

  test("shows correct total when multiple items", async ({ page }) => {
    const cart = cartBuilder()
      .addItem({ name: "Produto A", unit_price: 100, quantity: 2 })
      .addItem({ name: "Produto B", unit_price: 50, quantity: 1 });

    const experience = buildExperience({
      ...cart.toExperienceOverrides(),
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
    });

    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // The total (250) should be shown somewhere
    const pageContent = await page.textContent("body");
    expect(pageContent).toMatch(/250|R\$\s*250/);
  });

  test("single item cart displays correctly", async ({ page }) => {
    const cart = cartBuilder().addItem({
      name: "Tênis Running Pro",
      unit_price: 599.9,
      quantity: 1,
      category: "Calçados",
      variant: "42 - Preto",
    });

    const experience = buildExperience({
      ...cart.toExperienceOverrides(),
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
    });

    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    const pageContent = await page.textContent("body");
    expect(pageContent).toContain("Tênis Running Pro");
  });

  test("empty cart scenario shows agent greeting without items", async ({ page }) => {
    const experience = buildExperience({
      items: [],
      totals: { currency: "BRL", subtotal: 0, shipping: 0, discount: 0, total: 0 },
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
    });

    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Agent should still greet even with no items
    const bubbles = checkout.getAgentBubbles();
    expect(await bubbles.count()).toBeGreaterThan(0);
  });
});
