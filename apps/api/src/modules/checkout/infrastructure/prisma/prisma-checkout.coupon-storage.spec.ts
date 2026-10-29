import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Cart, CheckoutSession } from "@zyon/shared-types";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { toCheckoutSession } from "./checkout-session.mapper.js";

// Test-only seeded authority. No codec mock, issuer, DB, env or provider is used.
const KEY = "_storefrontCouponBinding";
const CONFLICT = "checkout_coupon_binding_conflict";
const CANARY = "private-storage-redemption-canary";
type State = "active" | "released" | "redeemed";
type Row = Parameters<typeof toCheckoutSession>[0] & { id: string; version: number };
type Scope = { merchantId_sessionId: { merchantId: string; sessionId: string } };

function binding(state: State = "active") {
  return { version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111",
    merchantId: "mrc_1", cartId: "cart_origin", checkoutSessionId: "chk_1", buyerId: "usr_1",
    reservationBuyerId: "usr_1", redemptionId: CANARY, couponId: "coupon_storage",
    discountCents: 137, basisHash: "ab".repeat(32), state,
    ...(state === "redeemed" ? { orderId: "order_storage" } : {}) };
}

function publicSession(state: State = "active"): CheckoutSession {
  return checkoutSession({ persistenceVersion: 7, cart: {
    currency: "BRL", source: "storefront", total: 300, cart_ref: "cart_origin",
    items: [{ sku: "kit", product_id: "product_kit", name: "Kit", price: 300, cost: 120, quantity: 1 }],
    currentDiscount: state === "released" ? 0 : 1.37,
    ...(state !== "released" ? { commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Cupom válido.", couponCode: "SAVE" } } : {}),
  } });
}

function row(session = publicSession(), storedCart: unknown = session.cart): Row {
  return { ...session, id: "row_checkout_storage", version: session.persistenceVersion ?? 7,
    cart: structuredClone(storedCart), customer: session.customer ?? null, shipping: session.shipping ?? null,
    createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) };
}

function harness(initial: Row | undefined) {
  let stored = structuredClone(initial);
  const writes: string[] = [], sideEffects: string[] = [];
  const reads: { where: Scope; select?: { cart?: boolean } }[] = [];
  const queries: { sql: string; values: unknown[] }[] = [];
  let commits = 0, rollbacks = 0;
  const matches = (where: Scope) => !!stored && where.merchantId_sessionId.merchantId === stored.merchantId
    && where.merchantId_sessionId.sessionId === stored.sessionId;
  const update = (data: Partial<Row>) => {
    stored = { ...(stored ?? row()), ...structuredClone(data), version: (stored?.version ?? 0) + 1 };
    return structuredClone(stored);
  };
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql.join("?"); queries.push({ sql: query, values });
      // Seeded authority has no admitted payment/source owner, so dedicated
      // reopen remains fail-closed even though it may now read cart fences.
      return query.includes("transaction_isolation") ? [{ isolation: "read committed", candidates: [] }] : [];
    },
    checkoutSession: {
      findUnique: async (input: { where: Scope; select?: { cart?: boolean } }) => {
        reads.push(structuredClone(input));
        return matches(input.where) ? structuredClone(stored) : null;
      },
      create: async (input: { data: Partial<Row> }) => { writes.push("create"); return update(input.data); },
      update: async (input: { where: Scope; data: Partial<Row> }) => {
        assert.equal(matches(input.where), true); writes.push("update"); return update(input.data);
      },
      upsert: async (input: { where: Scope; create: Partial<Row>; update: Partial<Row> }) => {
        writes.push("upsert"); return matches(input.where) ? structuredClone(stored)! : update(input.create);
      },
    },
    strategyAssignment: { findUnique: async () => null },
    strategyIncentiveAssignment: { findUnique: async () => null },
    checkoutChatRequest: { findFirst: async () => null },
    paymentIntent: { findFirst: async () => null },
    completedOrder: { findFirst: async () => null },
    checkoutEvent: { findFirst: async () => null },
    merchantRule: { upsert: async () => ({ ...merchantRules(), merchantId: "mrc_1" }) },
    couponRedemption: { updateMany: async () => { sideEffects.push("cancel_coupon"); return { count: 1 }; } },
  };
  const prisma = { ...tx, $transaction: async <T>(work: (client: typeof tx) => Promise<T>): Promise<T> => {
    const before = structuredClone(stored);
    try { const result = await work(tx); commits++; return result; }
    catch (error) { stored = before; rollbacks++; throw error; }
  } };
  return { repo: new PrismaCheckoutRepository(prisma as unknown as PrismaClient),
    read: () => structuredClone(stored), writes, sideEffects, queries, reads,
    stats: () => ({ commits, rollbacks }) };
}

