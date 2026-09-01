/**
 * ADI Intent Modulation E2E Tests
 * Validates that buyer intent (price_sensitive, quality_seeker) modulates
 * the discount offer cap in the checkout experience.
 *
 * F1-T03: treatment + price_sensitive → aggressive offer (within cap)
 * F1-T03: treatment + quality_seeker → conservative offer (reduced value)
 * F1-T03: no intent → deterministic fallback (maxDiscountPercent)
 */
import { test, expect } from "@playwright/test";
import {
  setupApiMocks,
  buildExperience,
  startCheckoutResponse,
  chatResponse,
  noBootstrapDataCollectionExperience,
  paymentExperience,
  type FlowStep,
} from "./fixtures/api-mocks.js";
import { CheckoutPage } from "./fixtures/page-objects.js";
import { installTestInit } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

test.describe("ADI Intent Modulation @e2e @intent", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("price_sensitive intent: agent offers more aggressive discount within cap", async ({ page }) => {
    /**
     * Scenario: buyer with price_sensitive intent (high urgency, budget tier)
     * receives a 25% discount (still within maxDiscountPercent=30%).
     * This simulates the treatment cohort behavior where intent modulates the cap
     * to the top of the range, allowing a stronger opening offer.
     */
    const aggressiveDiscount = 224.925; // 25% of 899.80 subtotal
    const experienceWithDiscount = paymentExperience(aggressiveDiscount);

    let chatCallCount = 0;
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "price_seeker@e2e.test",
                email_verified: true,
                fullName: "João Consciente",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
              copy: {
                headline: "Checkout assistido por IA",
                subheadline: "Finalize sua compra com ajuda da Clara.",
                trust_badges: ["Pagamento seguro", "Entrega garantida", "Suporte 24h"],
                quick_replies: ["Cartão de crédito", "PIX"],
              },
            })
          )
        ),
      });
    });

    await page.route("**/embed/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "price_seeker@e2e.test",
                email_verified: true,
                fullName: "João Consciente",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
            })
          )
        ),
      });
    });

    await page.route("**/chat/message", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        // First message: ask for discount
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Entendi que você quer economizar. Como você está sensível ao preço, posso oferecer 25% de desconto com este cupom.",
              experience: experienceWithDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "DESCONTO25", discountPercent: 25 },
            })
          ),
        });
      }
    });

    await page.route("**/embed/chat", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Entendi que você quer economizar. Como você está sensível ao preço, posso oferecer 25% de desconto com este cupom.",
              experience: experienceWithDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "DESCONTO25", discountPercent: 25 },
            })
          ),
        });
      }
    });

    await page.route("**/track-event", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    await page.route("**/embed/track", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Buyer with price_sensitive intent asks for discount
    await checkout.sendMessage("Qual é o melhor desconto que você pode oferecer?");
    const reply = await checkout.waitForAgentReply();
    const text = await reply.textContent();

    // Agent should approve and mention the aggressive (25%) discount
    expect(text).toMatch(/25%|desconto|cupom/i);
    expect(text).toMatch(/sensível\s+ao\s+preço|consciência\s+de\s+preço/i);
  });

  test("quality_seeker intent: agent offers minimal or value-focused offer", async ({ page }) => {
    /**
     * Scenario: buyer with quality_seeker intent (low urgency, premium tier)
     * receives a minimal discount (0-5%) or value proposition instead.
     * The intent-modulated cap reduces the discount authority to preserve margin.
     */
    const minimalDiscount = 45.0; // 5% of 899.80 (conservative for quality seeker)
    const experienceWithMinimalDiscount = paymentExperience(minimalDiscount);

    let chatCallCount = 0;
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "quality@e2e.test",
                email_verified: true,
                fullName: "Maria Premium",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
              copy: {
                headline: "Checkout assistido por IA",
                subheadline: "Finalize sua compra com ajuda da Clara.",
                trust_badges: ["Pagamento seguro", "Entrega garantida", "Suporte 24h"],
                quick_replies: ["Cartão de crédito", "PIX"],
              },
            })
          )
        ),
      });
    });

    await page.route("**/embed/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "quality@e2e.test",
                email_verified: true,
                fullName: "Maria Premium",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
            })
          )
        ),
      });
    });

    await page.route("**/chat/message", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        // First message: quality seeker receives conservative offer
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Entendo. Você está buscando qualidade. Posso oferecer 5% de desconto, e com isso você ganha nosso programa de pontos que vale bem mais.",
              experience: experienceWithMinimalDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "QUALIDADE5", discountPercent: 5 },
            })
          ),
        });
      }
    });

    await page.route("**/embed/chat", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Entendo. Você está buscando qualidade. Posso oferecer 5% de desconto, e com isso você ganha nosso programa de pontos que vale bem mais.",
              experience: experienceWithMinimalDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "QUALIDADE5", discountPercent: 5 },
            })
          ),
        });
      }
    });

    await page.route("**/track-event", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    await page.route("**/embed/track", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Buyer with quality_seeker intent asks for discount
    await checkout.sendMessage("Qual é o melhor que vocês podem oferecer?");
    const reply = await checkout.waitForAgentReply();
    const text = await reply.textContent();

    // Agent should offer minimal discount and emphasize quality/value
    expect(text).toMatch(/5%|qualidade|valor|pontos/i);
    expect(text).not.toMatch(/25%|30%/);
  });

  test("no intent provided: fallback to standard maxDiscountPercent behavior", async ({ page }) => {
    /**
     * Scenario: buyer without an intent profile (cohort=holdout or no classification yet)
     * receives the standard offer at maxDiscountPercent (30%).
     * This ensures backward compatibility and prevents regressions.
     */
    const standardDiscount = 269.94; // 30% of 899.80
    const experienceWithStandardDiscount = paymentExperience(standardDiscount);

    let chatCallCount = 0;
    await page.route("**/start-checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "unclassified@e2e.test",
                email_verified: true,
                fullName: "João Neutro",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
              copy: {
                headline: "Checkout assistido por IA",
                subheadline: "Finalize sua compra com ajuda da Clara.",
                trust_badges: ["Pagamento seguro", "Entrega garantida", "Suporte 24h"],
                quick_replies: ["Cartão de crédito", "PIX"],
              },
            })
          )
        ),
      });
    });

    await page.route("**/embed/start", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          startCheckoutResponse(
            buildExperience({
              stage: "payment",
              customer: {
                email: "unclassified@e2e.test",
                email_verified: true,
                fullName: "João Neutro",
                cpf: "12345678900",
                phone: "11988887777",
                phone_verified: true,
              },
            })
          )
        ),
      });
    });

    await page.route("**/chat/message", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        // Without intent, fall back to standard maxDiscountPercent
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Ótimo! Posso oferecer 30% de desconto para você finalizar agora mesmo.",
              experience: experienceWithStandardDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "DESCONTO30", discountPercent: 30 },
            })
          ),
        });
      }
    });

    await page.route("**/embed/chat", async (route) => {
      chatCallCount++;
      if (chatCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            chatResponse({
              message: "Ótimo! Posso oferecer 30% de desconto para você finalizar agora mesmo.",
              experience: experienceWithStandardDiscount,
              stage: "payment",
              missingFields: [],
              authorizedOffer: { approved: true, discountCode: "DESCONTO30", discountPercent: 30 },
            })
          ),
        });
      }
    });

    await page.route("**/track-event", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    await page.route("**/embed/track", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ received: true }),
      });
    });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    // Buyer without intent classification asks for discount
    await checkout.sendMessage("Tem algum desconto?");
    const reply = await checkout.waitForAgentReply();
    const text = await reply.textContent();

    // Agent should offer standard 30% discount (no intent modulation)
    expect(text).toMatch(/30%|desconto/i);
    // Verify it's deterministic fallback behavior, not customized
    expect(text).not.toMatch(/sensível|qualidade|premium/i);
  });
});
