import assert from "node:assert/strict";
import test from "node:test";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "./payment-intent.entity.js";
import { assertSamePaymentIdentity } from "./payment-persistence.js";

const CANARY = "PRIVATE_COUPON_AUTHORITY_CANARY";
const authority = () => ({ version: 1 as const, bindingId: "11111111-1111-4111-8111-111111111111",
  merchantId: "synthetic-merchant", cartId: "synthetic-cart", checkoutSessionId: "synthetic-checkout",
  buyerId: "synthetic-buyer", reservationBuyerId: null as string | null, redemptionId: "synthetic-redemption",
  couponId: "synthetic-coupon", discountCents: 137, basisHash: "ab".repeat(32) });

function journal() {
  const entity = PaymentIntentEntity.create({ merchantId: "synthetic-merchant", sessionId: "synthetic-checkout",
    idempotencyKey: "synthetic-idempotency", amountCents: 863, currency: "BRL", method: "pix" });
  entity.prepareCreation({ merchantId: "synthetic-merchant", sessionId: "synthetic-checkout", intentId: entity.id,
    amountCents: 863, currency: "BRL", method: "pix" });
  return entity.snapshot();
}

function withAuthority(snapshot = journal(), value: unknown = authority()) {
  return { ...snapshot, creation: { ...snapshot.creation!, couponAuthority: value } };
}

function conflict(operation: () => unknown) {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "payment_coupon_authority_conflict");
    assert.equal("cause" in error, false);
    assert.equal(`${String(error)}\n${error.stack}\n${JSON.stringify(error)}`.includes(CANARY), false);
    return true;
  });
}

test("legacy journals remain absent, and prepareCreation does not issue coupon authority", () => {
  const snapshot = journal();
  assert.equal(Object.hasOwn(snapshot.creation!, "couponAuthority"), false);
  assertSamePaymentIdentity(snapshot, structuredClone(snapshot));
  assert.deepEqual(PaymentIntentEntity.rehydrate(snapshot).snapshot(), snapshot);
});

test("valid stored authority is detached and survives claim, uncertainty, recovery and receipt", () => {
  const source = authority(), stored = withAuthority(journal(), source);
  const before = structuredClone(stored);
  const entity = PaymentIntentEntity.rehydrate(stored as PaymentIntentSnapshot);
  source.cartId = "not-canonical";
  assert.equal(entity.claimCreation("first", new Date(0)), "create");
  entity.markCreationUncertain("first", "synthetic_unknown");
  assert.equal(entity.claimCreation("recovery", new Date(100_000)), "recover");
  entity.completeCreation("recovery");
  entity.markRequiresAction({ providerPaymentId: "synthetic-receipt" });
  entity.markApproved({ providerPaymentId: "synthetic-receipt", approvedAmountCents: 863 });
  const result = entity.snapshot();
  assert.deepEqual(result.creation?.couponAuthority, authority());
  assert.equal(result.creation?.firstAttemptAt, new Date(0).toISOString());
  assertSamePaymentIdentity(before as PaymentIntentSnapshot, result);
});

for (const direction of ["attach-to-legacy", "drop-stored"] as const) {
  test(`identity rejects ${direction} even when input and money did not change`, () => {
    const plain = journal(), bound = withAuthority(plain);
    conflict(() => assertSamePaymentIdentity(...(direction === "attach-to-legacy"
      ? [plain, bound] : [bound, plain]) as [PaymentIntentSnapshot, PaymentIntentSnapshot]));
  });
}

const changes = { version: 2, bindingId: "22222222-2222-4222-8222-222222222222", merchantId: "other-merchant",
  cartId: "other-cart", checkoutSessionId: "other-checkout", buyerId: "other-buyer", reservationBuyerId: "synthetic-buyer",
  redemptionId: "other-redemption", couponId: "other-coupon", discountCents: 138, basisHash: "cd".repeat(32) };
for (const [field, value] of Object.entries(changes)) {
  test(`identity rejects changing ${field}, including the same-redemption ABA generation`, () => {
    const before = withAuthority();
    const after = withAuthority(before as PaymentIntentSnapshot, { ...authority(), [field]: value });
    conflict(() => assertSamePaymentIdentity(before as PaymentIntentSnapshot, after as PaymentIntentSnapshot));
  });
}

const invalid: unknown[] = [undefined, null, CANARY, {}, [], { ...authority(), state: "active" },
  { ...authority(), orderId: CANARY }, { ...authority(), extra: CANARY }, { ...authority(), discountCents: 0 },
  { ...authority(), discountCents: 1.37 }, { ...authority(), basisHash: "AB".repeat(32) },
  { ...authority(), cartId: "cart\0other" }, { ...authority(), reservationBuyerId: "other-buyer" }];
