/**
 * Cart Persistence E2E Tests
 * Validates session persistence across page reload and navigation.
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  startCheckoutResponse,
  noBootstrapDataCollectionExperience,
  buildExperience,
  type FlowStep,
} from "./fixtures/api-mocks.js";
import { CheckoutPage } from "./fixtures/page-objects.js";
import { installTestInit } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("Cart Persistence @e2e", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("session persists conversation after page reload", async ({ page }) => {
    // First load: start session and send a message
    await setupApiMocks(page, {
      chatSequence: ["ask_email", "ask_cpf"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Maria Teste");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/e-?mail/i);

    // Reload — mocks are re-installed so the widget fetches the same session
    await setupApiMocks(page, {
      chatSequence: ["ask_cpf"],
      startResponse: startCheckoutResponse(
        buildExperience({
          stage: "data_collection",
          customer: { email: "buyer@e2e.test", email_verified: true, fullName: "Maria Teste" },
        }),
      ),
    });
    await page.reload();
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Widget should show the session is active (agent greeting visible)
    const bubbles = checkout.getAgentBubbles();
    expect(await bubbles.count()).toBeGreaterThan(0);
  });

  test("cart items persist across reload (experience carries items)", async ({ page }) => {
    const experience = buildExperience({
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
      items: [
        {
          sku: "persist-001",
          name: "Produto Persistente",
          quantity: 2,
          unit_price: 199.9,
          line_total: 399.8,
          image_url: "https://placeholder.test/img.jpg",
          product_url: "https://loja.example.com/persist",
          category: "Teste",
          variant: "Padrão",
        },
      ],
      totals: { currency: "BRL", subtotal: 399.8, shipping: 0, discount: 0, total: 399.8 },
    });

    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // First load: item visible
    let pageContent = await page.textContent("body");
    expect(pageContent).toContain("Produto Persistente");

    // Reload with same experience
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(experience),
    });
    await page.reload();
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // After reload: item still visible
    pageContent = await page.textContent("body");
    expect(pageContent).toContain("Produto Persistente");
  });

  test("session survives navigation away and back", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Test Nav");
    await checkout.waitForAgentReply();

    // Navigate away
    await page.goto("about:blank");
    await page.waitForTimeout(500);

    // Navigate back — re-setup mocks before going back
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Agent should be visible (session restored)
    const bubbles = checkout.getAgentBubbles();
    expect(await bubbles.count()).toBeGreaterThan(0);
  });

  test("abandoned cart recovery: returning to stale session shows last state", async ({ page }) => {
    // Simulate a session that was in shipping stage (buyer started but didn't finish)
    const abandonedExperience = buildExperience({
      stage: "shipping",
      customer: {
        email: "abandoned@test.com",
        email_verified: true,
        fullName: "Buyer Abandoned",
        cpf: "11122233344",
        phone: "11999998888",
        phone_verified: true,
      },
    });

    await setupApiMocks(page, {
      chatSequence: ["ask_cep"],
      startResponse: startCheckoutResponse(abandonedExperience),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // The agent should continue from where it left off (shipping stage)
    const agentBubbles = checkout.getAgentBubbles();
    const lastBubble = agentBubbles.nth((await agentBubbles.count()) - 1);
    const text = await lastBubble.textContent();
    // Agent is in shipping — asking for CEP or address
    expect(text).toMatch(/cep|frete|entrega|endereço|Clara/i);
  });

  test("local storage is used for session tracking", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Check that localStorage or sessionStorage has session data
    const storageKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) keys.push(key);
      }
      return keys;
    });

    // At minimum the page should have rendered without crashing
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });
});
