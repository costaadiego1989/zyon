import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSession } from "@zyon/shared-types";
import { CheckoutSessionMapper } from "./checkout-session.mapper.js";

function buildSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  const now = new Date("2026-09-03T12:00:00.000Z").toISOString();
  return {
    merchantId: "mrc_1",
    sessionId: "chk_abc",
    globalUserId: "g_1",
    conversationId: "conv_1",
    cart: {
      currency: "BRL",
      total: 199.9,
      items: [
        { sku: "sku_1", name: "Produto 1", price: 99.95, quantity: 2 },
      ],
    },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("toAcp maps status enum: pending -> not_ready_for_payment", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession(),
    aacpStatus: "pending",
  });
  assert.equal(result.status, "not_ready_for_payment");
});

test("toAcp maps status enum: awaiting_payment -> ready_for_payment", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession(),
    aacpStatus: "awaiting_payment",
  });
  assert.equal(result.status, "ready_for_payment");
});

test("toAcp maps status enum: completed -> completed", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession(),
    aacpStatus: "completed",
  });
  assert.equal(result.status, "completed");
});

test("toAcp maps status enum: canceled -> canceled (and cancelled alias)", () => {
  const a = CheckoutSessionMapper.toAcp({
    session: buildSession(),
    aacpStatus: "canceled",
  });
  const b = CheckoutSessionMapper.toAcp({
    session: buildSession(),
    aacpStatus: "cancelled",
  });
  assert.equal(a.status, "canceled");
  assert.equal(b.status, "canceled");
});

test("toAcp defaults status when aacpStatus missing", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession(),
  });
  assert.equal(result.status, "not_ready_for_payment");
});

test("toAcp lowercases ISO 4217 currency (BRL -> brl)", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({ cart: { currency: "BRL", total: 0, items: [] } }),
  });
  assert.equal(result.currency, "brl");
});

test("toAcp lowercases USD and EUR", () => {
  const usd = CheckoutSessionMapper.toAcp({
    session: buildSession({ cart: { currency: "USD", total: 0, items: [] } }),
  });
  const eur = CheckoutSessionMapper.toAcp({
    session: buildSession({ cart: { currency: "EUR", total: 0, items: [] } }),
  });
  assert.equal(usd.currency, "usd");
  assert.equal(eur.currency, "eur");
});

test("toAcp returns amounts in cents (price * quantity)", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({
      cart: {
        currency: "BRL",
        total: 199.9,
        items: [{ sku: "sku_x", name: "Item", price: 99.95, quantity: 2 }],
      },
    }),
  });
  assert.equal(result.line_items.length, 1);
  assert.equal(result.line_items[0].base_amount, 19990);
  assert.equal(result.line_items[0].subtotal, 19990);
  assert.equal(result.line_items[0].total, 19990);
  assert.equal(result.line_items[0].discount, 0);
  assert.equal(result.line_items[0].tax, 0);
});

test("toAcp handles empty line_items as empty array", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({
      cart: { currency: "BRL", total: 0, items: [] },
    }),
  });
  assert.deepEqual(result.line_items, []);
});

test("toAcp emits all canonical total types", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession(),
  });
  const types: string[] = result.totals.map((t) => t.type);
  for (const required of [
    "items_base_amount",
    "discount",
    "subtotal",
    "fulfillment",
    "total",
  ]) {
    assert.ok(types.includes(required), `missing total type ${required}`);
  }
});

test("toAcp applies cart.currentDiscount to discount total", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({
      cart: {
        currency: "BRL",
        total: 199.9,
        currentDiscount: 10,
        items: [{ sku: "sku_x", name: "Item", price: 99.95, quantity: 2 }],
      },
    }),
  });
  const discount = result.totals.find((t) => t.type === "discount");
  assert.ok(discount);
  assert.equal(discount.amount, 1000);
});

test("toAcp emits ISO 8601 timestamps", () => {
  const now = "2026-09-03T12:00:00.000Z";
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({ createdAt: now, updatedAt: now }),
  });
  assert.equal(result.created_at, now);
  assert.equal(result.updated_at, now);
});

test("toAcp maps shippingOptions to fulfillment_options", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({
      shippingOptions: [
        {
          customerPrice: 25.5,
          carrier: "Correios",
          method: "PAC",
          deliveryDays: 5,
        },
        { customerPrice: 40, carrier: "Sedex", method: "SEDEX", deliveryDays: 2 },
      ],
    }),
  });
  assert.equal(result.fulfillment_options.length, 2);
  assert.equal(result.fulfillment_options[0].type, "shipping");
  assert.equal(result.fulfillment_options[0].amount, 2550);
  assert.equal(result.fulfillment_options[0].carrier, "Correios");
  assert.equal(result.fulfillment_options[0].estimated_delivery_days, 5);
  assert.equal(result.fulfillment_options[1].amount, 4000);
});

test("toAcp builds fulfillment_address from customer.address", () => {
  const result = CheckoutSessionMapper.toAcp({
    session: buildSession({
      customer: {
        fullName: "Jane Doe",
        address: {
          street: "Av Paulista",
          number: "1000",
          complement: "Apto 12",
          city: "Sao Paulo",
          state: "SP",
          zip: "01310-100",
        },
      },
    }),
  });
  assert.ok(result.fulfillment_address);
  assert.equal(result.fulfillment_address!.name, "Jane Doe");
  assert.equal(result.fulfillment_address!.line_one, "Av Paulista, 1000");
  assert.equal(result.fulfillment_address!.line_two, "Apto 12");
  assert.equal(result.fulfillment_address!.city, "Sao Paulo");
  assert.equal(result.fulfillment_address!.postal_code, "01310-100");
});

test("toAcp falls back to empty line_items when cart is missing", () => {
  const session = buildSession();
  // @ts-expect-error - exercising defensive path
  session.cart = undefined;
  const result = CheckoutSessionMapper.toAcp({ session });
  assert.deepEqual(result.line_items, []);
});
