import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorefrontCart, StorefrontCartCommercialSnapshot, StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCartRepository } from "./prisma-storefront-cart.repository.js";
import { PrismaStorefrontCartUnitOfWork } from "./prisma-storefront-cart-unit-of-work.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";

// Explicit transaction/delegate fakes: control-flow and rollback simulation only,
// NOT PostgreSQL lock isolation, native Prisma or production concurrency proof.
const merchant = "synthetic-merchant", session = "synthetic-session";
const cart = (): StorefrontCart => ({ id: "synthetic-cart", merchantId: merchant, sessionId: session,
  items: [{ variantId: "v", productId: "p", name: "Fixture", sku: "SKU", quantity: 2, unitPriceCents: 5000,
    selectedOptions: [{ groupId: "g", groupName: "Size", itemId: "i", itemName: "Small", priceModifierInCents: 0 }] }],
  total: 10000, discount: 2000, couponCode: null, freeShipping: false, createdAt: new Date(0), updatedAt: new Date(0) });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
type Call = { step: string; args?: unknown; values?: unknown[] };
function fixture(initial = cart()) {
  const calls: Call[] = []; let saved = structuredClone(initial), nextPause: Promise<void> | undefined;
  const failure = new Error("synthetic-write-failure"); let failWrite = false;
  const prisma = { async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, config: unknown): Promise<T> {
    calls.push({ step: "begin", args: config });
    const pause = nextPause; nextPause = undefined; await pause;
    let current = structuredClone(saved);
    const tx = {
      async $queryRaw() { return [{ isolation: "read committed", candidates: [] }]; },
      async $executeRaw(_parts: TemplateStringsArray, ...values: unknown[]) { calls.push({ step: "lock", values }); return 1; },
      storefrontCart: {
        async upsert(args: unknown) { calls.push({ step: "read", args }); return structuredClone(current); },
        async update(args: { data: Partial<StorefrontCart> & { expiresAt?: Date } }) {
          calls.push({ step: "write", args: structuredClone(args) }); if (failWrite) throw failure;
          current = { ...current, ...structuredClone(args.data) }; return structuredClone(current);
        },
      },
    };
    try { const result = await work(tx as unknown as Prisma.TransactionClient); calls.push({ step: "commit" }); saved = structuredClone(current); return result; }
    catch (error) { calls.push({ step: "rollback" }); throw error; }
  } };
  const client = prisma as unknown as PrismaClient;
  return { repository: new PrismaStorefrontCartRepository(client), uow: new PrismaStorefrontCartUnitOfWork(client), calls,
    saved: () => structuredClone(saved),
    pauseNext: (promise: Promise<void>) => { nextPause = promise; }, failWrite: () => { failWrite = true; }, failure };
}
const conflict = (error: unknown) => error instanceof StorefrontCartSnapshotConflictError
  && error.message === "storefront_cart_snapshot_conflict" && error.code === "storefront_cart_snapshot_conflict";
