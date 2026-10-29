import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { CheckoutSession, Prisma } from "@prisma/client";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { applyEligibleIncentive, applyIncentiveCoupon, invalidateIncentiveCheckout,
  prepareProgressiveIncentivePayment, reviseIncentiveForPaymentReview, validateIncentivePayment } from "./incentive-execution-ledger.js";

// Source boundary tests only; explicit delegates are not SQL/fencing proof.
const merchantId = "synthetic-binding-ledger", sessionId = "synthetic-session", CANARY = "PRIVATE_BINDING_LEDGER_CANARY";
const key = "_storefrontCouponBinding";
const storedBinding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, cartId: "synthetic-cart",
  checkoutSessionId: sessionId, buyerId: "synthetic-buyer", reservationBuyerId: null, redemptionId: "synthetic-redemption",
  couponId: "synthetic-coupon", discountCents: 100, basisHash: "ab".repeat(32), state: "active" };
const privateValues = [{ label: "valid-active", value: storedBinding }, { label: "null", value: null },
  { label: "undefined", value: undefined }, { label: "malformed", value: { privatePayload: CANARY } }];

function flags(t: TestContext, enabled = true) {
  const values = { REVENUE_INCENTIVE_EXECUTION_ENABLED: enabled ? "true" : "false",
    REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS: merchantId, REVENUE_COMMERCIAL_MODES_ENABLED: "true", REVENUE_COMMERCIAL_MODES_MERCHANT_IDS: merchantId };
  const before = Object.keys(values).map(name => [name, process.env[name]] as const);
  Object.assign(process.env, values);
  t.after(() => { for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
}

function row(value?: unknown, present = true): CheckoutSession {
  const cart = { cart_ref: "synthetic-cart", items: [{ sku: "SKU", variantId: "variant", name: "Item", price: 10, quantity: 1 }],
    total: 10, currentDiscount: 1, currency: "BRL", source: "storefront", commercialNudge: { ruleId: "assignment", kind: "coupon" },
    ...(present ? { [key]: value } : {}) };
  return { id: "row", merchantId, sessionId, globalUserId: "synthetic-buyer", conversationId: "synthetic-conversation",
    cart: cart as unknown as Prisma.JsonValue, customer: null, shipping: { customerPrice: 1, realCost: 1 }, shippingOptions: null,
    abandonmentScore: 0, triggerAgent: false, chatHistory: [], paymentMethod: null, promptVariantId: null, cohort: "treatment",
    featuresApplied: null, aiCostCents: 0, strategyContextVersion: 0, version: 1, createdAt: new Date(0), updatedAt: new Date(0) };
}

function fixture(stored: CheckoutSession) {
  const reads: string[] = [], effects: string[] = [];
  let assignmentPresent = true;
  const assignment = { id: "assignment", reservationId: "reservation", amountCents: 100 };
  const reservation = { id: "reservation", merchantId, status: "reserved", amountCents: 100 };
  const write = async (name: string) => { effects.push(name); throw new Error("synthetic_unexpected_incentive_write"); };
  const tx = {
    async $queryRaw(parts: TemplateStringsArray) { reads.push(parts.join("?").includes("clock_timestamp") ? "clock" : "lock"); return [{ now: new Date(1000) }]; },
    checkoutSession: {
      async findUnique() { reads.push("raw-session"); return stored; },
      async findUniqueOrThrow() { reads.push("raw-session"); return stored; },
      async update() { return write("checkout-update"); },
    },
    strategyIncentiveExecution: { async findFirst() { reads.push("execution"); return null; } },
    strategyIncentiveAssignment: {
      async findUnique() { reads.push("assignment"); return assignmentPresent ? assignment : null; },
      async create() { return write("assignment-create"); },
    },
    strategyIncentiveReservation: {
      async findUniqueOrThrow() { reads.push("reservation"); return reservation; },
      async findFirst() { reads.push("reservation"); return reservation; },
      async update() { return write("reservation-update"); },
    },
    strategyIncentiveStageGrant: { async findFirst() { reads.push("stage"); return null; }, async create() { return write("stage-create"); } },
    strategyIncentiveBudget: { async update() { return write("budget-update"); } },
    checkoutEvent: { async create() { return write("event-create"); } },
    paymentIntent: { async count() { reads.push("payment-count"); return 0; } },
    couponRedemption: { async count() { reads.push("coupon-count"); return 0; } },
    acceptedOffer: { async count() { reads.push("offer-count"); return 0; } },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, reads, effects, noAssignment: () => { assignmentPresent = false; } };
}
const snapshot = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "synthetic-binding-guard",
  amountCents: 1000, currency: "BRL", method: "pix" }).snapshot();
