import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCheckoutCouponBindingPreserved,
  parseCheckoutCouponBinding,
  planBoundCouponRedemption,
} from "./checkout-coupon-binding.js";

// These are trusted-snapshot policy tests, not proof of database ownership or fencing.
type Snapshot = Record<string, unknown>;
const CONFLICT = "checkout_coupon_binding_conflict";
const CANARY = "PRIVATE_COUPON_AUTHORITY_CANARY_40B1";
const BINDING_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BINDING_ID = "22222222-2222-4222-8222-222222222222";

function identity(): Snapshot {
  return {
    version: 1,
    bindingId: BINDING_ID,
    merchantId: "merchant-synthetic",
    cartId: "cart-synthetic",
    checkoutSessionId: "chk-synthetic",
    buyerId: "buyer-synthetic",
    reservationBuyerId: "buyer-synthetic",
    redemptionId: "redemption-synthetic",
    couponId: "coupon-synthetic",
    discountCents: 137,
    basisHash: "ab".repeat(32),
  };
}

function binding(overrides: Snapshot = {}): Snapshot {
  return { ...identity(), state: "active", ...overrides };
}

function authority(overrides: Snapshot = {}): Snapshot {
  return { ...identity(), orderId: "order-synthetic", ...overrides };
}

function redemption(overrides: Snapshot = {}): Snapshot {
  return {
    id: "redemption-synthetic",
    merchantId: "merchant-synthetic",
    sessionId: "cart-synthetic",
    couponId: "coupon-synthetic",
    buyerGlobalUserId: "buyer-synthetic",
    discountCents: 137,
    status: "applied",
    orderId: null,
    ...overrides,
  };
}

function inputs() {
  return { binding: binding(), orderAuthority: authority(), redemption: redemption() };
}

function expectConflict(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.constructor, Error);
    assert.equal(error.message, CONFLICT);
    assert.equal("cause" in error, false);
    assert.deepEqual(Object.getOwnPropertyNames(error).filter(key => !["message", "stack"].includes(key)), []);
    assert.equal(`${String(error)}\n${error.stack}\n${JSON.stringify(error)}`.includes(CANARY), false);
    return true;
  });
}

const idFields = ["merchantId", "cartId", "checkoutSessionId", "buyerId", "redemptionId", "couponId"] as const;
const invalidIds: unknown[] = [undefined, null, "", " \t\n", "x".repeat(192), "cart\0other", 1, true, {}, []];

for (const state of ["active", "released", "redeemed"] as const) {
  test(`parse accepts a complete ${state} binding without changing the source`, () => {
    const source = binding({ state, ...(state === "redeemed" ? { orderId: "order-synthetic" } : {}) });
    const before = structuredClone(source);
    const parsed = parseCheckoutCouponBinding(Object.freeze(source));
    assert.deepEqual(parsed, before);
    assert.notEqual(parsed, source);
    assert.deepEqual(source, before);
  });
}

test("parse returns a detached snapshot; later mutations in either direction do not alter the other", () => {
  const source = binding();
  const parsed = parseCheckoutCouponBinding(source) as unknown as Snapshot;
  source.cartId = "source-changed-after-parse";
  assert.equal(parsed.cartId, "cart-synthetic");
  parsed.buyerId = "parsed-changed-after-parse";
  assert.equal(source.buyerId, "buyer-synthetic");
  assert.equal(parseCheckoutCouponBinding(binding()).buyerId, "buyer-synthetic");
});

test("parse accepts exact ID boundaries and preserves nonblank IDs without normalization", () => {
  const source = binding({ ...Object.fromEntries(idFields.map(field => [field, "x".repeat(191)])), reservationBuyerId: "x".repeat(191) });
  assert.deepEqual(parseCheckoutCouponBinding(source), source);
  const unnormalized = binding({ cartId: " cart-synthetic " });
  assert.equal(parseCheckoutCouponBinding(unnormalized).cartId, " cart-synthetic ");
  assert.equal(parseCheckoutCouponBinding(binding({ discountCents: Number.MAX_SAFE_INTEGER })).discountCents, Number.MAX_SAFE_INTEGER);
});