function expectPublic(session: CheckoutSession, expectedCart: Cart) {
  assert.equal(Object.hasOwn(session.cart, KEY), false);
  assert.equal(JSON.stringify(session).includes(CANARY), false);
  assert.deepEqual(session.cart, expectedCart);
}

async function expectConflict(operation: () => Promise<unknown>) {
  await assert.rejects(operation(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, CONFLICT);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal(String(error.stack).includes(CANARY), false);
    return true;
  });
}

for (const state of ["active", "released", "redeemed"] as const) {
  test("mapper strips and detaches the private storage key (" + state + ")", () => {
    const session = publicSession(state), raw = row(session, { ...session.cart, [KEY]: binding(state) });
    const mapped = toCheckoutSession(raw);
    expectPublic(mapped, session.cart);
    mapped.cart.items[0].quantity = 99;
    assert.deepEqual(raw.cart, { ...session.cart, [KEY]: binding(state) });
  });

  for (const operation of ["save", "cas"] as const) test(operation + " preserves only canonical storage authority and returns a public cart (" + state + ")", async () => {
    const session = publicSession(state), privateBinding = binding(state);
    const f = harness(row(session, { ...session.cart, [KEY]: privateBinding }));
    const working = structuredClone(session);
    working.abandonmentScore = 0.22;
    if (operation === "save") await f.repo.saveSession(working);
    else await f.repo.saveSessionIfUnchanged(working, session);
    assert.equal(working.persistenceVersion, 8);
    expectPublic(working, session.cart);
    assert.deepEqual(f.read()?.cart, { ...session.cart, [KEY]: privateBinding });
    const loaded = await f.repo.getSession(session.merchantId, session.sessionId);
    assert.ok(loaded);
    expectPublic(loaded, session.cart);
    assert.deepEqual(f.writes, ["update"]);
    assert.ok(f.queries.some(query => query.sql.includes("checkout_sessions") && query.sql.includes("FOR UPDATE")
      && query.values.includes(session.merchantId) && query.values.includes(session.sessionId)));
  });
}

for (const privateValue of [null, undefined, { invalid: CANARY }]) test("mapper strips even malformed private metadata without exposing or interpreting it: " + String(privateValue), () => {
  const session = publicSession();
  expectPublic(toCheckoutSession(row(session, { ...session.cart, [KEY]: privateValue })), session.cart);
});

for (const operation of ["save-create", "save-update", "create-if-absent", "cas-next", "cas-expected"] as const) {
  for (const value of [undefined, null, binding()]) test(operation + " rejects reserved input presence before any writes: " + typeof value, async () => {
    const session = publicSession();
    const f = harness(operation === "save-create" || operation === "create-if-absent" ? undefined : row(session));
    const injected = { ...session, cart: { ...session.cart, [KEY]: value } };
    await expectConflict(() => operation === "create-if-absent" ? f.repo.createSessionIfAbsent(injected)
      : operation === "cas-next" ? f.repo.saveSessionIfUnchanged(injected, session)
      : operation === "cas-expected" ? f.repo.saveSessionIfUnchanged(session, injected) : f.repo.saveSession(injected));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.sideEffects, []);
  });
}

for (const state of ["active", "released"] as const) {
  for (const version of [undefined, 6, 8]) test("bound generic save rejects missing/stale version (" + state + "/" + version + ")", async () => {
    const session = publicSession(state), original = row(session, { ...session.cart, [KEY]: binding(state) });
    const f = harness(original);
    await expectConflict(() => f.repo.saveSession({ ...session, persistenceVersion: version }));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.read(), original);
  });

  const changes: { name: string; change: (session: CheckoutSession) => void }[] = [
    { name: "currency", change: session => { session.cart.currency = "USD"; } },
    { name: "total", change: session => { session.cart.total++; } },
    { name: "quantity", change: session => { session.cart.items[0].quantity++; } },
    { name: "price", change: session => { session.cart.items[0].price++; } },
    { name: "cost", change: session => { session.cart.items[0].cost = 1; } },
    { name: "SKU", change: session => { session.cart.items[0].sku = "foreign"; } },
    { name: "product", change: session => { session.cart.items[0].product_id = "foreign"; } },
    { name: "discount", change: session => { session.cart.currentDiscount = (session.cart.currentDiscount ?? 0) + 1; } },
    { name: "nudge", change: session => { session.cart.commercialNudge = { kind: "progressive_discount", title: "Changed", message: "Changed" }; } },
    { name: "origin", change: session => { session.cart.commerceCartRef = "foreign_origin"; } },
    { name: "presentation", change: session => { session.cart.items[0].name = "Changed"; } },
    { name: "buyer", change: session => { session.globalUserId = "foreign_buyer"; } },
  ];
  for (const change of changes) for (const operation of ["save", "cas"] as const) test(operation + " refuses bound context change before update (" + state + "/" + change.name + ")", async () => {
    const session = publicSession(state), original = row(session, { ...session.cart, [KEY]: binding(state) });
    const f = harness(original), next = structuredClone(session);
    change.change(next);
    await expectConflict(() => operation === "save" ? f.repo.saveSession(next) : f.repo.saveSessionIfUnchanged(next, session));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.sideEffects, []);
    assert.deepEqual(f.read(), original);
  });
}

