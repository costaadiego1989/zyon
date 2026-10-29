import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { StorefrontCart, StorefrontCartItem, StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCartUnitOfWork } from "./prisma-storefront-cart-unit-of-work.js";

// Explicit delegate/transaction fakes. These assert adapter control flow, NOT
// PostgreSQL locking, rollback, native Prisma behavior or business exactly-once.
const bound = () => ({ merchantId: "synthetic-merchant", cartId: "synthetic-session" });
const item = (overrides: Partial<StorefrontCartItem> = {}): StorefrontCartItem => ({
  variantId: "synthetic-variant", productId: "synthetic-product", name: "Fixture", sku: "SYNTHETIC", quantity: 1, unitPriceCents: 200, ...overrides,
});
const initialCart = (): StorefrontCart => ({ id: "physical-cart-id", merchantId: bound().merchantId, sessionId: bound().cartId,
  items: [], couponCode: null, discount: 0, freeShipping: false, total: 0, createdAt: new Date(0), updatedAt: new Date(0) });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
type Call = { step: string; args?: unknown; values?: unknown[]; sql?: string };
type Options = { initial?: StorefrontCart; beforeTransaction?: Promise<void>; beforeUpsert?: () => Promise<void>;
  beforeCommit?: Promise<void>; failure?: "begin" | "lock" | "upsert" | "update" | "commit"; stock?: number; unavailable?: boolean;
  couponReservationCents?: number };

function fixture(options: Options = {}) {
  const calls: Call[] = [];
  let persisted = structuredClone(options.initial ?? initialCart());
  const failure = new Error(`synthetic-${options.failure ?? "callback"}-failure`);
  let current = structuredClone(persisted);
  const reservation = options.couponReservationCents === undefined ? undefined : { id: "synthetic-redemption", merchantId: bound().merchantId,
    sessionId: bound().cartId, couponId: "synthetic-coupon", buyerGlobalUserId: null, status: "applied", orderId: null,
    discountApplied: new Prisma.Decimal(options.couponReservationCents).div(100) };
  const tx = {
    async $queryRaw(parts: TemplateStringsArray) {
      const sql = parts.join("?");
      if (reservation && sql.includes("FROM coupons")) return [{ id: reservation.couponId }];
      if (reservation && sql.includes("FROM checkout_sessions") && !sql.includes("current_setting")) return [];
      calls.push({ step: "binding-read" }); return [{ isolation: "read committed", candidates: [] }];
    },
    async $executeRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      calls.push({ step: "lock", sql: parts.join("?"), values });
      if (options.failure === "lock") throw failure;
      return 1;
    },
    storefrontCart: {
      async findUnique() { return structuredClone(current); },
      async upsert(args: unknown) {
        calls.push({ step: "upsert", args });
        await options.beforeUpsert?.();
        if (options.failure === "upsert") throw failure;
        return structuredClone(current);
      },
      async update(args: { where: { id: string }; data: Partial<StorefrontCart> & { expiresAt?: Date } }) {
        calls.push({ step: "update", args: structuredClone(args) });
        if (options.failure === "update") throw failure;
        current = { ...current, ...structuredClone(args.data) };
        return structuredClone(current);
      },
      async updateMany(args: { where: { id: string }; data: Partial<StorefrontCart> & { expiresAt?: Date } }) {
        calls.push({ step: "update", args: structuredClone(args) });
        if (options.failure === "update") throw failure;
        current = { ...current, ...structuredClone(args.data) }; return { count: 1 };
      },
    },
    coupon: { async findFirst() { return reservation ? { id: reservation.couponId, merchantId: bound().merchantId,
      code: "SYNTHETIC", discountType: "fixed", strategyIncentiveExecutionId: null } : null; } },
    couponRedemption: {
      async findMany() { return reservation ? [{ ...reservation }] : []; },
      async findFirst() { return reservation ? { ...reservation } : null; },
      async updateMany(args: { where: { id: string; status: string }; data: { status: string } }) {
        assert.ok(reservation); assert.equal(args.where.id, reservation.id); assert.equal(args.where.status, "applied");
        reservation.status = args.data.status; return { count: 1 };
      },
    },
    productVariant: {
      async findFirst(args: unknown) {
        calls.push({ step: "variant", args });
        return options.unavailable ? null : { product: { type: "physical", metadata: {} }, price: { basePriceInCents: 200 }, stock: [{ quantity: options.stock ?? 100, reserved: 0 }] };
      },
    },
  };
  // A PrismaClient has many unrelated delegates. This intentionally narrow fake
  // is not a production implementation and never creates/imports a real client.
  const prisma = {
    async $transaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>, config: unknown): Promise<T> {
      calls.push({ step: "begin", args: config });
      if (options.failure === "begin") throw failure;
      await options.beforeTransaction;
      current = structuredClone(persisted);
      try {
        const result = await work(tx as unknown as Prisma.TransactionClient);
        calls.push({ step: "commit" });
        await options.beforeCommit;
        if (options.failure === "commit") throw failure;
        persisted = structuredClone(current);
        return result;
      } catch (error) { calls.push({ step: "rollback" }); throw error; }
    },
  };
  return { uow: new PrismaStorefrontCartUnitOfWork(prisma as unknown as PrismaClient), calls, tx, failure,
    saved: () => structuredClone(persisted) };
}

