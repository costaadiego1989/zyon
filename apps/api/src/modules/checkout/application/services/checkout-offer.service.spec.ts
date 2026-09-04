import test from "node:test";
import assert from "node:assert/strict";
import type {
  AuthorizedOffer,
  ChatTurn,
  DashboardOverview,
  DomainEventEnvelope
} from "@zyon/shared-types";
import type { CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import {
  checkoutSession,
  merchantRules
} from "../../__tests__/checkout-test-fixtures.js";
import { CheckoutOfferService } from "./checkout-offer.service.js";

function fakeRepo(): CheckoutRepository {
  const saved: AuthorizedOffer[] = [];
  const emptyDashboard: DashboardOverview = {
    merchant_id: "mrc_1",
    conversations_started: 0,
    offers_viewed: 0,
    offers_accepted: 0,
    orders_completed: 0,
    conversion_rate_with_agent: 0,
    average_discount: 0,
    average_shipping_subsidy: 0,
    incremental_revenue: 0,
    recent_sessions: [],
    recent_offers: []
  };
  const fakeEvent: DomainEventEnvelope = {
    event_id: "evt_1",
    event_type: "checkout.event.tracked",
    schema_version: 1,
    merchant_id: "mrc_1",
    occurred_at: "2026-01-01T00:00:00.000Z",
    correlation_id: "corr_1",
    causation_id: "cause_1",
    producer: "checkout",
    payload: {}
  };
  return {
    saveOffer: (offer) => {
      const stored = { ...offer, id: offer.id ?? "off_test" } as AuthorizedOffer;
      saved.push(stored);
      return Promise.resolve(stored);
    },
    getOffer: () => Promise.resolve(undefined),
    saveSession: () => Promise.resolve(),
    getSession: () => Promise.resolve(undefined),
    findSessionsByEmail: () => Promise.resolve([]),
    recordEvent: () => Promise.resolve(),
    appendChatTurn: () =>
      Promise.resolve(
        checkoutSession({
          merchantId: "mrc_1",
          sessionId: "chk_1",
          chatHistory: []
        })
      ),
    saveAcceptedOffer: () => Promise.resolve(),
    getAcceptedOffer: () => Promise.resolve(undefined),
    saveCompletedOrder: () =>
      Promise.resolve({ order: {} as never, idempotent: false }),
    getCompletedOrder: () => Promise.resolve(undefined),
    findCompletedOrderByExternalOrderId: () => Promise.resolve(undefined),
    updateCompletedOrderTracking: () => Promise.resolve(undefined),
    cancelCompletedOrder: () => Promise.resolve(undefined),
    appendOutbox: () => Promise.resolve(fakeEvent),
    listOutbox: () => Promise.resolve([]),
    resolveGlobalUserId: () => Promise.resolve("usr_1"),
    getRules: () => Promise.resolve(merchantRules()),
    setRules: () => Promise.resolve(merchantRules()),
    overview: () => Promise.resolve(emptyDashboard)
  };
}

function buyerTurn(text: string, i: number): ChatTurn {
  return {
    role: "buyer",
    text,
    occurredAt: `2026-01-01T00:00:0${i}.000Z`
  };
}

test("authorizeOffer discounts use static rules-engine cap, ignoring chat history", async () => {
  const repository = fakeRepo();
  const service = new CheckoutOfferService(repository);

  const session = checkoutSession({
    chatHistory: [
      buyerTurn("está caro", 0),
      buyerTurn("tem desconto?", 1),
      buyerTurn("melhorar o preço", 2),
      buyerTurn("abaixar o valor", 3),
      buyerTurn("cupom por favor", 4)
    ]
  });
  const rules = merchantRules({ maxDiscountPercent: 10, minimumMarginPercent: 38 });

  const offer = await service.authorizeOffer(
    "qual o preço?",
    session,
    rules,
    "payment",
    []
  );

  const authorized = offer.toAuthorizedOffer();
  assert.equal(authorized.type, "discount_percent");
  assert.equal(authorized.value, 10);
  assert.equal(authorized.reason, "discount_allowed");
});

test("authorizeOffer cap stays at maxDiscountPercent even with extreme objection count", async () => {
  const repository = fakeRepo();
  const service = new CheckoutOfferService(repository);

  // 10 buyer turns, all matching the previous objection regex pattern.
  const chatHistory: ChatTurn[] = Array.from({ length: 10 }, (_, i) =>
    buyerTurn(`desconto ${i}`, i)
  );
  const session = checkoutSession({
    chatHistory,
    cart: {
      currency: "BRL",
      total: 300,
      items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }]
    }
  });
  const rules = merchantRules({ maxDiscountPercent: 10, minimumMarginPercent: 38 });

  const offer = await service.authorizeOffer(
    "tem desconto?",
    session,
    rules,
    "payment",
    []
  );

  const authorized = offer.toAuthorizedOffer();
  // Must equal the static rules-engine cap, not 0.33 or 0.66 of it.
  assert.equal(authorized.value, 10);
  assert.notEqual(authorized.value, Math.round(10 * 0.33));
  assert.notEqual(authorized.value, Math.round(10 * 0.66));
});

test("authorizeOffer cap equals rules.maxDiscountPercent when requested percent equals cap", async () => {
  const repository = fakeRepo();
  const service = new CheckoutOfferService(repository);

  const session = checkoutSession({
    cart: {
      currency: "BRL",
      total: 1000,
      items: [{ sku: "kit", name: "Kit", price: 1000, cost: 100, quantity: 1 }]
    }
  });
  const rules = merchantRules({ maxDiscountPercent: 15, minimumMarginPercent: 50 });

  const offer = await service.authorizeOffer(
    "quanto fica com desconto?",
    session,
    rules,
    "payment",
    []
  );

  const authorized = offer.toAuthorizedOffer();
  assert.equal(authorized.value, 15);
  assert.ok(authorized.approved);
});