for (const corrupt of [undefined, null, { invalid: CANARY }, { ...binding(), merchantId: "foreign" },
  { ...binding(), checkoutSessionId: "foreign" }, { ...binding(), buyerId: "foreign", reservationBuyerId: "foreign" },
  { ...binding(), discountCents: 999 }]) test("stored malformed or mismatched authority cannot be saved: " + JSON.stringify(corrupt), async () => {
  const session = publicSession(), original = row(session, { ...session.cart, [KEY]: corrupt });
  const f = harness(original);
  await expectConflict(() => f.repo.saveSession(session));
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.read(), original);
});

test("bound benefit update refuses before discount authority or canonical storage can be replaced", async () => {
  const session = publicSession(), original = row(session, { ...session.cart, [KEY]: binding() });
  const f = harness(original);
  await expectConflict(() => f.repo.saveBenefitsIfMutable({ ...session, cart: { ...session.cart, currentDiscount: 30 } }, session, merchantRules()));
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sideEffects, []);
  assert.deepEqual(f.read(), original);
});

for (const operation of ["mutation", "reopen"] as const) test("bound " + operation + " refuses before coupon/incentive invalidation side effects", async () => {
  const session = publicSession(), original = row(session, { ...session.cart, [KEY]: binding() });
  const f = harness(original);
  await expectConflict(() => operation === "mutation"
    ? f.repo.commitCommercialMutation({ expected: session, next: { ...session, cart: { ...session.cart, items: [], total: 0 } } })
    : f.repo.reopenForBuyerEdit(session.merchantId, session.sessionId, "coupon"));
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sideEffects, []);
  assert.deepEqual(f.read(), original);
});

for (const operation of ["save-create", "save-update", "cas", "create-if-absent"] as const) test("plain cart retains existing " + operation + " behavior without issuing a binding", async () => {
  const session = publicSession(), f = harness(operation === "save-create" || operation === "create-if-absent" ? undefined : row(session));
  if (operation === "create-if-absent") {
    const result = await f.repo.createSessionIfAbsent(session);
    expectPublic(result.session, session.cart);
  } else if (operation === "cas") await f.repo.saveSessionIfUnchanged(session, structuredClone(session));
  else await f.repo.saveSession(session);
  const saved = f.read();
  assert.ok(saved);
  assert.deepEqual(saved.cart, session.cart);
  assert.ok(saved.cart && typeof saved.cart === "object");
  assert.equal(Object.hasOwn(saved.cart, KEY), false);
});

for (const value of [binding(), binding("released"), binding("redeemed"), undefined, null, { invalid: CANARY }]) {
  test("command preflight checks raw storage, including malformed private presence: " + typeof value, async () => {
    const session = publicSession(), f = harness(row(session, { ...session.cart, [KEY]: value }));
    const visible = await f.repo.getSession(session.merchantId, session.sessionId);
    assert.ok(visible);
    assert.equal(Object.hasOwn(visible.cart, KEY), false);
    f.reads.length = 0;
    await expectConflict(() => f.repo.assertCouponBindingCommandAllowed(session.merchantId, session.sessionId));
    assert.deepEqual(f.reads, [{ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } }, select: { cart: true } }]);
    assert.deepEqual(f.writes, []);
  });
}

test("command preflight keeps plain and missing sessions compatible and returns no private status", async () => {
  const session = publicSession();
  for (const source of [row(session), undefined]) {
    const f = harness(source);
    assert.equal(await f.repo.assertCouponBindingCommandAllowed(session.merchantId, session.sessionId), undefined);
    assert.deepEqual(f.writes, []);
  }
});