test("one ReadCommitted transaction locks the exact session namespace before exposing the same tx", async () => {
  const f = fixture();
  const result = await f.uow.run(bound(), async ({ tx }) => {
    assert.equal(tx, f.tx);
    assert.deepEqual(f.calls.map(call => call.step), ["begin", "lock", "binding-read"]);
    assert.match(f.calls[1].sql!, /pg_advisory_xact_lock\(hashtextextended/);
    assert.deepEqual(f.calls[1].values, [JSON.stringify(["storefront-cart", bound().merchantId, bound().cartId])]);
    return "callback-result";
  });
  assert.equal(result, "callback-result");
  assert.deepEqual(f.calls[0].args, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  assert.deepEqual(f.calls.map(call => call.step), ["begin", "lock", "binding-read", "commit"]);
});
test("transaction-bound remove forwards exact options identity instead of dropping its selector", async () => {
  const initial = initialCart(); initial.items = ["blue", "red"].map(id => item({ selectedOptions: [{ groupId: "color", groupName: "Color",
    itemId: id, itemName: id, priceModifierInCents: 0 }] })); initial.total = 400;
  const f = fixture({ initial });
  const result = await f.uow.run(bound(), ({ cart }) => cart.removeItem(bound().merchantId, bound().cartId, "synthetic-variant", { optionItemIds: ["blue"], serviceSlotId: null }));
  assert.deepEqual(result.items, [initial.items[1]]); assert.deepEqual(f.saved().items, [initial.items[1]]);
});
test("transaction-bound quantity zero forwards exact options identity", async () => {
  const initial = initialCart(); initial.items = ["blue", "red"].map(id => item({ selectedOptions: [{ groupId: "color", groupName: "Color",
    itemId: id, itemName: id, priceModifierInCents: 0 }] })); initial.total = 400;
  const f = fixture({ initial });
  const result = await f.uow.run(bound(), ({ cart }) => cart.updateItemQuantity(bound().merchantId, bound().cartId, "synthetic-variant", 0, { optionItemIds: ["red"], serviceSlotId: null }));
  assert.deepEqual(result.items, [initial.items[0]]); assert.deepEqual(f.saved().items, [initial.items[0]]);
});

test("sequential cart methods use the supplied transaction without opening nested transactions", async () => {
  const f = fixture();
  await f.uow.run(bound(), async ({ cart, tx }) => {
    assert.equal(tx, f.tx);
    const first = await cart.addItem(bound().merchantId, bound().cartId, item({ quantity: 2 }));
    assert.equal(first.total, 400);
    const second = await cart.applyRuleOutcome(bound().merchantId, bound().cartId, { discountCents: 30, freeShipping: true });
    assert.equal(second.total, 400); assert.equal(second.discount, 30); assert.equal(second.freeShipping, true);
  });
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
  assert.equal(f.calls.filter(call => call.step === "update").length, 2);
  assert.equal(f.saved().items[0].quantity, 2);
  const variant = f.calls.find(call => call.step === "variant")!.args as { where: { product: { merchantId: string } } };
  assert.equal(variant.where.product.merchantId, bound().merchantId);
});

test("run resolves only after the owning transaction acknowledges COMMIT", async () => {
  const gate = deferred(), f = fixture({ beforeCommit: gate.promise }); let settled = false, escaped!: StorefrontCartPort;
  const pending = f.uow.run(bound(), async ({ cart }) => { escaped = cart; return "synthetic-value"; }).then(value => { settled = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call.step === "commit")); assert.equal(settled, false);
  const before = f.calls.length;
  await assert.rejects(escaped.getOrCreate(bound().merchantId, bound().cartId));
  assert.equal(f.calls.length, before);
  gate.resolve(); assert.equal(await pending, "synthetic-value");
});

test("scope is detached synchronously before waiting for the transaction", async () => {
  const gate = deferred(), f = fixture({ beforeTransaction: gate.promise }), scope = bound();
  const pending = f.uow.run(scope, async ({ cart }) => cart.getOrCreate(bound().merchantId, bound().cartId));
  scope.merchantId = "changed-merchant"; scope.cartId = "changed-session"; gate.resolve();
  await pending;
  assert.ok(f.calls.filter(call => call.step === "lock").every(call => call.values?.[0] === JSON.stringify(["storefront-cart", bound().merchantId, bound().cartId])));
  const upsert = f.calls.find(call => call.step === "upsert")!.args as { where: { merchantId_sessionId: unknown } };
  assert.deepEqual(upsert.where.merchantId_sessionId, { merchantId: bound().merchantId, sessionId: bound().cartId });
});

for (const scope of [null, {}, { ...bound(), extra: true }, { ...bound(), sessionId: "alias" },
  { ...bound(), merchantId: "" }, { ...bound(), cartId: " " }, { ...bound(), cartId: "x\0y" },
  { ...bound(), cartId: "x\ud800" }, { ...bound(), cartId: "x".repeat(192) }]) {
  test(`invalid strict scope fails before transaction: ${JSON.stringify(scope)}`, async () => {
    const f = fixture(); let invoked = false;
    await assert.rejects(f.uow.run(scope as never, async () => { invoked = true; }));
    assert.equal(invoked, false); assert.deepEqual(f.calls, []);
  });
}

for (const work of [undefined, null, "not-a-callback"]) test(`invalid work fails before transaction: ${String(work)}`, async () => {
  const f = fixture();
  await assert.rejects(f.uow.run(bound(), work as never));
  assert.deepEqual(f.calls, []);
});

const operations: Array<[string, (cart: StorefrontCartPort, merchant: string, session: string) => Promise<StorefrontCart>]> = [
  ["getOrCreate", (cart, merchant, session) => cart.getOrCreate(merchant, session)],
  ["addItem", (cart, merchant, session) => cart.addItem(merchant, session, item())],
  ["removeItem", (cart, merchant, session) => cart.removeItem(merchant, session, "synthetic-variant")],
  ["updateItemQuantity", (cart, merchant, session) => cart.updateItemQuantity(merchant, session, "synthetic-variant", 1)],
  ["clear", (cart, merchant, session) => cart.clear(merchant, session)],
  ["applyCoupon", (cart, merchant, session) => cart.applyCoupon(merchant, session, "SYNTHETIC", 10)],
  ["removeCoupon", (cart, merchant, session) => cart.removeCoupon(merchant, session)],
  ["applyRuleOutcome", (cart, merchant, session) => cart.applyRuleOutcome(merchant, session, { discountCents: 0, freeShipping: false })],
];
for (const [name, operation] of operations) for (const mismatch of ["merchant", "session"] as const) {
  test(`${name} rejects a different ${mismatch} before method IO`, async () => {
    const f = fixture();
    await assert.rejects(f.uow.run(bound(), async ({ cart }) => {
      const before = f.calls.length;
      await assert.rejects(operation(cart, mismatch === "merchant" ? "foreign" : bound().merchantId,
        mismatch === "session" ? "foreign" : bound().cartId));
      assert.equal(f.calls.length, before);
    }));
  });
}

for (const [name, operation] of operations) test(`escaped ${name} lease fails before IO after callback commit`, async () => {
  const f = fixture(); let escaped!: StorefrontCartPort;
  await f.uow.run(bound(), async ({ cart }) => { escaped = cart; });
  const before = f.calls.length;
  await assert.rejects(operation(escaped, bound().merchantId, bound().cartId));
  assert.equal(f.calls.length, before);
});

test("escaped lease also closes when callback rejects", async () => {
  const f = fixture(); let escaped!: StorefrontCartPort;
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => { escaped = cart; throw f.failure; }), error => error === f.failure);
  const before = f.calls.length;
  await assert.rejects(escaped.getOrCreate(bound().merchantId, bound().cartId));
  assert.equal(f.calls.length, before);
});