function fixedConflict(error: unknown): boolean {
  assert.ok(error instanceof Error); assert.equal(error.message, "checkout_coupon_binding_conflict");
  assert.equal("cause" in error, false); assert.equal(`${error.stack}\n${JSON.stringify(error)}`.includes(CANARY), false);
  return true;
}

for (const { label, value } of privateValues) {
  test(`eligible optional grant opts out of RAW ${label} binding before any authority/budget lookup`, async t => {
    flags(t); const stored = row(value), before = structuredClone(stored), f = fixture(stored);
    assert.equal(await applyEligibleIncentive(f.tx, stored), stored);
    assert.deepEqual(stored, before); assert.deepEqual(f.effects, []); assert.deepEqual(f.reads, []);
  });

  for (const command of ["prepare", "coupon", "invalidate", "revise", "payment-validation"] as const) {
    test(`${command} refuses RAW ${label} binding before mutating grants/reservations/cart`, async t => {
      flags(t); const stored = row(value), before = structuredClone(stored), f = fixture(stored);
      const work = command === "prepare" ? () => prepareProgressiveIncentivePayment(f.tx, merchantId, sessionId, "pix")
        : command === "coupon" ? () => applyIncentiveCoupon(f.tx, stored, { executionId: "execution", code: "CODE" })
        : command === "invalidate" ? () => invalidateIncentiveCheckout(f.tx, merchantId, sessionId)
        : command === "revise" ? () => reviseIncentiveForPaymentReview(f.tx, merchantId, sessionId)
        : () => validateIncentivePayment(f.tx, snapshot);
      await assert.rejects(work(), fixedConflict);
      assert.deepEqual(f.effects, []); assert.deepEqual(stored, before);
      assert.equal(f.reads.includes("reservation"), false, "private guard must precede reservation/budget work");
      assert.equal(f.reads.includes("stage"), false); assert.equal(f.reads.includes("clock"), false);
    });
  }
}

test("disabled optional grant keeps an existing RAW binding untouched without looking up eligibility", async t => {
  flags(t, false); const stored = row(storedBinding), f = fixture(stored);
  assert.equal(await applyEligibleIncentive(f.tx, stored), stored);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.effects, []);
});

test("unbound optional grant still evaluates the real enabled eligibility path", async t => {
  flags(t); const stored = row(undefined, false), f = fixture(stored);
  assert.equal(await applyEligibleIncentive(f.tx, stored), stored);
  assert.deepEqual(f.reads, ["clock", "execution"]); assert.deepEqual(f.effects, []);
});

test("unbound no-assignment transitions keep their existing no-op behavior", async t => {
  flags(t); const stored = row(undefined, false);
  for (const command of ["prepare", "coupon", "invalidate", "revise", "payment-validation"] as const) {
    const f = fixture(stored); f.noAssignment();
    if (command === "prepare") assert.equal(await prepareProgressiveIncentivePayment(f.tx, merchantId, sessionId, "pix"), stored);
    else if (command === "coupon") assert.equal(await applyIncentiveCoupon(f.tx, stored, { executionId: "execution", code: "CODE" }), null);
    else if (command === "invalidate") assert.equal(await invalidateIncentiveCheckout(f.tx, merchantId, sessionId), undefined);
    else if (command === "revise") assert.equal(await reviseIncentiveForPaymentReview(f.tx, merchantId, sessionId), undefined);
    else assert.equal(await validateIncentivePayment(f.tx, snapshot), undefined);
    assert.deepEqual(f.effects, []);
  }
});