for (const field of idFields) {
  test(`parse rejects missing, null, blank, oversized and coerced ${field}`, () => {
    for (const value of invalidIds) expectConflict(() => parseCheckoutCouponBinding(binding({ [field]: value,
      ...(field === "buyerId" ? { reservationBuyerId: value } : {}) })));
    const missing = binding();
    delete missing[field];
    expectConflict(() => parseCheckoutCouponBinding(missing));
  });
}

for (const [field, values] of Object.entries({
  version: [undefined, null, 0, 2, "1", true],
  bindingId: [undefined, null, "", "not-a-uuid", "11111111-1111-1111-8111-111111111111", "11111111-1111-4111-7111-111111111111"],
  discountCents: [undefined, null, 0, -1, 0.5, "137", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1],
  basisHash: [undefined, null, "", "ab".repeat(31), "ab".repeat(33), "AB".repeat(32), "g".repeat(64), "ab".repeat(32) + "\n", 123],
  state: [undefined, null, "", "pending", "ACTIVE", 1],
})) {
  test(`parse rejects invalid ${field} without coercion`, () => {
    for (const value of values) expectConflict(() => parseCheckoutCouponBinding(binding({ [field]: value })));
  });
}

test("parse rejects nonobjects, arrays, extra fields and state/orderId mismatches", () => {
  for (const value of [undefined, null, false, 1, "binding", [], [binding()]]) {
    expectConflict(() => parseCheckoutCouponBinding(value));
  }
  for (const extra of [CANARY, undefined, null]) {
    expectConflict(() => parseCheckoutCouponBinding(binding({ privatePayload: extra })));
  }
  for (const state of ["active", "released"]) {
    for (const orderId of [undefined, null, "order-synthetic"]) {
      expectConflict(() => parseCheckoutCouponBinding(binding({ state, orderId })));
    }
  }
  for (const orderId of invalidIds) {
    expectConflict(() => parseCheckoutCouponBinding(binding({ state: "redeemed", orderId })));
  }
});

test("parse preserves an anonymous reservation explicitly without confusing its buyer with the checkout buyer", () => {
  const source = binding({ reservationBuyerId: null });
  assert.deepEqual(parseCheckoutCouponBinding(source), source);
  for (const value of invalidIds.filter(value => value !== null)) {
    expectConflict(() => parseCheckoutCouponBinding(binding({ reservationBuyerId: value })));
  }
  expectConflict(() => parseCheckoutCouponBinding(binding({ reservationBuyerId: "a-different-buyer" })));
  const missing = binding();
  delete missing.reservationBuyerId;
  expectConflict(() => parseCheckoutCouponBinding(missing));
});

test("preservation accepts absence and independently parsed identical snapshots in every state", () => {
  assert.doesNotThrow(() => assertCheckoutCouponBindingPreserved(undefined, undefined));
  for (const state of ["active", "released", "redeemed"]) {
    const source = binding({ state, ...(state === "redeemed" ? { orderId: "order-synthetic" } : {}) });
    assert.doesNotThrow(() => assertCheckoutCouponBindingPreserved(source, structuredClone(source)));
    assert.doesNotThrow(() => assertCheckoutCouponBindingPreserved(parseCheckoutCouponBinding(source), parseCheckoutCouponBinding(source)));
  }
});

