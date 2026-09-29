import test from "node:test";
import assert from "node:assert/strict";
import { loadDiscountCohorts } from "./discount-cohort.reader.js";

const now = new Date("2026-09-29T00:00:00Z"), createdAt = new Date("2026-09-20T00:00:00Z");
const session = (buyer = "buyer") => ({ globalUserId: buyer, createdAt,
  cart: { currency: "BRL", total: 999, items: [{ variantId: "variant", price: 999, cost: 0, quantity: 1 }] },
  completedOrders: [] as { completedAt: Date }[] });
const intent = (buyer = "buyer") => ({ globalUserId: buyer, primaryIntent: "price_sensitive", generatedAt: new Date("2026-09-19T00:00:00Z") });
const price = { variantId: "variant", basePriceInCents: 10000, costInCents: 4000 };
function db(sessions = [session()], intents = [intent()], prices: any[] = [price]) {
  return { checkoutSession: { findMany: async (args: any) => {
    assert.deepEqual(args.where.createdAt, { gte: new Date("2026-08-23T00:00:00Z"), lt: new Date("2026-09-22T00:00:00Z") });
    assert.equal(args.where.merchantId, "store");
    assert.deepEqual(args.select.completedOrders.where, { merchantId: "store", status: "approved", currency: "BRL" });
    return sessions;
  } }, customerIntentRecord: { findMany: async (args: any) => {
    assert.equal(args.where.merchantId, "store");
    assert.deepEqual(args.where.consent.is, { optedIn: true, expiresAt: { gt: now } }); return intents;
  } }, productPrice: { findMany: async (args: any) => {
    assert.equal(args.where.currency, "BRL");
    assert.deepEqual(args.where.variant, { isActive: true, product: { merchantId: "store", isActive: true, deletedAt: null } }); return prices;
  } } } as any;
}

test("discount cohort reprices from the owned catalog and returns no buyer identifiers", async () => {
  const stats = await loadDiscountCohorts(db(), "store", now, 30);
  assert.equal(stats[0].sampleSize, 1);
  assert.equal(stats[0].carts[0].total, 100);
  assert.equal(stats[0].carts[0].items[0].cost, 40);
  assert.equal(JSON.stringify(stats).includes('"buyer"'), false);
});

test("discount cohort uses only the first session per buyer and intent available at that time", async () => {
  const a = session(), repeat = session(); repeat.completedOrders = [{ completedAt: createdAt }];
  const later = { ...intent(), generatedAt: new Date("2026-09-21T00:00:00Z"), primaryIntent: "returning" };
  const stats = await loadDiscountCohorts(db([a, repeat], [later, intent()]), "store", now, 30);
  assert.equal(stats[0].intent, "price_sensitive"); assert.equal(stats[0].sampleSize, 1); assert.equal(stats[0].conversionRate, 0);
  assert.deepEqual(await loadDiscountCohorts(db([a], [later]), "store", now, 30), []);
});

test("discount cohort counts one conversion within the half-open seven-day window", async () => {
  const sessions = [session("a"), session("b"), session("c")];
  sessions[0].completedOrders = [{ completedAt: createdAt }, { completedAt: new Date("2026-09-21T00:00:00Z") }];
  sessions[1].completedOrders = [{ completedAt: new Date("2026-09-19T23:59:59Z") }];
  sessions[2].completedOrders = [{ completedAt: new Date("2026-09-27T00:00:00Z") }];
  const stats = await loadDiscountCohorts(db(sessions, [intent("a"), intent("b"), intent("c")]), "store", now, 30);
  assert.equal(stats[0].conversionRate, 1 / 3);
});

for (const [label, prices] of [["missing", []], ["null", [{ ...price, costInCents: null }]],
  ["negative", [{ ...price, costInCents: -1 }]], ["fractional", [{ ...price, costInCents: .1 }]] ] as const) {
  test(`discount cohort rejects ${label} catalog cost instead of trusting snapshot cost`, async () => {
    assert.deepEqual(await loadDiscountCohorts(db([session()], [intent()], [...prices]), "store", now, 30), []);
  });
}

for (const [label, patch] of [["currency", { currency: "USD" }], ["stacking", { currentDiscount: 1 }],
  ["options", { items: [{ variantId: "variant", quantity: 1, selected_options: [{}] }] }],
  ["fractional quantity", { items: [{ variantId: "variant", quantity: .5 }] }],
  ["foreign cart", { crossStoreItems: [{}] }], ["missing variant", { items: [{ quantity: 1 }] }]] as const) {
  test(`discount cohort excludes ${label}`, async () => {
    const s = session(); s.cart = { ...s.cart, ...patch } as any;
    assert.deepEqual(await loadDiscountCohorts(db([s]), "store", now, 30), []);
  });
}

test("discount cohort refuses truncated samples and unknown consent instead of extrapolating", async () => {
  assert.deepEqual(await loadDiscountCohorts(db(Array.from({ length: 10001 }, () => session())), "store", now, 30), []);
  assert.deepEqual(await loadDiscountCohorts(db([session()], Array.from({ length: 10001 }, () => intent())), "store", now, 30), []);
  assert.deepEqual(await loadDiscountCohorts(db([session()], []), "store", now, 30), []);
});