for (const [index, value] of invalid.entries()) {
  test(`rehydrate refuses malformed present authority ${index}, before cloning can erase presence`, () => {
    const snapshot = withAuthority(); snapshot.creation.couponAuthority = value as typeof snapshot.creation.couponAuthority;
    conflict(() => PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot));
  });
  test(`identity refuses two identical malformed authorities ${index}`, () => {
    const snapshot = withAuthority(journal(), value);
    // Passing undefined through a default parameter would turn it into a valid
    // fixture; explicitly assign so undefined PRESENCE is exercised.
    snapshot.creation.couponAuthority = value;
    conflict(() => assertSamePaymentIdentity(snapshot as PaymentIntentSnapshot, snapshot as PaymentIntentSnapshot));
  });
}

for (const scope of ["merchantId", "sessionId"] as const) {
  test(`rehydrate refuses authority outside journal ${scope}`, () => {
    const snapshot = { ...withAuthority(), [scope]: "other" };
    conflict(() => PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot));
  });
}

test("authority reordered by JSONB remains identical and is not tied to journal lease state", () => {
  const before = withAuthority(), reverse = Object.fromEntries(Object.entries(authority()).reverse());
  const after = withAuthority(before as PaymentIntentSnapshot, reverse);
  assertSamePaymentIdentity(before as PaymentIntentSnapshot, after as PaymentIntentSnapshot);
});

for (const privateKey of ["couponAuthority", "_storefrontCouponBinding", "coupon_authority"]) {
  for (const value of [authority(), null, undefined]) {
    test(`prepareCreation refuses private ${privateKey} (${typeof value}) in PSP input`, () => {
      const snapshot = journal();
      const entity = PaymentIntentEntity.rehydrate({ ...snapshot, creation: undefined });
      conflict(() => entity.prepareCreation({ ...snapshot.creation!.input, [privateKey]: value }));
      assert.equal(entity.snapshot().creation, undefined);
    });
    test(`rehydrate refuses private ${privateKey} (${typeof value}) in persisted PSP input`, () => {
      const snapshot = journal();
      snapshot.creation!.input = { ...snapshot.creation!.input, [privateKey]: value };
      conflict(() => PaymentIntentEntity.rehydrate(snapshot));
    });
  }
}

test("throwing authority accessors and input proxies cannot leak payload via exceptions", () => {
  const snapshot = journal();
  Object.defineProperty(snapshot.creation, "couponAuthority", { enumerable: true, get() { throw new Error(CANARY); } });
  conflict(() => PaymentIntentEntity.rehydrate(snapshot));
  const other = journal();
  other.creation!.input = new Proxy(other.creation!.input, { has() { throw new Error(CANARY); } });
  conflict(() => PaymentIntentEntity.rehydrate(other));
});

for (const descriptor of ["inherited", "non-enumerable", "accessor"] as const) {
  test(`rehydrate refuses ${descriptor} authority rather than silently dropping it during cloning`, () => {
    const snapshot = journal();
    if (descriptor === "inherited") Object.setPrototypeOf(snapshot.creation, { couponAuthority: authority() });
    else Object.defineProperty(snapshot.creation, "couponAuthority", descriptor === "accessor"
      ? { enumerable: true, get: authority } : { enumerable: false, value: authority() });
    conflict(() => PaymentIntentEntity.rehydrate(snapshot));
  });
}

for (const [field, value] of Object.entries({ merchantId: "other-merchant", sessionId: "other-checkout",
  intentId: "other-intent", amountCents: 864, currency: "USD", method: "card" })) {
  test(`bound journal refuses provider input ${field} outside the immutable payment identity`, () => {
    const snapshot = withAuthority();
    snapshot.creation.input = { ...snapshot.creation.input, [field]: value };
    conflict(() => PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot));
    conflict(() => assertSamePaymentIdentity(snapshot as PaymentIntentSnapshot, snapshot as PaymentIntentSnapshot));
  });
}

test("parsed authority is materialized before cloning, not reread through mutable identity getters", () => {
  let reads = 0;
  const value = { ...authority(), get cartId() { return reads++ === 0 ? "synthetic-cart" : CANARY; } };
  const snapshot = withAuthority(journal(), value);
  const result = PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot).snapshot();
  assert.equal(result.creation?.couponAuthority?.cartId, "synthetic-cart");
  assert.equal(reads, 1);
});

test("bound input accessors cannot throw private errors on a later clone", () => {
  const snapshot = withAuthority(), input = snapshot.creation.input;
  let reads = 0;
  Object.defineProperty(snapshot.creation, "input", { enumerable: true, get() {
    if (reads++ === 0) return input;
    throw new Error(CANARY);
  } });
  conflict(() => PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot));
});

test("provider input changing its identity during cloning is rejected before dispatch", () => {
  const snapshot = withAuthority(); let reads = 0;
  Object.defineProperty(snapshot.creation.input, "currency", { enumerable: true,
    get() { return reads++ === 0 ? "BRL" : "USD"; } });
  conflict(() => PaymentIntentEntity.rehydrate(snapshot as PaymentIntentSnapshot));
});