const methods: Array<[string, (port: StorefrontCartPort, expected?: StorefrontCartCommercialSnapshot) => Promise<StorefrontCart>]> = [
  ["rule", (port, expected) => port.applyRuleOutcome(merchant, session, { discountCents: 2000, freeShipping: true }, expected)],
  ["coupon", (port, expected) => port.applyCoupon(merchant, session, "NEW", 2000, expected)],
];
const changes: Array<[string, (value: StorefrontCart) => void]> = [
  ["items quantity", value => { value.items[0].quantity = 1; }],
  ["items price", value => { value.items[0].unitPriceCents = 4500; }],
  ["nested selected options", value => { value.items[0].selectedOptions![0].itemId = "other-option"; }],
  ["product identity", value => { value.items[0].productId = "other-product"; }],
  ["marketplace non-combinability", value => { value.items[0].marketplace = { lineItemId: "l", sellerMerchantId: "seller", federatedProductId: "f" }; }],
  ["total", value => { value.total = 5000; }],
  ["discount", value => { value.discount = 1000; }],
  ["coupon non-combinability", value => { value.couponCode = "OTHER"; }],
  ["free shipping", value => { value.freeShipping = true; }],
];
for (const [method, apply] of methods) for (const mode of ["direct", "uow"] as const) {
  for (const [field, change] of changes) test(`${mode} ${method} rejects stale ${field} under lock without a write/TTL refresh`, async () => {
    const expected = cart(), current = cart(); change(current); const f = fixture(current);
    await assert.rejects(mode === "direct" ? apply(f.repository, expected) : f.uow.run({ merchantId: merchant, cartId: session }, ({ cart: bound }) => apply(bound, expected)), conflict);
    assert.deepEqual(f.saved(), current); assert.equal(f.calls.filter(call => call.step === "write").length, 0);
    assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
    assert.equal(f.calls.filter(call => call.step === "commit").length, 0);
    assert.equal(f.calls.at(-1)?.step, "rollback");
    assert.ok(f.calls.findIndex(call => call.step === "lock") < f.calls.findIndex(call => call.step === "read"));
    assert.ok(f.calls.filter(call => call.step === "lock").every(call => call.values?.[0] === JSON.stringify(["storefront-cart", merchant, session])));
  });
  test(`${mode} ${method} accepts matching detached state and preserves legacy TTL`, async () => {
    const f = fixture(), expected = cart(), before = Date.now();
    // Database JSONB property order must not create false snapshot conflicts.
    expected.items[0] = Object.fromEntries(Object.entries(expected.items[0]).reverse()) as unknown as StorefrontCart["items"][number];
    expected.updatedAt = new Date(500); expected.discountBudget = { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 0 };
    const result = mode === "direct" ? await apply(f.repository, expected) : await f.uow.run({ merchantId: merchant, cartId: session }, ({ cart: bound }) => apply(bound, expected));
    assert.equal(result.discount, 2000); assert.equal(result.total, 10000);
    const write = f.calls.find(call => call.step === "write")!.args as { data: { expiresAt: Date } };
    assert.ok(write.data.expiresAt.getTime() >= before + 72 * 3600_000);
    assert.ok(write.data.expiresAt.getTime() <= Date.now() + 72 * 3600_000);
    assert.equal(f.calls.filter(call => call.step === "write").length, 1);
  });
  test(`${mode} ${method} preserves optional legacy calls`, async () => {
    const f = fixture();
    const result = mode === "direct" ? await apply(f.repository) : await f.uow.run({ merchantId: merchant, cartId: session }, ({ cart: bound }) => apply(bound));
    assert.equal(result.discount, 2000); assert.equal(f.calls.filter(call => call.step === "write").length, 1);
  });
}
for (const [method, apply] of methods) {
  test(`${method} snapshots caller nested data before waiting for transaction`, async () => {
    const expected = cart(), current = cart(); current.items[0].selectedOptions![0].itemId = "changed";
    const f = fixture(current), gate = deferred(); f.pauseNext(gate.promise);
    const pending = apply(f.repository, expected);
    expected.items[0].selectedOptions![0].itemId = "changed"; gate.resolve();
    await assert.rejects(pending, conflict); assert.equal(f.calls.filter(call => call.step === "write").length, 0);
  });
  test(`${method} ignores caller mutations after capturing a valid expected state`, async () => {
    const f = fixture(), expected = cart(), gate = deferred(); f.pauseNext(gate.promise);
    const pending = apply(f.repository, expected); expected.total = 1; expected.items[0].selectedOptions![0].itemId = "mutated"; gate.resolve();
    assert.equal((await pending).discount, 2000);
  });
  test(`${method} rejects late authorization after another writer reduces the cart`, async () => {
    const initial = cart(); initial.items = [{ ...initial.items[0], quantity: 1 }, { ...initial.items[0], variantId: "other", quantity: 1 }];
    const f = fixture(initial), expected = f.saved(), gate = deferred(); f.pauseNext(gate.promise);
    const late = apply(f.repository, expected);
    await f.repository.removeItem(merchant, session, "other");
    await f.repository.applyRuleOutcome(merchant, session, { discountCents: 1000, freeShipping: false });
    const before = f.calls.filter(call => call.step === "write").length; gate.resolve();
    await assert.rejects(late, conflict); assert.equal(f.saved().discount, 1000); assert.equal(f.saved().total, 5000);
    assert.equal(f.calls.filter(call => call.step === "write").length, before);
  });
  test(`${method} propagates persistence failure without replay`, async () => {
    const f = fixture(); f.failWrite(); await assert.rejects(apply(f.repository, cart()), error => error === f.failure);
    assert.equal(f.calls.filter(call => call.step === "begin").length, 1); assert.equal(f.calls.filter(call => call.step === "write").length, 1);
    assert.deepEqual(f.saved(), cart());
  });
}
test("rule outcome is detached before transaction wait", async () => {
  const f = fixture(), gate = deferred(), outcome = { discountCents: 1000, freeShipping: false }; f.pauseNext(gate.promise);
  const pending = f.repository.applyRuleOutcome(merchant, session, outcome, cart());
  outcome.discountCents = 9000; outcome.freeShipping = true; gate.resolve();
  const result = await pending; assert.equal(result.discount, 1000); assert.equal(result.freeShipping, false);
});
test("caught CAS conflict cannot commit earlier writes in the same UoW", async () => {
  const f = fixture();
  await assert.rejects(f.uow.run({ merchantId: merchant, cartId: session }, async ({ cart: bound }) => {
    await bound.applyRuleOutcome(merchant, session, { discountCents: 1000, freeShipping: false });
    await assert.rejects(bound.applyCoupon(merchant, session, "NEW", 2000, cart()), conflict);
  }), conflict);
  assert.deepEqual(f.saved(), cart()); assert.equal(f.calls.filter(call => call.step === "commit").length, 0);
});