for (const enabled of [false, true]) test("both create branches reject the reserved input before any writes/locks (strategy=" + enabled + ")", { concurrency: false }, async () => {
  const keys = ["REVENUE_STRATEGY_EXECUTION_ENABLED", "REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    // Synthetic process-local pilot only; no .env/credentials are read or changed.
    process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = String(enabled);
    process.env.REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS = "mrc_1";
    for (const value of [undefined, null, binding()]) {
      const session = publicSession(), f = harness(undefined);
      const forgedCart = { ...session.cart, [KEY]: value };
      await expectConflict(() => f.repo.createSessionIfAbsent({ ...session, cart: forgedCart }));
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.queries, []);
    }
    const session = publicSession(), f = harness(row(session, { ...session.cart, [KEY]: binding() }));
    const result = await f.repo.createSessionIfAbsent(session);
    expectPublic(result.session, session.cart);
    assert.deepEqual(f.read()?.cart, { ...session.cart, [KEY]: binding() });
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

for (const operation of ["save", "cas"] as const) test(operation + " cannot repair a corrupted canonical buyer using the binding's original buyer", async () => {
  const session = publicSession();
  const original = { ...row(session, { ...session.cart, [KEY]: binding() }), globalUserId: "corrupted_stored_buyer" };
  const f = harness(original), next = structuredClone(session);
  await expectConflict(() => operation === "save" ? f.repo.saveSession(next) : f.repo.saveSessionIfUnchanged(next, session));
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.sideEffects, []);
  assert.deepEqual(f.read(), original);
});

const sessionContextChanges: { name: string; change: (session: CheckoutSession) => void }[] = [
  { name: "shipping amount", change: session => { session.shipping = { ...session.shipping!, customerPrice: 1 }; } },
  { name: "shipping identity", change: session => { session.shipping = { ...session.shipping!, carrier: "foreign" }; } },
  { name: "customer email", change: session => { session.customer = { ...session.customer, email: "other@example.invalid" }; } },
  { name: "customer proof", change: session => { session.customer = { ...session.customer, email_verified: true }; } },
  { name: "customer address", change: session => { session.customer = { ...session.customer, address: { zip: "00000000" } }; } },
  { name: "cross-store sale", change: session => { session.crossStoreItems = [{ lineItemId: "foreign_line", federatedProductId: "foreign_product",
    sourceMerchantId: "foreign_merchant", quantity: 1, unitPriceCents: 100, totalCents: 100, commissionCents: 10, sellerNetCents: 90 }]; } },
];
for (const state of ["active", "released"] as const) for (const operation of ["save", "cas"] as const) {
  for (const change of sessionContextChanges) test(operation + " rejects bound full session context change (" + state + "/" + change.name + ")", async () => {
    const session = publicSession(state), original = row(session, { ...session.cart, [KEY]: binding(state) });
    const f = harness(original), next = structuredClone(session);
    change.change(next);
    await expectConflict(() => operation === "save" ? f.repo.saveSession(next) : f.repo.saveSessionIfUnchanged(next, session));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.sideEffects, []);
    assert.deepEqual(f.read(), original);
  });
}

for (const operation of ["save", "cas"] as const) {
  test(operation + " permits bound chat/prompt/cohort metadata without exposing private authority", async () => {
    const session = publicSession(), f = harness(row(session, { ...session.cart, [KEY]: binding() }));
    const next = { ...structuredClone(session), abandonmentScore: 0.75, triggerAgent: true,
      promptVariantId: "prompt_metadata", cohort: "holdout" as const,
      chatHistory: [{ role: "agent" as const, text: "Synthetic metadata.", occurredAt: session.updatedAt }] };
    if (operation === "save") await f.repo.saveSession(next); else await f.repo.saveSessionIfUnchanged(next, session);
    assert.deepEqual(f.writes, ["update"]);
    expectPublic(next, session.cart);
    assert.deepEqual(f.read()?.cart, { ...session.cart, [KEY]: binding() });
  });

  test(operation + " treats canonical JSON null and public undefined context as equivalent", async () => {
    const session = publicSession();
    delete session.customer;
    delete session.shipping;
    const original = { ...row(session, { ...session.cart, [KEY]: binding() }), customer: null, shipping: null, crossStoreItems: null };
    const f = harness(original), next = structuredClone(session);
    if (operation === "save") await f.repo.saveSession(next); else await f.repo.saveSessionIfUnchanged(next, session);
    assert.deepEqual(f.writes, ["update"]);
    expectPublic(next, session.cart);
  });

  test(operation + " compares JSON context independent of object key ordering and omitted undefined properties", async () => {
    const session = publicSession();
    session.customer = { email: "buyer@example.invalid", fullName: "Synthetic", address: { zip: "00000000", city: "Synthetic" } };
    const original = row(session, { ...session.cart, [KEY]: binding() });
    original.customer = { address: { city: "Synthetic", zip: "00000000" }, fullName: "Synthetic", email: "buyer@example.invalid", phone: undefined };
    const f = harness(original), next = structuredClone(session);
    if (operation === "save") await f.repo.saveSession(next); else await f.repo.saveSessionIfUnchanged(next, session);
    assert.deepEqual(f.writes, ["update"]);
    expectPublic(next, session.cart);
  });
}
