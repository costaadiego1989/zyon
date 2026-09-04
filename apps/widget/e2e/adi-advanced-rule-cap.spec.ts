/**
 * Advanced Rule Cap E2E Tests
 * Validates the rules-engine hard-cap invariant for a category-scoped
 * advanced discount rule (electronics, 30% off, capped at R$16):
 *   (1) cart electronics >= R$300  -> 30% would be > R$16, offer is CAPPED to R$16.
 *   (2) cart electronics = R$40     -> 30% = R$12 (< cap), full R$12 is applied.
 *
 * Offers are simulated via api-mocks.js: the authorized_offer returned by the
 * API already reflects the rules-engine decision, and the experience totals
 * reflect the capped/uncapped discount. No live service is required.
 */
import { test, expect } from "@playwright/test";
import {
  buildExperience,
  chatResponse,
  startCheckoutResponse,
  type CheckoutExperienceSnapshot,
} from "./fixtures/api-mocks.js";
import { CheckoutPage } from "./fixtures/page-objects.js";
import { installTestInit } from "./fixtures/session-fixture.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

// A registered buyer so the scripted chat sequence is not consumed by an
// auto-registration bootstrap (mirrors REGISTERED_CUSTOMER in api-mocks).
const REGISTERED_CUSTOMER = {
  email: "buyer@e2e.test",
  email_verified: true,
  fullName: "João Silva",
  cpf: "12345678900",
  phone: "11988887777",
  phone_verified: true,
};

/** Build an electronics-only cart experience at the payment stage. */
function electronicsExperience(opts: {
  unitPrice: number;
  discount: number;
  quantity?: number;
}): CheckoutExperienceSnapshot {
  const quantity = opts.quantity ?? 1;
  const lineTotal = opts.unitPrice * quantity;
  const shippingCost = 19.9;
  return buildExperience({
    stage: "payment",
    customer: REGISTERED_CUSTOMER,
    items: [
      {
        sku: "elec-001",
        name: "Fone de Ouvido Bluetooth",
        quantity,
        unit_price: opts.unitPrice,
        line_total: lineTotal,
        image_url: "https://images.unsplash.com/photo-headphones?w=640",
        product_url: "https://loja.example.com/fone-bluetooth",
        category: "Eletrônicos",
        variant: "Preto",
      },
    ],
    totals: {
      currency: "BRL",
      subtotal: lineTotal,
      shipping: shippingCost,
      discount: opts.discount,
      total: lineTotal + shippingCost - opts.discount,
    },
    shipping: { customerPrice: shippingCost, carrier: "Correios", method: "PAC", deliveryDays: 7, region: "SP" },
    copy: {
      headline: "Checkout assistido por IA",
      subheadline: "Finalize sua compra com ajuda da Clara.",
      trust_badges: ["Pagamento seguro"],
      quick_replies: ["Cartão de crédito", "PIX"],
    },
  });
}

/** Wire chat + start routes to return a single controlled offer response. */
async function routeOfferResponse(
  page: import("@playwright/test").Page,
  opts: { start: CheckoutExperienceSnapshot; offer: ReturnType<typeof chatResponse> },
) {
  const startBody = JSON.stringify(startCheckoutResponse(opts.start));
  const offerBody = JSON.stringify(opts.offer);

  await page.route("**/start-checkout", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: startBody }),
  );
  await page.route("**/embed/start", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: startBody }),
  );
  await page.route("**/chat/message", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: offerBody }),
  );
  await page.route("**/embed/chat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: offerBody }),
  );
  await page.route("**/track-event", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ received: true }) }),
  );
  await page.route("**/embed/track", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ received: true }) }),
  );
}

test.describe("Advanced Rule Cap @e2e", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await installTestInit(page);
  });

  test("electronics >= R$300: 30% offer is capped at R$16 (not full 30%)", async ({ page }) => {
    // Cart: 1x electronics @ R$400. A 30% discount would be R$120, but the
    // advanced rule hard-caps the discount at R$16. The authorized offer and
    // the experience totals must reflect the R$16 cap.
    const CAP = 16;
    const start = electronicsExperience({ unitPrice: 400, discount: 0 });
    const cappedOffer = chatResponse({
      message: "Consegui um desconto de R$ 16,00 nos seus eletrônicos. Aplicando agora!",
      experience: electronicsExperience({ unitPrice: 400, discount: CAP }),
      stage: "payment",
      missingFields: [],
      authorizedOffer: { approved: true, discountCode: "ELETRO30", discountPercent: 30 },
    });

    await routeOfferResponse(page, { start, offer: cappedOffer });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Quero um desconto nos eletrônicos");
    await checkout.waitForAgentReply();
    await checkout.waitForStreamingDone();

    const body = (await page.textContent("body")) ?? "";

    // Discount reflected is the R$16 cap, NOT the full 30% (R$120).
    // Total = 400 + 19.90 shipping - 16 discount = 403.90
    expect(body).toMatch(/16[,.]0/); // capped discount surfaced
    expect(body).toMatch(/403[,.]9/); // capped total
    expect(body).not.toMatch(/120[,.]0/); // full 30% never applied
    expect(body).not.toMatch(/303[,.]9/); // total with full 30% never shown
  });

  test("electronics = R$40: 30% (R$12) applied fully, below the R$16 cap", async ({ page }) => {
    // Cart: 1x electronics @ R$40. 30% = R$12, which is below the R$16 cap,
    // so the full 30% discount is applied.
    const DISCOUNT = 12;
    const start = electronicsExperience({ unitPrice: 40, discount: 0 });
    const fullOffer = chatResponse({
      message: "Consegui 30% de desconto (R$ 12,00) nos seus eletrônicos!",
      experience: electronicsExperience({ unitPrice: 40, discount: DISCOUNT }),
      stage: "payment",
      missingFields: [],
      authorizedOffer: { approved: true, discountCode: "ELETRO30", discountPercent: 30 },
    });

    await routeOfferResponse(page, { start, offer: fullOffer });

    const checkout = new CheckoutPage(page);
    await checkout.goto(BASE);
    await checkout.waitForGreeting();
    await checkout.waitForStreamingDone();

    await checkout.sendMessage("Quero um desconto nos eletrônicos");
    await checkout.waitForAgentReply();
    await checkout.waitForStreamingDone();

    const body = (await page.textContent("body")) ?? "";

    // Full 30% (R$12) applied. Total = 40 + 19.90 shipping - 12 discount = 47.90
    expect(body).toMatch(/12[,.]0/); // full 30% discount surfaced
    expect(body).toMatch(/47[,.]9/); // total with full discount
  });
});
