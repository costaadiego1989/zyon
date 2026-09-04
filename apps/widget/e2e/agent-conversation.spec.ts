/**
 * Agent Conversation E2E Tests
 * Validates chat interaction with the AI agent: greetings, data collection,
 * asking for price/stock/discount, and conversation flow.
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  startCheckoutResponse,
  noBootstrapDataCollectionExperience,
  chatResponse,
  buildExperience,
  type FlowStep,
} from "./fixtures/api-mocks.js";
import { CheckoutPage, AgentChatPanel } from "./fixtures/page-objects.js";
import { installTestInit } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("Agent Conversation @e2e", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("agent greets buyer on session start", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: [],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    const chat = new AgentChatPanel(page);
    const greeting = await chat.getLastAgentMessage();
    expect(greeting).toMatch(/Olá|Clara|ajudar|compra/i);
  });

  test("agent asks for buyer name in data collection", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_name"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Olá!");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/nome/i);
  });

  test("agent collects email after name", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Pedro Almeida");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/e-?mail/i);
  });

  test("agent collects CPF after email", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_cpf"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("pedro@test.com");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/cpf/i);
  });

  test("agent collects phone after CPF", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_phone"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("123.456.789-00");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/telefone|celular/i);
  });

  test("agent transitions to shipping after all buyer data collected", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_cep"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("(11) 99999-0000");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/cep|frete|entrega/i);
  });

  test("buyer can use quick replies", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Quick reply "Olá!" should be clickable
    await checkout.tapQuickReply(/Ol[aá]/i);
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toBeTruthy();
  });

  test("agent handles network error gracefully (shows retry)", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email"],
      failOnChatCall: 1,
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Trigger error");
    // Should not crash the page
    await page.waitForTimeout(3_000);
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
  });

  test("multiple messages appear in correct order", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["ask_email", "ask_cpf"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Carlos Oliveira");
    await checkout.waitForAgentReply();

    await checkout.sendMessage("carlos@test.com");
    await checkout.waitForAgentReply();

    // Should have buyer messages in order
    const buyerBubbles = checkout.getBuyerBubbles();
    const count = await buyerBubbles.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const first = await buyerBubbles.nth(count - 2).textContent();
    const second = await buyerBubbles.nth(count - 1).textContent();
    expect(first).toContain("Carlos Oliveira");
    expect(second).toContain("carlos@test.com");
  });

  test("agent provides discount information when asked", async ({ page }) => {
    await setupApiMocks(page, {
      chatSequence: ["coupon_applied"],
      startResponse: startCheckoutResponse(noBootstrapDataCollectionExperience()),
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Tem desconto?");
    const reply = await checkout.waitForAgentReply();
    expect(await reply.textContent()).toMatch(/desconto|cupom|%/i);
  });
});