test("preservation rejects insertion, removal, malformed sameness and all identity changes, including released bindings", () => {
  expectConflict(() => assertCheckoutCouponBindingPreserved(undefined, binding()));
  expectConflict(() => assertCheckoutCouponBindingPreserved(binding(), undefined));
  expectConflict(() => assertCheckoutCouponBindingPreserved(null, null));
  const malformed = binding({ privatePayload: CANARY });
  expectConflict(() => assertCheckoutCouponBindingPreserved(malformed, malformed));
  const changes: Snapshot = { ...Object.fromEntries(idFields.map(field => [field, `other-${field}`])),
    bindingId: OTHER_BINDING_ID, discountCents: 138, basisHash: "cd".repeat(32) };
  for (const state of ["active", "released", "redeemed"]) {
    const source = binding({ state, ...(state === "redeemed" ? { orderId: "order-synthetic" } : {}) });
    for (const [field, value] of Object.entries(changes)) {
      expectConflict(() => assertCheckoutCouponBindingPreserved(source, { ...source, [field]: value }));
    }
    expectConflict(() => assertCheckoutCouponBindingPreserved(source, undefined));
  }
  expectConflict(() => assertCheckoutCouponBindingPreserved(binding(), binding({ state: "released" })));
  expectConflict(() => assertCheckoutCouponBindingPreserved(binding({ state: "released" }), binding()));
  expectConflict(() => assertCheckoutCouponBindingPreserved(binding(), binding({ state: "redeemed", orderId: "order-synthetic" })));
  expectConflict(() => assertCheckoutCouponBindingPreserved(binding({ state: "redeemed", orderId: "order-synthetic" }), binding({ state: "redeemed", orderId: "other-order" })));
});

function expectedPlan(kind: "redeem" | "already_redeemed") {
  return { kind, merchantId: "merchant-synthetic", checkoutSessionId: "chk-synthetic", cartId: "cart-synthetic",
    redemptionId: "redemption-synthetic", couponId: "coupon-synthetic", orderId: "order-synthetic", discountCents: 137 };
}

test("plan redeems only an active binding with matching frozen order authority and applied cart reservation", () => {
  const source = inputs();
  const before = structuredClone(source);
  Object.values(source).forEach(Object.freeze);
  assert.deepEqual(planBoundCouponRedemption(source), expectedPlan("redeem"));
  assert.deepEqual(source, before);
});

for (const state of ["active", "redeemed"]) {
  test(`plan recognizes an already redeemed row for the same order with ${state} binding`, () => {
    const source = inputs();
    source.binding = binding({ state, ...(state === "redeemed" ? { orderId: "order-synthetic" } : {}) });
    source.redemption = redemption({ status: "redeemed", orderId: "order-synthetic" });
    assert.deepEqual(planBoundCouponRedemption(source), expectedPlan("already_redeemed"));
  });
}

test("plan rejects released, cancelled, wrong-order and contradictory redeemed/applied states", () => {
  const cases = [
    { binding: binding({ state: "released" }) },
    { binding: binding({ state: "released" }), redemption: redemption({ status: "redeemed", orderId: "order-synthetic" }) },
    { redemption: redemption({ status: "cancelled" }) },
    { redemption: redemption({ status: "redeemed", orderId: "different-order" }) },
    { redemption: redemption({ status: "redeemed", orderId: null }) },
    { redemption: redemption({ status: "applied", orderId: "order-synthetic" }) },
    { redemption: redemption({ status: "cancelled", orderId: "order-synthetic" }) },
    { binding: binding({ state: "redeemed", orderId: "order-synthetic" }) },
    { binding: binding({ state: "redeemed", orderId: "different-order" }), redemption: redemption({ status: "redeemed", orderId: "order-synthetic" }) },
  ];
  for (const change of cases) expectConflict(() => planBoundCouponRedemption({ ...inputs(), ...change }));
});

for (const field of Object.keys(identity())) {
  test(`plan refuses order-authority ${field} mismatch and missing fields`, () => {
    const source = inputs();
    const replacement: unknown = field === "version" ? 2 : field === "discountCents" ? 138
      : field === "bindingId" ? OTHER_BINDING_ID : field === "basisHash" ? "cd".repeat(32) : `other-${field}`;
    expectConflict(() => planBoundCouponRedemption({ ...source, orderAuthority: authority({ [field]: replacement }) }));
    const missing = authority();
    delete missing[field];
    expectConflict(() => planBoundCouponRedemption({ ...source, orderAuthority: missing }));
  });
}