test("overlapping calls are rejected before the second call performs IO", async () => {
  const entered = deferred(), release = deferred(), f = fixture({ beforeUpsert: async () => { entered.resolve(); await release.promise; } });
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => {
    const first = cart.getOrCreate(bound().merchantId, bound().cartId); await entered.promise;
    const before = f.calls.length;
    await assert.rejects(cart.clear(bound().merchantId, bound().cartId));
    assert.equal(f.calls.length, before);
    release.resolve(); await first;
  }));
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

test("returning with an unawaited operation drains it and rejects instead of committing", async () => {
  const entered = deferred(), release = deferred(), f = fixture({ beforeUpsert: async () => { entered.resolve(); await release.promise; } });
  let operation!: Promise<StorefrontCart>, settled = false;
  const pending = f.uow.run(bound(), async ({ cart }) => {
    operation = cart.getOrCreate(bound().merchantId, bound().cartId);
    await entered.promise;
  });
  const rejected = assert.rejects(pending).then(() => { settled = true; });
  await entered.promise; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.ok(!f.calls.some(call => call.step === "commit"));
  release.resolve(); await rejected; await operation;
  assert.ok(f.calls.some(call => call.step === "rollback"));
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

test("callback failure closes the lease, drains pending failure and preserves the primary callback error", async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ failure: "upsert", beforeUpsert: async () => { entered.resolve(); await release.promise; } });
  const primary = new Error("synthetic-primary-callback-failure");
  let escaped!: StorefrontCartPort, operation!: Promise<StorefrontCart>, settled = false;
  const pending = f.uow.run(bound(), async ({ cart }) => {
    escaped = cart; operation = cart.getOrCreate(bound().merchantId, bound().cartId);
    void operation.catch(() => {});
    await entered.promise; throw primary;
  });
  const rejected = assert.rejects(pending, error => error === primary).then(() => { settled = true; });
  await entered.promise; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  const before = f.calls.length;
  await assert.rejects(escaped.clear(bound().merchantId, bound().cartId));
  assert.equal(f.calls.length, before);
  release.resolve(); await rejected;
  await assert.rejects(operation, error => error === f.failure);
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

test("unawaited database failure is drained without COMMIT or an unhandled public rejection", async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ failure: "upsert", beforeUpsert: async () => { entered.resolve(); await release.promise; } });
  const pending = f.uow.run(bound(), async ({ cart }) => {
    // Intentionally no catch on this public promise: finish() must drain it.
    void cart.getOrCreate(bound().merchantId, bound().cartId);
    await entered.promise;
  });
  const rejected = assert.rejects(pending);
  await entered.promise; await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(!f.calls.some(call => call.step === "commit"));
  release.resolve(); await rejected;
  assert.ok(!f.calls.some(call => call.step === "commit"));
  assert.ok(f.calls.some(call => call.step === "rollback"));
});