test("plan accepts a faithfully captured anonymous reservation only when both trusted authorities agree on its null buyer", () => {
  const source = { binding: binding({ reservationBuyerId: null }),
    orderAuthority: authority({ reservationBuyerId: null }), redemption: redemption({ buyerGlobalUserId: null }) };
  assert.deepEqual(planBoundCouponRedemption(source), expectedPlan("redeem"));
  expectConflict(() => planBoundCouponRedemption({ ...source, redemption: redemption() }));
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: redemption({ buyerGlobalUserId: null }) }));
  expectConflict(() => planBoundCouponRedemption({ ...source, orderAuthority: authority() }));
});

test("plan rejects ABA: a new bindingId cannot reuse an old order authority even for the same redemption", () => {
  const source = inputs();
  source.binding = binding({ bindingId: OTHER_BINDING_ID });
  assert.equal(source.binding.redemptionId, source.orderAuthority.redemptionId);
  expectConflict(() => planBoundCouponRedemption(source));
});

for (const field of ["id", "merchantId", "sessionId", "couponId", "buyerGlobalUserId", "discountCents"]) {
  test(`plan refuses reservation ${field} mismatch or missing identity`, () => {
    const source = inputs();
    expectConflict(() => planBoundCouponRedemption({ ...source, redemption: redemption({ [field]: field === "discountCents" ? 138 : `other-${field}` }) }));
    const missing = redemption();
    delete missing[field];
    expectConflict(() => planBoundCouponRedemption({ ...source, redemption: missing }));
  });
}

test("plan validates strict authority shape and orderId rather than trusting matching-looking references", () => {
  for (const value of [undefined, null, [], CANARY]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), orderAuthority: value }));
  }
  for (const value of invalidIds) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), orderAuthority: authority({ orderId: value }) }));
  }
  for (const extra of [{ state: "active" }, { payload: CANARY }, { unused: undefined }]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), orderAuthority: authority(extra) }));
  }
});

test("plan validates strict reservation shape, IDs, status and cents without coercion", () => {
  for (const value of [undefined, null, [], CANARY]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: value }));
  }
  for (const field of ["id", "merchantId", "sessionId", "couponId", "buyerGlobalUserId"]) {
    for (const value of invalidIds) {
      expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: redemption({ [field]: value }) }));
    }
  }
  for (const value of [0, -1, 0.1, "137", undefined, null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: redemption({ discountCents: value }) }));
  }
  for (const value of [undefined, null, "APPLIED", "pending", true]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: redemption({ status: value }) }));
  }
  for (const extra of [CANARY, undefined]) {
    expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: redemption({ payload: extra }) }));
  }
  const missingOrderId = redemption();
  delete missingOrderId.orderId;
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: missingOrderId }));
});

test("plan does not alias source snapshots and never includes private authority fields in its result", () => {
  const source = inputs();
  const result = planBoundCouponRedemption(source);
  assert.deepEqual(result, expectedPlan("redeem"));
  source.binding.cartId = "mutated-after-plan";
  source.orderAuthority.orderId = "mutated-after-plan";
  source.redemption.discountCents = 999;
  assert.deepEqual(result, expectedPlan("redeem"));
  (result as unknown as Snapshot).cartId = "mutated-result";
  assert.equal(source.binding.cartId, "mutated-after-plan");
  assert.deepEqual(planBoundCouponRedemption(inputs()), expectedPlan("redeem"));
});

test("all entrypoints normalize malformed or hostile snapshots to the fixed error without cause or canary payload", () => {
  const hostile = new Proxy({}, { ownKeys() { throw new Error(CANARY); }, get() { throw new Error(CANARY); } });
  expectConflict(() => parseCheckoutCouponBinding(hostile));
  expectConflict(() => assertCheckoutCouponBindingPreserved(hostile, hostile));
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), binding: hostile }));
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), orderAuthority: hostile }));
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), redemption: hostile }));
  expectConflict(() => planBoundCouponRedemption({ ...inputs(), binding: binding({ basisHash: CANARY }) }));
});

test("plan refuses an absent or augmented command rather than accepting extra identity inputs", () => {
  for (const value of [undefined, null, false, 1, [], CANARY, { ...inputs(), overrideBinding: binding() }, { ...inputs(), unused: undefined }]) {
    expectConflict(() => planBoundCouponRedemption(value));
  }
});