test("settled fire-and-forget validation failure invalidates earlier successful work", async () => {
  const f = fixture();
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => {
    await cart.addItem(bound().merchantId, bound().cartId, item());
    void cart.addItem(bound().merchantId, bound().cartId, item({ quantity: 0 }));
    await Promise.resolve(); await Promise.resolve();
  }));
  assert.equal(f.saved().items.length, 0);
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

for (const kind of ["validation", "database"] as const) test(`caught settled ${kind} failure cannot commit earlier cart work`, async () => {
  const options: Options = {}, f = fixture(options); let observed: unknown;
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => {
    await cart.addItem(bound().merchantId, bound().cartId, item());
    if (kind === "database") options.failure = "upsert";
    try {
      if (kind === "database") await cart.getOrCreate(bound().merchantId, bound().cartId);
      else await cart.addItem(bound().merchantId, bound().cartId, item({ quantity: 0 }));
      assert.fail("fixture operation must reject");
    } catch (error) { observed = error; }
  }), error => error === observed);
  assert.ok(observed instanceof Error);
  assert.equal(f.saved().items.length, 0);
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

for (const stage of ["begin", "lock", "upsert", "update", "commit"] as const) test(`${stage} failure propagates original error without automatic retry`, async () => {
  const f = fixture({ failure: stage });
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => cart.getOrCreate(bound().merchantId, bound().cartId)), error => error === f.failure);
  assert.equal(f.calls.filter(call => call.step === "begin").length, 1);
  assert.equal(f.saved().items.length, 0);
});

test("callback failure rolls fake state back and the UoW never retries work", async () => {
  const f = fixture(); let callbacks = 0;
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => {
    callbacks++; await cart.addItem(bound().merchantId, bound().cartId, item()); throw f.failure;
  }), error => error === f.failure);
  assert.equal(callbacks, 1); assert.equal(f.saved().items.length, 0);
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

for (const reason of [undefined, null, false, 0, ""]) test(`falsy callback rejection is not mistaken for success: ${String(reason)}`, async () => {
  const f = fixture();
  await assert.rejects(f.uow.run(bound(), async () => { throw reason; }), error => Object.is(error, reason));
  assert.ok(f.calls.some(call => call.step === "rollback"));
  assert.ok(!f.calls.some(call => call.step === "commit"));
});

for (const quantity of [0, -1, 100, 1.5, NaN]) test(`addItem retains quantity guard ${quantity}`, async () => {
  const f = fixture();
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => cart.addItem(bound().merchantId, bound().cartId, item({ quantity }))));
  assert.equal(f.calls.filter(call => call.step === "update").length, 0);
});

for (const options of [{ unavailable: true }, { stock: 0 }]) test(`addItem retains catalog/stock admission ${JSON.stringify(options)}`, async () => {
  const f = fixture(options);
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => cart.addItem(bound().merchantId, bound().cartId, item())));
  assert.equal(f.saved().items.length, 0); assert.equal(f.calls.filter(call => call.step === "update").length, 0);
});

test("invalid persisted line total is rejected before saving", async () => {
  const initial = initialCart(); initial.items = [item({ unitPriceCents: 2_147_483_647, quantity: 2 })];
  const f = fixture({ initial });
  await assert.rejects(f.uow.run(bound(), async ({ cart }) => cart.getOrCreate(bound().merchantId, bound().cartId)));
  assert.equal(f.calls.filter(call => call.step === "update").length, 0);
});

for (const outcome of [{ discountCents: 1, freeShipping: false }, { discountCents: 0, freeShipping: true }]) {
  test(`marketplace allocation guard remains authoritative ${JSON.stringify(outcome)}`, async () => {
    const initial = initialCart(); initial.items = [item({ marketplace: { lineItemId: "line", sellerMerchantId: "seller", federatedProductId: "federated" } })];
    const f = fixture({ initial });
    await assert.rejects(f.uow.run(bound(), async ({ cart }) => cart.applyRuleOutcome(bound().merchantId, bound().cartId, outcome)));
    assert.equal(f.calls.filter(call => call.step === "update").length, 0);
  });
}

test("legacy cart methods preserve coupon, quantity-zero removal and 72h expiry semantics", async () => {
  const f = fixture({ couponReservationCents: 10 }), before = Date.now();
  await f.uow.run(bound(), async ({ cart }) => {
    await cart.addItem(bound().merchantId, bound().cartId, item());
    assert.equal((await cart.applyCoupon(bound().merchantId, bound().cartId, "SYNTHETIC", 10)).couponCode, "SYNTHETIC");
    assert.equal((await cart.removeCoupon(bound().merchantId, bound().cartId)).discount, 0);
    assert.equal((await cart.updateItemQuantity(bound().merchantId, bound().cartId, "synthetic-variant", 0)).items.length, 0);
    await cart.clear(bound().merchantId, bound().cartId);
  });
  const after = Date.now();
  for (const call of f.calls.filter(call => call.step === "update")) {
    const { data } = call.args as { data: { expiresAt: Date } };
    assert.ok(data.expiresAt.getTime() >= before + 72 * 3_600_000);
    assert.ok(data.expiresAt.getTime() <= after + 72 * 3_600_000);
  }
});

test("unattributed legacy coupon and free-shipping removal require review without changing either benefit", async () => {
  const initial = initialCart(); initial.freeShipping = true; initial.couponCode = "SYNTHETIC"; initial.discount = 50;
  const f = fixture({ initial });
  for (const command of ["removeCoupon", "clear"] as const) {
    await assert.rejects(f.uow.run(bound(), ({ cart }) => cart[command](bound().merchantId, bound().cartId)));
    assert.deepEqual(f.saved(), initial);
  }
});
test("legacy clear and coupon removal without a coupon preserve the independent free-shipping outcome", async () => {
  const initial = initialCart(); initial.freeShipping = true; initial.discount = 50;
  const f = fixture({ initial });
  await f.uow.run(bound(), async ({ cart }) => {
    assert.equal((await cart.removeCoupon(bound().merchantId, bound().cartId)).freeShipping, true);
    const cleared = await cart.clear(bound().merchantId, bound().cartId);
    assert.equal(cleared.freeShipping, true); assert.equal(cleared.discount, 0); assert.equal(cleared.couponCode, null);
  });
});

test("positive quantity update and explicit removeItem preserve the core line semantics", async () => {
  const initial = initialCart(); initial.items = [item()]; const f = fixture({ initial });
  await f.uow.run(bound(), async ({ cart }) => {
    const changed = await cart.updateItemQuantity(bound().merchantId, bound().cartId, "synthetic-variant", 3);
    assert.equal(changed.items[0].quantity, 3); assert.equal(changed.total, 600);
    const removed = await cart.removeItem(bound().merchantId, bound().cartId, "synthetic-variant");
    assert.equal(removed.items.length, 0); assert.equal(removed.total, 0);
  });
});

