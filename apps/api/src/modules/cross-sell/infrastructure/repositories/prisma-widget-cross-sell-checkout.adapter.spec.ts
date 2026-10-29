import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaWidgetCrossSellCheckoutAdapter } from "./prisma-widget-cross-sell-checkout.adapter.js";
import type { ProductPromotionCandidate } from "../../../catalog/domain/services/best-product-promotion.service.js";
import type { OwnDeliveryConfig } from "../../../shipping/domain/ports/own-delivery-config.port.js";
import { widgetCrossSellCheckoutProjectedCartSchema } from "../../domain/contracts/widget-cross-sell-checkout-projection.schemas.js";
import { widgetCrossSellCheckoutCustomerAcknowledgementSchema, widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCheckoutManualShippingSnapshotSchema } from "../../domain/contracts/widget-cross-sell-checkout-shipping.schemas.js";
import { readAcceptedWidgetCheckoutInTransaction } from "./widget-checkout-accepted-reader.js";
import { widgetPaymentAuthorityFixture } from "../../../payment/domain/widget-checkout-payment.fixture.js";
import { widgetCheckoutRevisionContextHash } from "./widget-cross-sell-checkout-revision.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";

// Explicit rollback/serialization delegates, NOT a PostgreSQL or PSP proof.
const scope = { merchantId: "merchant", sessionId: "checkout" };
const request = { suggestionId: "suggestion", variantId: "target", quantity: 1 };
const at = new Date("2026-10-20T12:00:00.000Z");
const option = { id: "large", name: "Grande", priceModifierInCents: 500 };
const contact = { fullName: "Synthetic Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" };
const deliveryAddress = { zip: "01310100", street: "Synthetic Street", number: "10", complement: "",
  neighborhood: "Synthetic District", city: "Synthetic City", state: "SP" };
function catalogRow(id: string, sku: string, price: number) {
  return { id, sku, isActive: true, product: { id: `${id}-product`, merchantId: "merchant", name: `Product ${id}`, type: "physical",
    isActive: true, deletedAt: null, metadata: {}, categoryId: null },
    price: { variantId: id, basePriceInCents: price, currency: "BRL" }, stock: [{ quantity: 100, reserved: 0 }],
    weightGrams: null as number | null, heightCm: null as number | null, widthCm: null as number | null, lengthCm: null as number | null,
    media: [] as Array<{ url: string }> };
}
function fixture() {
  let state = { session: { id: "row", ...scope, version: 4, strategyContextVersion: 2, shipping: null as unknown,
    shippingOptions: null as unknown, globalUserId: "buyer", customer: null as Record<string, unknown> | null,
    cart: { currency: "BRL", total: 100, items: [{ sku: "TRIGGER", name: "Original", price: 100, quantity: 1 }] } as Record<string, unknown> },
    suggestion: { id: "suggestion", ...scope, promoId: "promo", status: "pending", rankedItems: ["TARGET"] },
    outbox: [] as unknown[], events: [] as unknown[] };
  const calls: string[] = [];
  const payments: Array<Record<string, unknown>> = [];
  const rows = [catalogRow("trigger", "TRIGGER", 10000), catalogRow("target", "TARGET", 2000)];
  const promotion = { id: "promo", merchantId: "merchant", updatedAt: new Date("2026-10-20T00:00:00.000Z"), status: "active",
    startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: null as Date | null, recommendedSkus: ["TARGET"],
    discountPercent: new Prisma.Decimal(10), maxDiscountPercent: new Prisma.Decimal(100), trigger: { sku_in_cart: ["TRIGGER"] } };
  const faults = { payment: false, order: false, chat: false, coupon: false, assignment: false, reservation: false,
    abandoned: false, checkoutCas: false, suggestionCas: false, outbox: false, event: false, clock: false, commitUnknown: false,
    postWriteVersion:false };
  const ceiling = { value: 20 };
  const productPromotions: ProductPromotionCandidate[] = [];
  const clock = { value: at };
  const shippingRules = { allowFreeShipping: false, allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 0, maxShippingSubsidy: 0, blockedRegions: [] as string[] };
  const manual = { value: { id: "manual", merchantId: "merchant", enabled: true, mode: "flat", flatPriceCents: 900,
    freeAboveCents: null, neighborhoods: null, radiusZones: null, estimatedValue: 60, estimatedUnit: "minutes" } as OwnDeliveryConfig | null };
  let serialization = Promise.resolve();
  const prisma = { async $transaction<T>(work: (tx: unknown) => Promise<T>, config: unknown): Promise<T> {
    calls.push("transaction"); assert.deepEqual(config, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
    const previous = serialization; let release!: () => void;
    serialization = new Promise<void>(resolve => { release = resolve; }); await previous;
    const draft = structuredClone(state);
    let wroteCheckout=false;
    const tx = {
      async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
        const sql = parts.join("?").replace(/\s+/g, " ").trim(); calls.push(sql);
        if (sql.includes("clock_timestamp")) { if (faults.clock) throw new Error("clock_failure"); return [{ now: clock.value }]; }
        if (sql.includes("FROM merchants")) return [{ id: "merchant" }];
        assert.ok(values.includes("merchant") || sql.includes("pg_advisory_xact_lock"), sql);
        return [];
      },
      checkoutSession: {
        async findUnique(args?: { select?: Record<string, boolean> }) {
          calls.push("session-read"); const row = structuredClone(draft.session);
          if(faults.postWriteVersion&&wroteCheckout)row.version++;
          return args?.select ? Object.fromEntries(Object.entries(args.select).filter(([, included]) => included)
            .map(([key]) => [key, (row as Record<string, unknown>)[key]])) : row;
        },
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push("cart-write"); assert.deepEqual(args.where, { id: "row", ...scope, version: draft.session.version });
          if (faults.checkoutCas) return { count: 0 };
          wroteCheckout=true;
          draft.session.cart = structuredClone(args.data.cart as Record<string, unknown>); draft.session.version++;
          assert.equal(Object.hasOwn(args.data,"version"),false,"CHECKOUT_SESSION_VERSION_READ_ONLY");
          assert.equal(Object.hasOwn(args.data,"strategyContextVersion"),false,"STRATEGY_CONTEXT_VERSION_DB_OWNED");
          if (args.data.shipping === Prisma.DbNull) draft.session.shipping = null;
          else if (args.data.shipping !== undefined) draft.session.shipping = structuredClone(args.data.shipping);
          if (args.data.shippingOptions === Prisma.DbNull) draft.session.shippingOptions = null;
          else if (args.data.shippingOptions !== undefined) draft.session.shippingOptions = structuredClone(args.data.shippingOptions);
          if (args.data.customer !== undefined) draft.session.customer = structuredClone(args.data.customer as Record<string, unknown>);
          if (args.data.globalUserId !== undefined) draft.session.globalUserId = String(args.data.globalUserId);
          return { count: 1 };
        },
      },
      crossSellSuggestion: {
        async findFirst() {
          calls.push("suggestion-read");
          const result = structuredClone(draft.suggestion) as typeof draft.suggestion & { computedDiscount?: number };
          return { ...result, ...(result.computedDiscount === undefined ? {} : { computedDiscount: new Prisma.Decimal(result.computedDiscount) }) };
        },
        async updateMany(args: { where: Record<string, unknown>; data: { status: string; rankedItems: string[]; resolvedAt: Date } }) {
          calls.push("suggestion-write"); assert.deepEqual(args.where, { id: "suggestion", ...scope, promoId: "promo", status: "pending" });
          if (faults.suggestionCas) return { count: 0 };
          Object.assign(draft.suggestion, args.data); return { count: 1 };
        },
      },
      paymentIntent: { async findFirst(args?: { where?: { id?: string | { not: string } } }) {
        calls.push("payment-read");
        const id = args?.where?.id;
        if (typeof id === "string") return structuredClone(payments.find(row => row.id === id) ?? null);
        const matching = payments.find(row => typeof id !== "object" || row.id !== id.not);
        return faults.payment ? { id: "payment" } : structuredClone(matching ?? null);
      } },
      completedOrder: { async findFirst() { return faults.order ? { id: "order" } : null; } },
      checkoutChatRequest: { async findFirst() { return faults.chat ? { id: "chat" } : null; } },
      couponRedemption: { async findFirst() { return faults.coupon ? { id: "coupon" } : null; } },
      strategyAssignment: { async findUnique() { return faults.assignment ? { id: "assignment" } : null; } },
      strategyIncentiveReservation: { async findFirst() { return faults.reservation ? { id: "reservation" } : null; } },
      merchant: { async findUnique() { return { id: "merchant", storeSettings: { company: { address: {
        zip: "01001000", city: "Synthetic City", state: "SP" } } } }; } },
      merchantRule: { async findUnique() { return { merchantId: "merchant", originZip: "01001000", maxDiscountPercent: new Prisma.Decimal(ceiling.value), ...shippingRules,
        freeShippingMinCartValue: new Prisma.Decimal(shippingRules.freeShippingMinCartValue),
        maxShippingSubsidy: new Prisma.Decimal(shippingRules.maxShippingSubsidy) }; } },
      ownDeliveryConfig: { async findUnique(args: { where: { merchantId: string } }) {
        calls.push("manual-config-read"); assert.deepEqual(args.where, { merchantId: scope.merchantId }); return structuredClone(manual.value);
      } },
      checkoutSetting: { async findUnique() { return { merchantId: "merchant", advancedRules: [] }; } },
      crossSellPromotion: { async findFirst() { return promotion; } },
      productPromotion: { async findMany() { return productPromotions; } },
      productVariant: { async findMany(args: { where: { sku?: string | { in: string[] } } }) {
        calls.push("catalog-read"); const skus = args.where.sku;
        return typeof skus === "string" ? rows.filter(row => row.sku === skus) : skus ? rows.filter(row => skus.in.includes(row.sku)) : rows;
      } },
      checkoutEvent: {
        async findFirst(args?: { where: { eventName?: string; id?: string } }) {
          if (args?.where.eventName === "cross_sell_accepted") return structuredClone(draft.events[0] ?? null);
          if (["cross_sell_checkout_customer_updated", "cross_sell_checkout_address_updated", "cross_sell_checkout_email_verified", "cross_sell_checkout_email_otp_issued", "cross_sell_checkout_manual_shipping_quoted", "cross_sell_checkout_manual_shipping_selected"].includes(args?.where.eventName ?? ""))
            return structuredClone(draft.events.find(event => (event as { id?: string }).id === args?.where.id) ?? null);
          return faults.abandoned ? { id: "closed" } : null;
        },
        async create(args: { data: unknown }) { calls.push("event-write"); if (faults.event) throw new Error("event_failure"); draft.events.push(args.data); },
      },
      outboxMessage: {
        async findFirst(args: { where: { merchantId: string; eventId: string } }) {
          assert.equal(args.where.merchantId, scope.merchantId); assert.ok(args.where.eventId);
          return structuredClone(draft.outbox.find(row => (row as { eventId?: string }).eventId === args.where.eventId) ?? null);
        },
        async create(args: { data: unknown }) { calls.push("outbox-write"); if (faults.outbox) throw new Error("outbox_failure"); draft.outbox.push(args.data); },
        async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
          calls.push("outbox-write"); if (faults.outbox) throw new Error("outbox_failure");
          const matches = draft.outbox.filter(row => Object.entries(args.where).every(([key, value]) => (row as Record<string, unknown>)[key] === value));
          for (const row of matches) Object.assign(row as object, args.data); return { count: matches.length };
        },
      },
    };
    try {
      const result = await work(tx); state = draft;
      if (faults.commitUnknown) throw new Error("commit_outcome_unknown");
      return result;
    } finally { release(); }
  } };
  const adapter = new PrismaWidgetCrossSellCheckoutAdapter(prisma as unknown as PrismaClient);
  return { adapter, state: () => structuredClone(state), mutate: (work: (value: typeof state) => void) => work(state), rows, calls, faults, promotion, ceiling, productPromotions, manual, clock, shippingRules,
    payments, readPaymentCheckout: (options?: { ownPaymentIntentId?: string }) => prisma.$transaction(
      tx => readAcceptedWidgetCheckoutInTransaction(tx as Prisma.TransactionClient, scope, options),
      { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 }) };
}
const noWrites = (calls: string[]) => assert.ok(!calls.some(call => ["cart-write", "suggestion-write", "event-write", "outbox-write"].includes(call)), calls.join("\n"));

test("private acceptance requires the actual DB-owned increment before receipt ACK",async()=>{
  const f=fixture(),quote=await f.adapter.quote(scope,request),before=f.state();f.faults.postWriteVersion=true;
  await assert.rejects(f.adapter.accept(scope,{expectedQuote:quote}));assert.deepEqual(f.state(),before);
});
for(const operation of ["customer","address","manual_quote"]as const)test(`private ${operation} refuses a false actual post-write version before ACK`,async()=>{
  const f=await manualQuoteFixture(),before=f.state();f.faults.postWriteVersion=true;
  const command=operation==="customer"?f.adapter.updateCustomer(scope,{expectedVersion:5,customer:contact}):operation==="address"
    ?f.adapter.updateAddress(scope,{expectedVersion:5,address:deliveryAddress}):f.adapter.quoteManualShipping(scope,{expectedVersion:5});
  await assert.rejects(command);assert.deepEqual(f.state(),before);
});
test("private manual selection verifies actual increment before acknowledging shipping selection",async()=>{
  const f=await manualSelectionFixture(),before=f.state();f.faults.postWriteVersion=true;
  await assert.rejects(f.adapter.selectManualShipping(scope,f.selection));assert.deepEqual(f.state(),before);
});

async function manualQuoteFixture() {
  const f = fixture();
  f.mutate(state => { state.session.customer = { ...contact, address: deliveryAddress, address_verified: true }; });
  await f.adapter.accept(scope, { expectedQuote: await f.adapter.quote(scope, request) });
  f.calls.length = 0;
  return f;
}
async function manualSelectionFixture() {
  const f = await manualQuoteFixture(); await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 }); f.calls.length = 0;
  const snapshot = widgetCheckoutManualShippingSnapshotSchema.parse(f.state().session.shippingOptions);
  return { ...f, selection: { expectedVersion: 6, quoteId: snapshot.id, carrierKey: snapshot.options[0]!.carrier_key } };
}
async function issuedOtpFixture() {
  const f = await manualQuoteFixture(), issued = await f.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" });
  f.calls.length = 0; return { ...f, issued };
}

async function ownPaymentFixture() {
  const f = fixture();
  f.mutate(state => { state.session.customer = { ...contact, email_verified: true, address: deliveryAddress, address_verified: true }; });
  await f.adapter.accept(scope, { expectedQuote: await f.adapter.quote(scope, request) });
  await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const saved = widgetCheckoutManualShippingSnapshotSchema.parse(f.state().session.shippingOptions);
  await f.adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: saved.id, carrierKey: saved.options[0]!.carrier_key });
  const canonical = await f.readPaymentCheckout();
  assert.ok(canonical.selectedShipping);
  const journal = widgetPaymentAuthorityFixture();
  Object.assign(journal.authority, { checkoutVersion: canonical.stored.version, acceptanceEventId: canonical.receipt.eventId,
    revisionEventId: canonical.receipt.revision!.eventId, contextHash: widgetCheckoutRevisionContextHash(canonical.stored),
    basisHash: paymentCartFingerprint({ cart: canonical.projectedCart, shipping: canonical.selectedShipping }) });
  Object.assign(journal.authority.frozenProjection, { cart: canonical.projectedCart, shipping: canonical.selectedShipping });
  journal.authority.amountBreakdown.cartFingerprint = journal.authority.basisHash;
  const payment: Record<string, unknown> = { ...journal.scope, version: 1, status: "pending", providerPaymentId: null,
    approvedAmountCents: null, acceptedOfferId: null, commerceOrderId: null };
  f.payments.push(payment); f.calls.length = 0;
  return { ...f, journal, payment };
}

test("transactional payment reader excludes ONLY the independently proved ready own journal", async () => {
  const f = await ownPaymentFixture();
  await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
  f.calls.length = 0;
  const canonical = await f.readPaymentCheckout({ ownPaymentIntentId: f.journal.authority.paymentId });
  assert.equal(canonical.projectedCart.total, 118); assert.equal(canonical.selectedShipping?.customerPrice, 9);
  noWrites(f.calls);
  const configLock = f.calls.findIndex(call => call.includes("own_delivery_configs"));
  const sessionLock = f.calls.findIndex(call => call.includes("checkout_sessions"));
  assert.ok(configLock >= 0 && sessionLock > configLock);
  f.payments.push({ id: "other-active" }); f.calls.length = 0;
  await assert.rejects(f.readPaymentCheckout({ ownPaymentIntentId: f.journal.authority.paymentId }), /cross_sell_quote_review_required/);
  noWrites(f.calls);
});

for (const corruption of ["id", "buyer", "version", "acceptance", "context", "shipping", "started", "missing", "catalog"] as const)
  test(`transactional payment reader refuses own-journal bypass ${corruption}`, async () => {
    const f = await ownPaymentFixture();
    if (corruption === "buyer") f.mutate(state => { state.session.globalUserId = "foreign"; });
    if (corruption === "version") f.mutate(state => { state.session.version++; });
    if (corruption === "acceptance") f.journal.authority.acceptanceEventId = "foreign";
    if (corruption === "context") f.mutate(state => { state.session.customer!.phone = "11911111111"; });
    if (corruption === "shipping") f.journal.authority.frozenProjection.shipping.customerPrice = 8;
    if (corruption === "started") Reflect.set(f.payment.creation as object, "firstAttemptAt", at.toISOString());
    if (corruption === "missing") f.payments.length = 0;
    if (corruption === "catalog") f.rows[1]!.price.basePriceInCents++;
    f.calls.length = 0;
    await assert.rejects(f.readPaymentCheckout({ ownPaymentIntentId: corruption === "id" ? "foreign" : f.journal.authority.paymentId }), /cross_sell_quote_review_required/);
    noWrites(f.calls);
  });
test("accepted OTP issuance commits challenge/revision/reference only, never sends or verifies", async () => {
  const f = await issuedOtpFixture(), saved = f.state();
  assert.deepEqual(f.issued, { version: 1, ...scope, deliveryId: saved.session.customer!.otp_delivery_id, persistenceVersion: 6, status: "pending" });
  assert.match(String(saved.session.customer!.otp_code), /^[1-9]\d{5}$/); assert.equal(saved.session.customer!.otp_issued_at, at.toISOString());
  assert.equal(saved.session.customer!.otp_expires_at, "2026-10-20T12:10:00.000Z"); assert.notEqual(saved.session.customer!.email_verified, true);
  assert.equal(saved.outbox.length, 2); assert.equal((saved.outbox[1] as { status: string }).status, "otp_pending");
  assert.equal(widgetCrossSellCheckoutReceiptSchema.parse(saved.session.cart._widgetCrossSellAcceptance).revision?.operation, "email_otp_issue");
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  for (const value of [contact.email, String(saved.session.customer!.otp_code), deliveryAddress.zip]) {
    assert.ok(!JSON.stringify(f.issued).includes(value)); assert.ok(!JSON.stringify(saved.outbox[1]).includes(value));
    assert.ok(!JSON.stringify(saved.events[1]).includes(value));
  }
});
test("accepted OTP issue reuses unexpired tracked challenge without renewing or duplicating", async () => {
  const f = await issuedOtpFixture(), before = f.state();
  assert.deepEqual(await f.adapter.requestEmailOtp(scope, { expectedVersion: 6, action: "issue" }), f.issued);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
});
test("accepted OTP claim commits exactly once and does not increment commercial version", async () => {
  const f = await issuedOtpFixture(), request = { expectedVersion: 6, deliveryId: f.issued.deliveryId };
  const claim = await f.adapter.claimEmailOtpDelivery(scope, request);
  assert.equal(claim.kind, "claimed"); if (claim.kind !== "claimed") assert.fail("must claim");
  assert.equal(claim.email, contact.email); assert.equal(claim.code, f.state().session.customer!.otp_code);
  assert.equal(f.state().session.version, 6); assert.equal((f.state().outbox[1] as { status: string }).status, "otp_sending");
  const replay = await f.adapter.claimEmailOtpDelivery(scope, request); assert.equal(replay.kind, "settled");
  if (replay.kind === "settled") assert.equal(replay.status, "unknown");
});
for (const outcome of ["sent", "unknown"] as const) test(`accepted OTP completion ${outcome} persists old attempt even after catalog changes`, async () => {
  const f = await issuedOtpFixture(), claim = await f.adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: f.issued.deliveryId });
  if (claim.kind !== "claimed") assert.fail("must claim"); f.rows[1]!.price.basePriceInCents++;
  const ack = await f.adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken,
    outcome: outcome === "sent" ? { status: "sent", providerMessageId: "synthetic-provider-id" } : { status: "unknown" } });
  assert.equal(ack.status, outcome); assert.equal(f.state().session.version, 6); assert.notEqual(f.state().session.customer!.email_verified, true);
  assert.equal((f.state().outbox[1] as { status: string }).status, `otp_${outcome}`);
  assert.ok(!JSON.stringify(f.state().outbox).includes("synthetic-provider-id"));
});
for (const state of ["pending", "sending", "sent", "unknown"] as const)
  test(`new tracked OTP verifies correct code only after durable attempt, status=${state}`, async () => {
    const f = await issuedOtpFixture();
    if (state !== "pending") {
      const claim = await f.adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: f.issued.deliveryId });
      if (claim.kind !== "claimed") assert.fail("must claim");
      if (state !== "sending") await f.adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken,
        outcome: state === "sent" ? { status: "sent", providerMessageId: "synthetic" } : { status: "unknown" } });
    }
    f.calls.length = 0; const code = String(f.state().session.customer!.otp_code), verifying = f.adapter.verifyEmailOtp(scope, { expectedVersion: 6, code });
    if (state === "pending") { await assert.rejects(verifying); noWrites(f.calls); }
    else {
      await verifying; assert.equal(f.state().session.customer!.email_verified, true); assert.equal(f.state().session.customer!.otp_delivery_id, undefined);
      assert.equal(f.state().session.customer!.otp_delivery_email, undefined); assert.equal(f.state().session.customer!.otp_issued_at, undefined);
      assert.equal((f.state().outbox[1] as { status: string }).status, `otp_${state}`); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
    }
  });
test("explicit OTP resend supersedes only pending challenge atomically", async () => {
  const f = await issuedOtpFixture(); f.clock.value = new Date(at.getTime() + 60_000);
  const second = await f.adapter.requestEmailOtp(scope, { expectedVersion: 6, action: "resend" });
  assert.notEqual(second.deliveryId, f.issued.deliveryId); assert.equal(second.persistenceVersion, 7);
  assert.equal((f.state().outbox[1] as { status: string }).status, "otp_cancelled"); assert.equal((f.state().outbox[2] as { status: string }).status, "otp_pending");
  assert.equal(f.state().session.customer!.otp_expires_at, "2026-10-20T12:11:00.000Z");
  f.calls.length = 0; await assert.rejects(f.adapter.claimEmailOtpDelivery(scope, { expectedVersion: 7, deliveryId: f.issued.deliveryId })); noWrites(f.calls);
});
test("changing email cancels pending OTP and clears tracked credentials with the revision", async () => {
  const f = await issuedOtpFixture(); await f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, email: "other@example.test" } });
  assert.equal((f.state().outbox[1] as { status: string }).status, "otp_cancelled");
  for (const key of ["otp_code", "otp_expires_at", "otp_delivery_id", "otp_delivery_email", "otp_issued_at"]) assert.equal(f.state().session.customer![key], undefined);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("email correction preserves uncertain old send, whose completion cannot verify new identity", async () => {
  const f = await issuedOtpFixture(), claim = await f.adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: f.issued.deliveryId });
  if (claim.kind !== "claimed") assert.fail("must claim");
  await f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, email: "other@example.test" } });
  assert.equal((f.state().outbox[1] as { status: string }).status, "otp_sending");
  await f.adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: { status: "sent", providerMessageId: "synthetic" } });
  assert.equal(f.state().session.customer!.email, "other@example.test"); assert.equal(f.state().session.customer!.email_verified, false);
  f.calls.length = 0; await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 7, code: claim.code })); noWrites(f.calls);
});
for (const fault of ["checkoutCas", "event", "outbox"] as const) test(`OTP issuance ${fault} rolls back challenge/receipt/journal/event`, async () => {
  const f = await manualQuoteFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" })); assert.deepEqual(f.state(), before);
});
test("same-version OTP requests serialize to one new challenge; lost response cannot repeat", async () => {
  const f = await manualQuoteFixture(); const results = await Promise.allSettled([
    f.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }), f.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }),
  ]); assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state().outbox.length, 2);
  const g = await manualQuoteFixture(); g.faults.commitUnknown = true;
  await assert.rejects(g.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }), /commit_outcome_unknown/); g.faults.commitUnknown = false;
  assert.equal(g.calls.filter(call => call === "transaction").length, 1); assert.equal((await g.adapter.readAccepted(scope)).total, 118);
  g.calls.length = 0; await assert.rejects(g.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" })); noWrites(g.calls);
});
for (const field of ["email", "code", "expiresAt", "receipt", "cart", "deliveryId"])
  test(`OTP issuance refuses body authority ${field} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue", [field]: {} })); assert.deepEqual(f.calls, []);
  });
test("manual selection validates server quote, preserves accepted goods and reads a strict canonical shipping projection", async () => {
  const f = await manualSelectionFixture(), before = f.state();
  const ack = await f.adapter.selectManualShipping(scope, f.selection);
  assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 7 });
  const saved = f.state(), shipping = await f.adapter.readAcceptedShipping(scope);
  assert.deepEqual(shipping, { customerPrice: 9, carrier: "own_delivery_flat", method: "Entrega própria", deliveryDays: 1,
    destinationZip: deliveryAddress.zip, region: "SP" });
  assert.equal(saved.session.version, 7); assert.deepEqual(saved.session.shippingOptions, before.session.shippingOptions);
  assert.equal((saved.session.shipping as Record<string, unknown>).realCost, undefined);
  assert.equal(widgetCrossSellCheckoutReceiptSchema.parse(saved.session.cart._widgetCrossSellAcceptance).revision?.operation, "manual_shipping_select");
  assert.equal((await f.adapter.readAccepted(scope)).total, 118); assert.deepEqual(saved.outbox, before.outbox);
  assert.deepEqual(saved.suggestion, before.suggestion);
  assert.equal((saved.events[2] as { eventName: string }).eventName, "cross_sell_checkout_manual_shipping_selected");
});
for (const change of ["expired", "expiry-boundary", "config-price", "config-disabled", "config-mode", "config-threshold", "config-eta", "blocked-region", "quote-id", "carrier", "stale-version", "catalog"])
  test(`manual selection refuses stale/unproven ${change} without paid fallback`, async () => {
    const f = await manualSelectionFixture(), request = { ...f.selection };
    if (change === "expired") f.clock.value = new Date(at.getTime() + 1_800_001);
    if (change === "expiry-boundary") f.clock.value = new Date(at.getTime() + 1_800_000);
    if (change === "config-price") f.manual.value!.flatPriceCents = 901;
    if (change === "config-disabled") f.manual.value!.enabled = false;
    if (change === "config-mode") Object.assign(f.manual.value!, { mode: "neighborhood", neighborhoods: [{ name: deliveryAddress.neighborhood, priceCents: 900 }] });
    if (change === "config-threshold") f.manual.value!.freeAboveCents = 11800;
    if (change === "config-eta") f.manual.value!.estimatedValue = 2;
    if (change === "blocked-region") f.shippingRules.blockedRegions = ["SP"];
    if (change === "quote-id") request.quoteId = "00000000-0000-4000-8000-000000000000";
    if (change === "carrier") request.carrierKey = "PAC";
    if (change === "stale-version") request.expectedVersion = 5;
    if (change === "catalog") f.rows[1]!.price.basePriceInCents++;
    const before = f.state(); await assert.rejects(f.adapter.selectManualShipping(scope, request)); assert.deepEqual(f.state(), before); noWrites(f.calls);
  });
test("manual canonical shipping read revalidates expiry/config/rules, not just stored price", async () => {
  for (const change of ["expired", "config", "region", "selected-price", "missing-proof"]) {
    const f = await manualSelectionFixture(); await f.adapter.selectManualShipping(scope, f.selection);
    if (change === "expired") f.clock.value = new Date(at.getTime() + 1_800_000);
    if (change === "config") f.manual.value!.flatPriceCents = 1;
    if (change === "region") f.shippingRules.blockedRegions = ["SP"];
    if (change === "selected-price") f.mutate(s => { (s.session.shipping as Record<string, unknown>).customerPrice = 1; });
    if (change === "missing-proof") f.mutate(s => { s.session.shippingOptions = null; });
    const before = f.state(); f.calls.length = 0; await assert.rejects(f.adapter.readAcceptedShipping(scope)); assert.deepEqual(f.state(), before); noWrites(f.calls);
  }
});
for (const condition of ["allowed", "free-disabled", "stack-disabled", "subsidy", "minimum", "region"])
  test(`manual configured free delivery selection enforces ${condition} without inventing cost`, async () => {
    const f = await manualQuoteFixture(); f.manual.value!.freeAboveCents = 11800;
    Object.assign(f.shippingRules, { allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 9, freeShippingMinCartValue: 118 });
    await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 }); const snapshot = widgetCheckoutManualShippingSnapshotSchema.parse(f.state().session.shippingOptions);
    if (condition === "free-disabled") f.shippingRules.allowFreeShipping = false;
    if (condition === "stack-disabled") f.shippingRules.allowStackDiscountAndFreeShipping = false;
    if (condition === "subsidy") f.shippingRules.maxShippingSubsidy = 8.99;
    if (condition === "minimum") f.shippingRules.freeShippingMinCartValue = 118.01;
    if (condition === "region") f.shippingRules.blockedRegions = ["SP"];
    f.calls.length = 0; const selecting = f.adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: snapshot.id, carrierKey: snapshot.options[0]!.carrier_key });
    if (condition === "allowed") {
      await selecting; assert.equal((await f.adapter.readAcceptedShipping(scope))!.customerPrice, 0);
      assert.equal((await f.adapter.readAccepted(scope)).total, 118); assert.equal((f.state().session.shipping as Record<string, unknown>).realCost, undefined);
      f.shippingRules.allowFreeShipping = false; await assert.rejects(f.adapter.readAcceptedShipping(scope));
    } else { await assert.rejects(selecting); noWrites(f.calls); assert.equal(f.state().session.shipping, null); }
  });
test("manual zero tariff is not a shipping subsidy and unselected checkout has no shipping projection", async () => {
  const f = await manualQuoteFixture(); assert.equal(await f.adapter.readAcceptedShipping(scope), null);
  f.manual.value!.flatPriceCents = 0; await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const snapshot = widgetCheckoutManualShippingSnapshotSchema.parse(f.state().session.shippingOptions);
  await f.adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: snapshot.id, carrierKey: snapshot.options[0]!.carrier_key });
  assert.equal((await f.adapter.readAcceptedShipping(scope))!.customerPrice, 0);
});
for (const fault of ["checkoutCas", "event"] as const) test(`manual selection ${fault} rolls back selection/version/context/revision`, async () => {
  const f = await manualSelectionFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.selectManualShipping(scope, f.selection)); assert.deepEqual(f.state(), before);
});
for (const field of ["price", "shipping", "realCost", "address", "config", "cart", "snapshot", "is_free"])
  test(`manual selection rejects caller ${field} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.selectManualShipping(scope, { expectedVersion: 6,
      quoteId: "00000000-0000-4000-8000-000000000000", carrierKey: "own_delivery_flat", [field]: {} })); assert.deepEqual(f.calls, []);
  });
test("same-version selection/address concurrency commits one winner and address always invalidates selected tariff", async () => {
  const f = await manualSelectionFixture(); const results = await Promise.allSettled([
    f.adapter.selectManualShipping(scope, f.selection), f.adapter.updateAddress(scope, { expectedVersion: 6, address: { ...deliveryAddress, number: "99" } }),
  ]); assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const version = f.state().session.version;
  await f.adapter.updateAddress(scope, { expectedVersion: version, address: { ...deliveryAddress, number: "100" } });
  assert.equal(await f.adapter.readAcceptedShipping(scope), null); assert.equal(f.state().session.shippingOptions, null);
});
test("lost selection response is read-reconciled and replay cannot revise twice", async () => {
  const f = await manualSelectionFixture(); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.selectManualShipping(scope, f.selection), /commit_outcome_unknown/); f.faults.commitUnknown = false;
  assert.equal((await f.adapter.readAcceptedShipping(scope))!.customerPrice, 9);
  f.calls.length = 0; await assert.rejects(f.adapter.selectManualShipping(scope, f.selection)); noWrites(f.calls);
});
test("manual quote commits unselected fixed tariff and technical revision without changing accepted goods", async () => {
  const f = await manualQuoteFixture(), before = f.state();
  const ack = await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
  const saved = f.state(), receipt = widgetCrossSellCheckoutReceiptSchema.parse(saved.session.cart._widgetCrossSellAcceptance);
  const envelope = saved.session.shippingOptions as Record<string, unknown>;
  assert.equal(envelope.origin, "widget_checkout_manual"); assert.equal(envelope.merchantId, scope.merchantId);
  assert.equal(envelope.sessionId, scope.sessionId); assert.equal(envelope.buyerId, "buyer");
  assert.match(String(envelope.id), /^[a-f0-9-]{36}$/); assert.equal(envelope.acceptanceEventId, receipt.eventId);
  assert.equal(envelope.issuedAt, at.toISOString()); assert.equal(envelope.expiresAt, "2026-10-20T12:30:00.000Z");
  for (const field of ["basisHash", "destinationHash", "configHash"]) assert.match(String(envelope[field]), /^[a-f0-9]{64}$/);
  assert.deepEqual(envelope.options, [{ carrier_key: "own_delivery_flat", label: "Entrega própria", price: 900, eta_days: 1, is_free: false }]);
  assert.equal(saved.session.shipping, null); assert.equal(saved.session.version, 6); assert.equal(saved.session.strategyContextVersion, 2);
  assert.equal(receipt.revision?.operation, "manual_shipping_quote"); assert.equal(receipt.committedVersion, 5);
  assert.deepEqual(receipt.quote, (before.session.cart._widgetCrossSellAcceptance as Record<string, unknown>).quote);
  assert.deepEqual(saved.session.customer, before.session.customer); assert.deepEqual(saved.outbox, before.outbox);
  assert.deepEqual(saved.suggestion, before.suggestion); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  const event = saved.events[1] as { eventName: string };
  assert.equal(event.eventName, "cross_sell_checkout_manual_shipping_quoted");
  for (const value of [deliveryAddress.zip, deliveryAddress.street, contact.email, "123456"]) assert.ok(!JSON.stringify(event).includes(value));
  assert.ok(!JSON.stringify(envelope).includes(deliveryAddress.zip));
  assert.equal(f.calls.filter(call => call === "transaction").length, 2); // write + explicit read only
  const configLock = f.calls.findIndex(call => call.includes("FROM own_delivery_configs"));
  assert.ok(configLock > f.calls.findIndex(call => call.includes("FROM merchants")));
  assert.ok(configLock < f.calls.findIndex(call => call.includes("pg_advisory_xact_lock")));
  assert.ok(f.calls.indexOf("manual-config-read") > f.calls.indexOf("catalog-read"));
});
for (const neighborhood of [deliveryAddress.neighborhood, `  ${deliveryAddress.neighborhood.toUpperCase()}  `])
  test(`manual quote uses only exact owned neighborhood ${JSON.stringify(neighborhood)}`, async () => {
    const f = await manualQuoteFixture(); Object.assign(f.manual.value!, { mode: "neighborhood", neighborhoods: [
      { name: "Other cheaper district", priceCents: 1 }, { name: neighborhood, priceCents: 1375 }] });
    await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const envelope = f.state().session.shippingOptions as { options: Array<{ price: number }> };
    assert.equal(envelope.options.length, 1); assert.equal(envelope.options[0]!.price, 1375);
  });
for (const amount of [11799, 11800, 11801]) test(`manual free boundary uses discounted canonical goods subtotal at ${amount}`, async () => {
  const f = await manualQuoteFixture(); f.manual.value!.freeAboveCents = amount;
  await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const envelope = f.state().session.shippingOptions as { options: Array<{ price: number; original_price?: number; is_free: boolean }> };
  assert.equal(envelope.options[0]!.price, amount <= 11800 ? 0 : 900);
  assert.equal(envelope.options[0]!.is_free, amount <= 11800);
  assert.equal(envelope.options[0]!.original_price, amount <= 11800 ? 900 : undefined);
  assert.equal(f.state().session.shipping, null); // a free quotation is NOT subsidy admission
});
test("manual neighborhood without coverage persists empty options, never a fallback", async () => {
  const f = await manualQuoteFixture(); Object.assign(f.manual.value!, { mode: "neighborhood", neighborhoods: [{ name: "Not covered", priceCents: 1 }] });
  await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  assert.deepEqual((f.state().session.shippingOptions as { options: unknown[] }).options, []);
  assert.equal(f.state().session.shipping, null); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("manual requote reads changed configuration, creates a new identity and never refreshes by replay", async () => {
  const f = await manualQuoteFixture(); await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const first = f.state().session.shippingOptions as Record<string, unknown>;
  f.manual.value!.flatPriceCents = 1400; f.manual.value!.estimatedValue = 3; f.manual.value!.estimatedUnit = "days";
  await f.adapter.quoteManualShipping(scope, { expectedVersion: 6 });
  const second = f.state().session.shippingOptions as typeof first;
  assert.notEqual(second.id, first.id); assert.notEqual(second.configHash, first.configHash); assert.equal(second.basisHash, first.basisHash);
  assert.deepEqual(second.options, [{ carrier_key: "own_delivery_flat", label: "Entrega própria", price: 1400, eta_days: 3, is_free: false }]);
  f.calls.length = 0; await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 6 })); noWrites(f.calls);
});
for (const change of ["missing", "disabled", "foreign", "negative", "radius", "missing-address", "unconfirmed", "bad-address"])
  test(`manual quote refuses ${change} without stale/fallback mutation`, async () => {
    const f = await manualQuoteFixture(), before = f.state();
    if (change === "missing") f.manual.value = null;
    if (change === "disabled") f.manual.value!.enabled = false;
    if (change === "foreign") f.manual.value!.merchantId = "foreign";
    if (change === "negative") f.manual.value!.flatPriceCents = -1;
    if (change === "radius") Object.assign(f.manual.value!, { mode: "radius", radiusZones: [{ maxKm: 10, priceCents: 500 }] });
    if (change === "missing-address") f.mutate(s => { delete s.session.customer!.address; });
    if (change === "unconfirmed") f.mutate(s => { s.session.customer!.address_verified = false; });
    if (change === "bad-address") f.mutate(s => { s.session.customer!.address = { ...deliveryAddress, zip: "invalid" }; });
    const current = f.state();
    await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5 })); assert.deepEqual(f.state(), current); noWrites(f.calls);
    assert.deepEqual(f.state().outbox, before.outbox);
  });
for (const field of ["cart_total", "price", "config", "address", "destination_neighborhood", "quote", "shipping", "merchantId", "basisHash"])
  test(`manual quote rejects body authority ${field} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5, [field]: {} })); assert.deepEqual(f.calls, []);
  });
for (const fault of ["checkoutCas", "event"] as const) test(`manual quote ${fault} rolls back quote/selection/receipt/event`, async () => {
  const f = await manualQuoteFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5 })); assert.deepEqual(f.state(), before);
});
for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned", "clock"] as const)
  test(`manual quote retains ${fault} guard`, async () => {
    const f = await manualQuoteFixture(); f.faults[fault] = true;
    await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5 })); noWrites(f.calls);
  });
test("same-version manual quotation and address change have one winner", async () => {
  const f = await manualQuoteFixture(); const results = await Promise.allSettled([
    f.adapter.quoteManualShipping(scope, { expectedVersion: 5 }),
    f.adapter.updateAddress(scope, { expectedVersion: 5, address: { ...deliveryAddress, number: "99" } }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state().session.version, 6);
});
test("manual lost ACK has no retry; committed quote stays readable and stale repeat refuses", async () => {
  const f = await manualQuoteFixture(); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5 }), /commit_outcome_unknown/);
  assert.equal(f.calls.filter(call => call === "transaction").length, 1); f.faults.commitUnknown = false;
  assert.equal((await f.adapter.readAccepted(scope)).total, 118); assert.equal(f.state().session.version, 6);
  f.calls.length = 0; await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion: 5 })); noWrites(f.calls);
});
for (const change of ["options", "kind", "event", "event-kind"])
  test(`manual quote read refuses corrupted ${change}`, async () => {
    const f = await manualQuoteFixture(); await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    f.mutate(s => {
      if (change === "options") (s.session.shippingOptions as { options: Array<{ price: number }> }).options[0]!.price = 1;
      if (change === "kind") ((s.session.cart._widgetCrossSellAcceptance as Record<string, unknown>).revision as Record<string, unknown>).operation = "customer";
      if (change === "event") s.events.pop();
      if (change === "event-kind") (s.events[1] as Record<string, unknown>).eventName = "cross_sell_checkout_customer_updated";
    });
    f.calls.length = 0; await assert.rejects(f.adapter.readAccepted(scope)); noWrites(f.calls);
  });
test("address revision invalidates the entire manual quote; preserved contact cannot reprice it", async () => {
  const f = await manualQuoteFixture(); await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const quoted = f.state().session.shippingOptions;
  await f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, fullName: "New Synthetic Name" } });
  assert.deepEqual(f.state().session.shippingOptions, quoted); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  await f.adapter.updateAddress(scope, { expectedVersion: 7, address: { ...deliveryAddress, neighborhood: "Other district" } });
  assert.equal(f.state().session.shippingOptions, null); assert.equal(f.state().session.shipping, null);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
for (const expectedVersion of [0, -1, 1.5, 2_147_483_647, Number.NaN, "5", null, undefined])
  test(`manual quote rejects invalid expectedVersion ${String(expectedVersion)} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.quoteManualShipping(scope, { expectedVersion })); assert.deepEqual(f.calls, []);
  });
test("manual quote rejects foreign scope and stale goods without any writes", async () => {
  for (const change of ["merchant", "session", "catalog", "ceiling"]) {
    const f = await manualQuoteFixture();
    if (change === "catalog") f.rows[1]!.price.basePriceInCents++;
    if (change === "ceiling") f.ceiling.value = 0;
    await assert.rejects(f.adapter.quoteManualShipping({ merchantId: change === "merchant" ? "foreign" : scope.merchantId,
      sessionId: change === "session" ? "foreign" : scope.sessionId }, { expectedVersion: 5 })); noWrites(f.calls);
  }
});
test("manual quote output schema rejects malformed units/free claims/expiry/extra authority", async () => {
  const f = await manualQuoteFixture(); await f.adapter.quoteManualShipping(scope, { expectedVersion: 5 });
  const snapshot = widgetCheckoutManualShippingSnapshotSchema.parse(f.state().session.shippingOptions);
  const first = snapshot.options[0]!;
  for (const patch of [{ options: [{ ...first, price: 1.5 }] }, { options: [{ ...first, price: -1 }] },
    { options: [{ ...first, is_free: true }] }, { options: [{ ...first, price: 0, is_free: true }] },
    { options: [{ ...first, realCost: 1 }] }, { options: [{ ...first, eta_days: 0 }] },
    { expiresAt: snapshot.issuedAt }, { configHash: "fake" }, { address: deliveryAddress }])
    assert.equal(widgetCheckoutManualShippingSnapshotSchema.safeParse({ ...snapshot, ...patch }).success, false);
});

test("canonical quote reads after merchant/config/session locks and does not write", async () => {
  const f = fixture(), before = f.state(), quote = await f.adapter.quote(scope, request);
  assert.equal(quote.totalCents, 11800); assert.equal(quote.target.maximumUnitPriceCents, 1800);
  const merchant = f.calls.findIndex(call => call.includes("FROM merchants"));
  const anchor = f.calls.findIndex(call => call.includes("pg_advisory_xact_lock"));
  assert.ok(merchant >= 0 && anchor > merchant && f.calls.indexOf("session-read") > anchor);
  assert.ok(f.calls.findIndex(call => call.includes("clock_timestamp")) > f.calls.lastIndexOf("catalog-read"));
  assert.deepEqual(f.state(), before); noWrites(f.calls);
});
test("accept commits original base + private provenance + suggestion + event/outbox together", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request), ack = await f.adapter.accept(scope, { expectedQuote });
  const state = f.state(); assert.equal(ack.status, "accepted"); assert.equal(ack.persistenceVersion, 5);
  assert.equal(state.suggestion.status, "accepted"); assert.equal(state.session.version, 5);
  assert.equal(state.session.cart.total, 120); assert.equal(state.events.length, 1); assert.equal(state.outbox.length, 1);
  const receipt = state.session.cart._widgetCrossSellAcceptance as { eventId: string; origin: string; quote: typeof expectedQuote };
  assert.equal(receipt.eventId, ack.eventId); assert.equal(receipt.origin, "widget_checkout");
  assert.deepEqual(receipt.quote, expectedQuote);
});
for (const fault of ["checkoutCas", "suggestionCas", "event", "outbox"] as const) test(`${fault} failure rolls back every staged mutation`, async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.accept(scope, { expectedQuote })); assert.deepEqual(f.state(), before);
});
for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned", "clock"] as const) test(`${fault} refuses before any writes`, async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request); f.calls.length = 0; f.faults[fault] = true;
  await assert.rejects(f.adapter.accept(scope, { expectedQuote })); noWrites(f.calls);
});
test("stale checkout version refuses without retry or overwriting the current cart", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request); f.mutate(state => { state.session.version++; });
  f.calls.length = 0; await assert.rejects(f.adapter.accept(scope, { expectedQuote })); noWrites(f.calls);
  assert.equal(f.calls.filter(call => call === "transaction").length, 1);
});
test("concurrent accept delegates serialize and only one commits", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  const results = await Promise.allSettled([f.adapter.accept(scope, { expectedQuote }), f.adapter.accept(scope, { expectedQuote })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().outbox.length, 1); assert.equal(f.state().session.version, 5);
});
test("lost commit response has no retry and explicit repeat cannot add twice", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.accept(scope, { expectedQuote }), /commit_outcome_unknown/);
  assert.equal(f.state().session.version, 5); assert.equal(f.state().outbox.length, 1); f.faults.commitUnknown = false;
  await assert.rejects(f.adapter.accept(scope, { expectedQuote })); assert.equal(f.state().outbox.length, 1);
});
test("wrong merchant/session or unknown request fields refuse before transaction", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request); f.calls.length = 0;
  for (const foreign of [{ merchantId: "foreign", sessionId: "checkout" }, { merchantId: "merchant", sessionId: "foreign" }])
    await assert.rejects(f.adapter.accept(foreign, { expectedQuote }));
  await assert.rejects(f.adapter.quote(scope, { ...request, price: 1 })); assert.deepEqual(f.calls, []);
});
test("canonical metadata requires explicit options and discounts product + paid addition", async () => {
  const f = fixture(); f.rows[1]!.product.metadata = { optionGroups: [{ id: "size", name: "Tamanho", required: true,
    selectionType: "single", items: [option] }] };
  await assert.rejects(f.adapter.quote(scope, request));
  const quote = await f.adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
  assert.equal(quote.target.originalUnitPriceCents, 2500); assert.equal(quote.target.maximumUnitPriceCents, 2250);
});
test("catalog price/promotion version/stock changes after quote refuse without writes", async () => {
  for (const changed of ["price", "promotion", "stock"]) {
    const f = fixture(), expectedQuote = await f.adapter.quote(scope, request); f.calls.length = 0;
    if (changed === "price") f.rows[1]!.price.basePriceInCents++;
    else if (changed === "promotion") f.promotion.updatedAt = new Date("2026-10-20T00:00:01.000Z");
    else f.rows[1]!.stock[0]!.quantity = 0;
    await assert.rejects(f.adapter.accept(scope, { expectedQuote })); noWrites(f.calls);
  }
});
test("ambiguous target SKU, catalog tenant mismatch and existing target are not guessed", async () => {
  for (const changed of ["duplicate", "tenant", "present"]) {
    const f = fixture();
    if (changed === "duplicate") f.rows.push(catalogRow("other", "TARGET", 2000));
    else if (changed === "tenant") f.rows[1]!.product.merchantId = "foreign";
    else f.mutate(state => { state.session.cart.items = [{ sku: "TARGET", name: "Existing", price: 20, quantity: 1 }]; state.session.cart.total = 20; });
    await assert.rejects(f.adapter.quote(scope, request)); noWrites(f.calls);
  }
});

test("stock admission aggregates existing option lines of the same variant", async () => {
  const f = fixture(); f.rows[0]!.product.metadata = { optionGroups: [{ id: "size", name: "Tamanho", required: true,
    selectionType: "single", items: [{ id: "small", name: "Pequeno" }, { id: "medium", name: "Médio" }] }] };
  f.mutate(state => {
    state.session.cart.items = [["small", "Pequeno"], ["medium", "Médio"]].map(([id, name]) => ({ sku: "TRIGGER", price: 100, quantity: 99,
      variant: JSON.stringify(["trigger", [id]]), selected_options: [{ group_name: "Tamanho", item_name: name, price_modifier: 0 }] }));
    state.session.cart.total = 19800;
  });
  await assert.rejects(f.adapter.quote(scope, request)); noWrites(f.calls);
  f.rows[0]!.stock[0]!.quantity = 200;
  assert.equal((await f.adapter.quote(scope, request)).items.length, 3);
});

test("corrupt or unknown private provenance, coupon and negotiated discounts fail closed", async () => {
  for (const patch of [{ _storefrontCouponBinding: undefined }, { _widgetCrossSellAcceptance: null },
    { couponCode: "CUPOM" }, { currentDiscount: 1 }, { freeShipping: true }]) {
    const f = fixture(); f.mutate(state => { Object.assign(state.session.cart, patch); });
    await assert.rejects(f.adapter.quote(scope, request)); noWrites(f.calls);
  }
});

test("malformed metadata, missing price and unknown options never use inferred defaults", async () => {
  for (const changed of ["metadata", "price", "unknown_option"]) {
    const f = fixture();
    if (changed === "metadata") f.rows[1]!.product.metadata = { optionGroups: "invalid" };
    else if (changed === "price") Object.assign(f.rows[1]!, { price: null });
    await assert.rejects(f.adapter.quote(scope, changed === "unknown_option" ? { ...request, selectedOptionItemIds: ["unknown"] } : request));
    noWrites(f.calls);
  }
});

test("exact decimal percentages and company ceiling remain canonical, without costs", async () => {
  const f = fixture(); f.promotion.discountPercent = new Prisma.Decimal("12.3456");
  assert.equal((await f.adapter.quote(scope, request)).target.maximumUnitPriceCents, 1754);
  f.ceiling.value = 0; await assert.rejects(f.adapter.quote(scope, request)); noWrites(f.calls);
});

test("stale option label/modifier or submitted product identity cannot rebind the base", async () => {
  for (const patch of [{ product_id: "foreign" }, { variantId: "foreign" }, { originalPrice: 99 },
    { selected_options: [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 0 }] }]) {
    const f = fixture(); f.mutate(state => { Object.assign((state.session.cart.items as object[])[0]!, patch); });
    await assert.rejects(f.adapter.quote(scope, request)); noWrites(f.calls);
  }
});

test("request identity is detached before awaiting an earlier transaction", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request), accepted = f.adapter.accept(scope, { expectedQuote });
  expectedQuote.target.sku = "FORGED"; expectedQuote.checkoutBasis.items[0]!.baseUnitPriceCents = 1;
  const ack = await accepted; assert.equal(ack.status, "accepted");
  const receipt = f.state().session.cart._widgetCrossSellAcceptance as { quote: typeof expectedQuote };
  assert.equal(receipt.quote.target.sku, "TARGET"); assert.equal(receipt.quote.checkoutBasis.items[0]!.baseUnitPriceCents, 10000);
});

test("stock over-reservation in one warehouse cannot inflate total availability", async () => {
  const f = fixture(); f.rows[1]!.stock = [{ quantity: 0, reserved: 98 }, { quantity: 100, reserved: 0 }];
  await assert.rejects(f.adapter.quote(scope, { ...request, quantity: 3 })); noWrites(f.calls);
});

test("existing delivery dimensions/image survive the commercial addition", async () => {
  const f = fixture(); f.mutate(state => { Object.assign((state.session.cart.items as object[])[0]!, {
    weightGrams: 300, height_cm: 10, width_cm: 12, length_cm: 20, imageUrl: "https://example.test/existing.jpg" }); });
  const expectedQuote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote });
  const saved = (f.state().session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TRIGGER")!;
  assert.equal(saved.weightGrams, 300); assert.equal(saved.height_cm, 10);
  assert.equal(saved.width_cm, 12); assert.equal(saved.length_cm, 20); assert.equal(saved.imageUrl, "https://example.test/existing.jpg");
});

test("new target carries canonical delivery dimensions and catalog image", async () => {
  const f = fixture(); Object.assign(f.rows[1]!, { weightGrams: 500, heightCm: 10, widthCm: 15, lengthCm: 25,
    media: [{ url: "https://example.test/target.jpg" }] });
  const expectedQuote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote });
  const saved = (f.state().session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!;
  assert.equal(saved.weightGrams, 500); assert.equal(saved.height_cm, 10); assert.equal(saved.width_cm, 15);
  assert.equal(saved.length_cm, 25); assert.equal(saved.imageUrl, "https://example.test/target.jpg");
});

test("commercial addition invalidates an existing paid shipping quote atomically", async () => {
  const f = fixture(); f.mutate(state => { Object.assign(state.session, { shipping: { customerPrice: 12, carrier: "Synthetic" } }); });
  const expectedQuote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote });
  assert.equal(f.state().session.shipping, null);
});

test("accepted reader projects the canonical benefit without exposing private authority or writing", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  const ack = await f.adapter.accept(scope, { expectedQuote }), before = f.state(); f.calls.length = 0;
  const cart = await f.adapter.readAccepted(scope);
  assert.equal(cart.total, 118); assert.equal(cart.currentDiscount, 0);
  const target = cart.items.find(item => item.sku === "TARGET")!;
  assert.equal(target.price, 18); assert.equal(target.originalPrice, 20);
  assert.equal(cart.discountBudget?.originalSubtotalCents, 12000);
  assert.equal(cart.discountBudget?.promotionDiscountCents, 200);
  assert.equal(Object.hasOwn(cart, "_widgetCrossSellAcceptance"), false);
  assert.equal(JSON.stringify(cart).includes(ack.eventId), false);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
  cart.items[0]!.quantity = 90;
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
});

for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned"] as const) {
  test(`accepted reader retains canonical ${fault} admission guard`, async () => {
    const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
    await f.adapter.accept(scope, { expectedQuote }); const before = f.state(); f.faults[fault] = true; f.calls.length = 0;
    await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(f.state(), before); noWrites(f.calls);
  });
}
for (const change of ["price", "expired", "promotion-version", "ceiling", "stock", "ambiguous-sku", "required-options"] as const) {
  test(`accepted reader refuses stale canonical ${change} instead of full-price fallback`, async () => {
    const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
    await f.adapter.accept(scope, { expectedQuote }); const before = f.state(); f.calls.length = 0;
    if (change === "price") f.rows[1]!.price.basePriceInCents++;
    if (change === "expired") f.promotion.endsAt = new Date("2026-01-01T00:00:00Z");
    if (change === "promotion-version") f.promotion.updatedAt = new Date("2026-10-20T01:00:00Z");
    if (change === "ceiling") f.ceiling.value = 0;
    if (change === "stock") f.rows[1]!.stock = [];
    if (change === "ambiguous-sku") f.rows.push(catalogRow("duplicate", "TARGET", 2000));
    if (change === "required-options") f.rows[1]!.product.metadata = { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [option] }] };
    await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(f.state(), before); noWrites(f.calls);
  });
}

for (const change of ["receipt-null", "receipt-missing", "receipt-scope", "receipt-time", "version", "suggestion", "event-missing", "event-metadata", "outbox-missing", "outbox-payload", "reduced-base", "quantity", "other-private",
  "receipt-event-id", "suggestion-time", "suggestion-discount", "outbox-merchant", "outbox-type", "event-merchant", "selected-option", "private-line"] as const) {
  test(`accepted reader refuses inconsistent provenance: ${change}`, async () => {
    const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
    await f.adapter.accept(scope, { expectedQuote });
    f.mutate(state => {
      const receipt = state.session.cart._widgetCrossSellAcceptance as { quote: typeof expectedQuote; acceptedAt: string };
      if (change === "receipt-null") state.session.cart._widgetCrossSellAcceptance = null;
      if (change === "receipt-missing") delete state.session.cart._widgetCrossSellAcceptance;
      if (change === "receipt-scope") receipt.quote.sessionId = "foreign";
      if (change === "receipt-time") receipt.acceptedAt = "2026-10-20T12:01:00Z";
      if (change === "version") state.session.version++;
      if (change === "suggestion") state.suggestion.status = "pending";
      if (change === "event-missing") state.events = [];
      if (change === "event-metadata") (state.events[0] as Record<string, unknown>).metadata = {};
      if (change === "outbox-missing") state.outbox = [];
      if (change === "outbox-payload") (state.outbox[0] as Record<string, unknown>).payload = {};
      if (change === "reduced-base") (state.session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!.price = 18;
      if (change === "quantity") (state.session.cart.items as Array<Record<string, unknown>>)[0]!.quantity = 2;
      if (change === "other-private") state.session.cart._foreignAuthority = {};
      if (change === "receipt-event-id") Object.assign(receipt, { eventId: "foreign-event" });
      if (change === "suggestion-time") Object.assign(state.suggestion, { resolvedAt: new Date("2026-10-20T12:01:00Z") });
      if (change === "suggestion-discount") Object.assign(state.suggestion, { computedDiscount: 99 });
      if (change === "outbox-merchant") (state.outbox[0] as Record<string, unknown>).merchantId = "foreign";
      if (change === "outbox-type") (state.outbox[0] as Record<string, unknown>).eventType = "cross-sell.offer.declined";
      if (change === "event-merchant") (state.events[0] as Record<string, unknown>).merchantId = "foreign";
      if (change === "selected-option") (state.session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!.variant = JSON.stringify(["target", ["unknown"]]);
      if (change === "private-line") (state.session.cart.items as Array<Record<string, unknown>>)[0]!._receipt = {};
    });
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(f.state(), before); noWrites(f.calls);
  });
}

test("accepted reader prices the explicitly selected paid option exactly once and does not double-count target stock", async () => {
  const f = fixture(); f.rows[1]!.stock = [{ quantity: 1, reserved: 0 }];
  f.rows[1]!.product.metadata = { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [option] }] };
  const expectedQuote = await f.adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
  await f.adapter.accept(scope, { expectedQuote }); f.calls.length = 0;
  const cart = await f.adapter.readAccepted(scope), target = cart.items.find(item => item.sku === "TARGET")!;
  assert.equal(target.price, 22.5); assert.equal(target.originalPrice, 25); assert.equal(cart.total, 122.5);
  assert.deepEqual(target.selected_options, [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 5 }]);
  noWrites(f.calls);
});

test("accepted reader preserves company-ceiling notice without using cost/margin", async () => {
  const f = fixture(); f.ceiling.value = 1;
  const expectedQuote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote });
  const cart = await f.adapter.readAccepted(scope);
  assert.equal(cart.total, 118.8); assert.equal(cart.discountBudget?.promotionDiscountCents, 120);
  assert.equal(cart.commercialNotices?.[0]?.code, "discount_limit_reached");
});

test("accepted reader selects best product promotion without compounding it with cross-sell", async () => {
  const f = fixture(); f.productPromotions.push({ id: "product-promo", merchantId: scope.merchantId, productId: "target-product",
    variantId: null, categoryId: null, couponId: null, discountType: "percent", discountValue: 20, promoPriceInCents: null,
    isActive: true, startsAt: new Date("2026-01-01"), endsAt: new Date("2027-01-01") });
  const expectedQuote = await f.adapter.quote(scope, request); assert.equal(expectedQuote.target.source, "product");
  await f.adapter.accept(scope, { expectedQuote }); const cart = await f.adapter.readAccepted(scope);
  assert.equal(cart.items.find(item => item.sku === "TARGET")!.price, 16); assert.equal(cart.total, 116);
});

test("accepted reader scope is strict and detached, never accepting caller-supplied receipt or quote", async () => {
  const f = fixture();
  await assert.rejects(f.adapter.readAccepted({ ...scope, _widgetCrossSellAcceptance: {} }));
  await assert.rejects(f.adapter.readAccepted({ ...scope, expectedQuote: {} }));
  assert.deepEqual(f.calls, []);
});

for (const change of ["total", "discount-budget", "private-field", "private-line", "negative-discount", "fractional-cent"] as const) {
  test(`output Zod guard refuses an inconsistent projected cart: ${change}`, async () => {
    const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
    await f.adapter.accept(scope, { expectedQuote }); const cart = await f.adapter.readAccepted(scope);
    const output: Record<string, unknown> = { ...structuredClone(cart) };
    if (change === "total") output.total = 1;
    if (change === "discount-budget") output.discountBudget = { version: 1, originalSubtotalCents: 12000, promotionDiscountCents: 0 };
    if (change === "private-field") output._widgetCrossSellAcceptance = {};
    if (change === "private-line") Object.assign((output.items as object[])[0]!, { _receipt: {} });
    if (change === "negative-discount") (output.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!.originalPrice = 1;
    if (change === "fractional-cent") (output.items as Array<Record<string, unknown>>)[0]!.price = 1.001;
    assert.equal(widgetCrossSellCheckoutProjectedCartSchema.safeParse(output).success, false);
  });
}

test("accepted reader supports the final committed int version without incrementing it", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  await f.adapter.accept(scope, { expectedQuote });
  f.mutate(state => {
    const receipt = state.session.cart._widgetCrossSellAcceptance as { quote: typeof expectedQuote; committedVersion: number };
    state.session.version = receipt.committedVersion = 2_147_483_647;
    receipt.quote.persistenceVersion = receipt.quote.checkoutBasis.persistenceVersion = 2_147_483_646;
    ((state.events[0] as Record<string, unknown>).metadata as Record<string, unknown>).checkout_version = 2_147_483_647;
    ((state.outbox[0] as Record<string, unknown>).payload as Record<string, unknown>).checkout_version = 2_147_483_647;
  });
  const before = f.state(); f.calls.length = 0;
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
});

test("accepted projection restamps canonical IDs, selection identity and physical type", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  await f.adapter.accept(scope, { expectedQuote });
  f.mutate(state => {
    const line = (state.session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!;
    delete line.variantId; delete line.product_id; line.productType = "digital"; line.variant = "Legacy label";
  });
  const before = f.state(), cart = await f.adapter.readAccepted(scope), target = cart.items.find(item => item.sku === "TARGET")!;
  assert.equal(target.variantId, "target"); assert.equal(target.product_id, "target-product");
  assert.equal(target.productType, "physical"); assert.equal(target.variant, JSON.stringify(["target", []]));
  assert.equal(cart.total, 118); assert.deepEqual(f.state(), before);
});

test("a JSON selection tuple must match the resolved SKU even if raw variantId is absent", async () => {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  await f.adapter.accept(scope, { expectedQuote });
  f.mutate(state => {
    const line = (state.session.cart.items as Array<Record<string, unknown>>).find(item => item.sku === "TARGET")!;
    delete line.variantId; line.variant = JSON.stringify(["foreign-variant", []]);
  });
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
});

async function acceptedFixture() {
  const f = fixture(), expectedQuote = await f.adapter.quote(scope, request);
  await f.adapter.accept(scope, { expectedQuote }); f.calls.length = 0; return f;
}
test("customer command preserves accepted base/quote/effective total and advances a durable revision", async () => {
  const f = await acceptedFixture(), before = f.state();
  const ack = await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
  assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
  const saved = f.state(), receipt = saved.session.cart._widgetCrossSellAcceptance as Record<string, unknown>;
  assert.equal(saved.session.version, 6); assert.equal(saved.session.strategyContextVersion, 2);
  assert.equal(saved.session.cart.total, 120); assert.equal(receipt.committedVersion, 5);
  assert.deepEqual(receipt.quote, (before.session.cart._widgetCrossSellAcceptance as Record<string, unknown>).quote);
  assert.deepEqual(saved.outbox, before.outbox); assert.deepEqual(saved.suggestion, before.suggestion);
  assert.equal(saved.events.length, 2); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  const audit = JSON.stringify(saved.events[1]);
  for (const value of Object.values(contact)) assert.ok(!audit.includes(value));
  assert.ok(!JSON.stringify(ack).includes("eventId"));
});
test("customer command normalizes fields and preserves unchanged verified server identity", async () => {
  const f = await acceptedFixture();
  f.mutate(state => { state.session.customer = { ...contact, email_verified: true, phone_verified: true, address_verified: true,
    address: { city: "Synthetic" }, otp_code: "server-email", phone_otp_code: "server-phone", externalCustomerId: "server-customer" }; });
  await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, fullName: " Synthetic Buyer ",
    email: " BUYER@EXAMPLE.TEST ", cpf: "123.456.789-01", phone: "(11) 98765-4321" } });
  const saved = f.state(); assert.equal(saved.session.globalUserId, "buyer");
  assert.equal(saved.session.customer?.email_verified, true); assert.equal(saved.session.customer?.phone_verified, true);
  assert.equal(saved.session.customer?.externalCustomerId, "server-customer");
  assert.equal(saved.session.customer?.fullName, contact.fullName);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("email change invalidates buyer/OTP/provider/address/shipping without losing the benefit", async () => {
  const f = await acceptedFixture();
  f.mutate(state => { state.session.customer = { ...contact, email_verified: true, phone_verified: true, address_verified: true,
    recognized_buyer: true, isReturning: true, address: { city: "Synthetic" }, deliveryAddressLabel: "old address",
    otp_code: "old-email", otp_expires_at: "2027-01-01T00:00:00Z", phone_otp_code: "old-phone",
    externalCustomerId: "old-provider", asaasCustomerId: "old-asaas" };
    state.session.shipping = { customerPrice: 5 }; state.session.shippingOptions = [{ customerPrice: 5 }]; });
  await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, email: "changed@example.test" } });
  const saved = f.state(), customer = saved.session.customer!;
  assert.notEqual(saved.session.globalUserId, "buyer");
  for (const field of ["email_verified", "phone_verified", "address_verified", "recognized_buyer", "isReturning"]) assert.equal(customer[field], false);
  for (const field of ["otp_code", "otp_expires_at", "phone_otp_code", "externalCustomerId", "asaasCustomerId", "address", "deliveryAddressLabel"]) assert.equal(customer[field], undefined);
  assert.equal(saved.session.shipping, null); assert.equal(saved.session.shippingOptions, null);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("phone change invalidates only its proof and cached provider identity", async () => {
  const f = await acceptedFixture(); f.mutate(state => { state.session.customer = { ...contact, email_verified: true,
    phone_verified: true, phone_otp_code: "old-phone", externalCustomerId: "old-provider", address: { city: "Synthetic" } }; });
  await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, phone: "11987650000" } });
  const saved = f.state(); assert.equal(saved.session.globalUserId, "buyer"); assert.equal(saved.session.customer?.email_verified, true);
  assert.equal(saved.session.customer?.phone_verified, false); assert.equal(saved.session.customer?.phone_otp_code, undefined);
  assert.equal(saved.session.customer?.externalCustomerId, undefined); assert.deepEqual(saved.session.customer?.address, { city: "Synthetic" });
});
test("successive authorized revisions remain readable; stale duplicate never writes or retries", async () => {
  const f = await acceptedFixture();
  await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
  await f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, fullName: "Second Name" } });
  assert.equal((await f.adapter.readAccepted(scope)).total, 118); assert.equal(f.state().events.length, 3);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }), /cross_sell_quote_review_required/);
  assert.deepEqual(f.state(), before); noWrites(f.calls);
  assert.equal(f.calls.filter(call => call === "transaction").length, 1);
});
test("concurrent same-version contact writes serialize and only one revision commits", async () => {
  const f = await acceptedFixture();
  const results = await Promise.allSettled([f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }),
    f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, fullName: "Other Name" } })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().session.version, 6); assert.equal(f.state().events.length, 2);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
for (const fault of ["checkoutCas", "event"] as const) test(`customer ${fault} failure rolls back contact/identity/revision together`, async () => {
  const f = await acceptedFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }));
  assert.deepEqual(f.state(), before);
});
test("lost customer commit ACK can be read, but cannot cause an automatic or stale second revision", async () => {
  const f = await acceptedFixture(); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }), /commit_outcome_unknown/);
  assert.equal(f.state().session.version, 6); assert.equal(f.state().events.length, 2); f.faults.commitUnknown = false;
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact })); assert.equal(f.state().events.length, 2);
});
for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned"] as const) {
  test(`customer revision retains ${fault} admission guard`, async () => {
    const f = await acceptedFixture(), before = f.state(); f.faults[fault] = true;
    await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }));
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
}
for (const field of ["cart", "expectedQuote", "_widgetCrossSellAcceptance", "globalUserId"]) test(`customer input refuses caller ${field} before transaction`, async () => {
  const f = fixture(); await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact, [field]: {} }));
  assert.deepEqual(f.calls, []);
});
for (const patch of [{ email_verified: true }, { address: {} }, { phone_verified: true }, { cpf: "1" }, { email: "bad" }, { phone: "123" }]) {
  test(`customer contact rejects invalid fields ${Object.keys(patch).join()}`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, ...patch } }));
    assert.deepEqual(f.calls, []);
  });
}
for (const change of ["missing-event", "foreign-event", "event-metadata", "event-time", "event-type", "context-customer", "context-buyer", "context-shipping", "context-version", "session-version", "receipt-revision", "receipt-time"] as const) {
  test(`accepted reader refuses unproven customer revision: ${change}`, async () => {
    const f = await acceptedFixture(); await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
    f.mutate(state => {
      const event = state.events[1] as Record<string, unknown>;
      if (change === "missing-event") state.events.pop();
      if (change === "foreign-event") event.merchantId = "foreign";
      if (change === "event-metadata") event.metadata = {};
      if (change === "event-time") event.occurredAt = new Date("2027-01-01T00:00:00Z");
      if (change === "event-type") event.eventName = "other";
      if (change === "context-customer") state.session.customer!.email = "foreign@example.test";
      if (change === "context-buyer") state.session.globalUserId = "foreign";
      if (change === "context-shipping") state.session.shipping = { customerPrice: 1 };
      if (change === "context-version") state.session.strategyContextVersion++;
      if (change === "session-version") state.session.version++;
      const receipt = state.session.cart._widgetCrossSellAcceptance as { revision?: Record<string, unknown> };
      if (change === "receipt-revision") delete receipt.revision;
      if (change === "receipt-time") receipt.revision!.revisedAt = "2027-01-01T00:00:00.000Z";
    });
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/); noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
}
test("customer request is snapshotted before await and stale price never writes", async () => {
  const f = await acceptedFixture(), customer = { ...contact }, pending = f.adapter.updateCustomer(scope, { expectedVersion: 5, customer });
  customer.email = "mutated@example.test"; await pending; assert.equal(f.state().session.customer?.email, contact.email);
  f.rows[1]!.price.basePriceInCents++; const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: contact })); noWrites(f.calls); assert.deepEqual(f.state(), before);
});
test("customer revision refuses session or strategy context version overflow before writes", async () => {
  const f = await acceptedFixture(); f.mutate(state => { state.session.strategyContextVersion = 2_147_483_647; });
  const before = f.state();
  await assert.rejects(f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }), /cross_sell_quote_review_required/);
  noWrites(f.calls); assert.deepEqual(f.state(), before);
});

test("customer command authenticates scope independently and rejects foreign tenant/session without writes", async () => {
  for (const foreign of [{ ...scope, merchantId: "foreign" }, { ...scope, sessionId: "foreign" }]) {
    const f = await acceptedFixture(), before = f.state();
    await assert.rejects(f.adapter.updateCustomer(foreign, { expectedVersion: 5, customer: contact }));
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  }
});
test("CPF change invalidates cached PSP customer but cannot claim verification", async () => {
  const f = await acceptedFixture(); f.mutate(state => { state.session.customer = { ...contact, email_verified: true,
    externalCustomerId: "old-provider", asaasCustomerId: "old-asaas" }; });
  await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, cpf: "98765432100" } });
  const customer = f.state().session.customer!; assert.equal(customer.externalCustomerId, undefined);
  assert.equal(customer.asaasCustomerId, undefined); assert.equal(customer.email_verified, true); assert.equal(customer.cpf, "98765432100");
});
test("customer ACK Zod cannot expose contact/private receipt or accept an invalid version/status", () => {
  const ack = { version: 1, ...scope, status: "updated", persistenceVersion: 6 };
  assert.equal(widgetCrossSellCheckoutCustomerAcknowledgementSchema.safeParse(ack).success, true);
  for (const patch of [{ customer: contact }, { eventId: "private" }, { _widgetCrossSellAcceptance: {} },
    { persistenceVersion: 2_147_483_648 }, { persistenceVersion: 1 }, { status: "accepted" }])
    assert.equal(widgetCrossSellCheckoutCustomerAcknowledgementSchema.safeParse({ ...ack, ...patch }).success, false);
});
test("private revision Zod refuses malformed version/parent/time/hash before evidence lookup", async () => {
  const f = await acceptedFixture(); await f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
  const receipt = widgetCrossSellCheckoutReceiptSchema.parse(f.state().session.cart._widgetCrossSellAcceptance);
  for (const patch of [{ persistenceVersion: 5 }, { persistenceVersion: 7 }, { previousEventId: "unissued" },
    { eventId: receipt.eventId }, { eventId: receipt.revision!.previousEventId }, { contextHash: "not-a-hash" },
    { revisedAt: "2026-01-01T00:00:00Z" }, { allowUnvalidatedRevision: true }]) {
    assert.equal(widgetCrossSellCheckoutReceiptSchema.safeParse({ ...receipt, revision: { ...receipt.revision, ...patch } }).success, false);
  }
});

async function acceptedAddressFixture() {
  const f = await acceptedFixture(); f.mutate(state => { state.session.customer = { ...contact }; }); return f;
}
test("explicit address submission preserves accepted benefit and records an address-specific revision without PII", async () => {
  const f = await acceptedFixture(); f.mutate(state => { state.session.customer = { ...contact, email_verified: true,
    phone_verified: true, otp_code: "server-code", externalCustomerId: "server-provider", deliveryAddressLabel: "old saved address" };
    state.session.shipping = { customerPrice: 5 }; state.session.shippingOptions = [{ customerPrice: 5 }]; });
  const before = f.state(), ack = await f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress });
  assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
  const saved = f.state(), receipt = widgetCrossSellCheckoutReceiptSchema.parse(saved.session.cart._widgetCrossSellAcceptance);
  assert.equal(saved.session.version, 6); assert.equal(saved.session.strategyContextVersion, 2);
  assert.deepEqual(saved.session.customer?.address, deliveryAddress); assert.equal(saved.session.customer?.address_verified, true);
  assert.equal(saved.session.customer?.email_verified, true); assert.equal(saved.session.customer?.phone_verified, true);
  assert.equal(saved.session.customer?.otp_code, "server-code"); assert.equal(saved.session.customer?.externalCustomerId, "server-provider");
  assert.equal(saved.session.customer?.deliveryAddressLabel, undefined); assert.equal(saved.session.globalUserId, "buyer");
  assert.equal(saved.session.shipping, null); assert.equal(saved.session.shippingOptions, null);
  assert.equal(receipt.revision?.operation, "address"); assert.equal(receipt.committedVersion, 5);
  assert.deepEqual(receipt.quote, (before.session.cart._widgetCrossSellAcceptance as Record<string, unknown>).quote);
  assert.deepEqual(saved.outbox, before.outbox); assert.deepEqual(saved.suggestion, before.suggestion);
  assert.equal((saved.events[1] as { eventName: string }).eventName, "cross_sell_checkout_address_updated");
  for (const value of [deliveryAddress.street, deliveryAddress.zip, deliveryAddress.city, contact.email])
    assert.ok(!JSON.stringify(saved.events[1]).includes(value));
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("address normalization and request snapshot survive awaiting the transaction", async () => {
  const f = await acceptedAddressFixture(), address = { ...deliveryAddress, zip: "01310-100", street: " Synthetic Street ", state: "sp" };
  const pending = f.adapter.updateAddress(scope, { expectedVersion: 5, address }); address.street = "mutated"; await pending;
  assert.deepEqual(f.state().session.customer?.address, deliveryAddress); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("address/contact/address revisions have exact event kinds and never reapply the discount", async () => {
  const f = await acceptedAddressFixture();
  await f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress });
  await f.adapter.updateCustomer(scope, { expectedVersion: 6, customer: contact });
  await f.adapter.updateAddress(scope, { expectedVersion: 7, address: { ...deliveryAddress, number: "11" } });
  assert.equal(f.state().session.version, 8); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  assert.equal(f.state().events.length, 4); assert.equal(f.state().outbox.length, 1);
});
test("same-version address/contact commands serialize to one winner", async () => {
  const f = await acceptedAddressFixture(), outcomes = await Promise.allSettled([
    f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress }),
    f.adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().session.version, 6); assert.equal(f.state().events.length, 2);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
for (const fault of ["checkoutCas", "event"] as const) test(`address ${fault} rolls back address/shipping/revision atomically`, async () => {
  const f = await acceptedAddressFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress })); assert.deepEqual(f.state(), before);
});
test("lost address ACK is reconciled read-only and stale repetition cannot revise again", async () => {
  const f = await acceptedAddressFixture(); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress }), /commit_outcome_unknown/);
  f.faults.commitUnknown = false; assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress })); noWrites(f.calls);
  assert.deepEqual(f.state(), before);
});
for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned"] as const)
  test(`address command preserves ${fault} admission guard`, async () => {
    const f = await acceptedAddressFixture(), before = f.state(); f.faults[fault] = true;
    await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress })); noWrites(f.calls);
    assert.deepEqual(f.state(), before);
  });
for (const field of ["cart", "expectedQuote", "_widgetCrossSellAcceptance", "globalUserId", "address_verified", "shipping", "shippingOptions"])
  test(`address command refuses caller-owned ${field} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress, [field]: {} }));
    assert.deepEqual(f.calls, []);
  });
for (const patch of [{ zip: "00000000" }, { zip: "01310" }, { state: "XX" }, { city: "" }, { street: "a\nb" },
  { number: "1".repeat(33) }, { complement: "x".repeat(161) }, { address_verified: true }, { shipping: {} }, { email_verified: true }])
  test(`address Zod rejects ${JSON.stringify(patch)} before transaction`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: { ...deliveryAddress, ...patch } }));
    assert.deepEqual(f.calls, []);
  });
for (const change of ["wrong-event-kind", "missing-kind", "wrong-kind", "tampered-address", "tampered-shipping"] as const)
  test(`accepted reader refuses address revision corruption: ${change}`, async () => {
    const f = await acceptedAddressFixture(); await f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress });
    f.mutate(state => {
      const receipt = state.session.cart._widgetCrossSellAcceptance as { revision: Record<string, unknown> };
      if (change === "wrong-event-kind") (state.events[1] as Record<string, unknown>).eventName = "cross_sell_checkout_customer_updated";
      if (change === "missing-kind") delete receipt.revision.operation;
      if (change === "wrong-kind") receipt.revision.operation = "customer";
      if (change === "tampered-address") state.session.customer!.address = { ...deliveryAddress, number: "99" };
      if (change === "tampered-shipping") state.session.shippingOptions = [{ customerPrice: 0 }];
    });
    const before = f.state(); f.calls.length = 0; await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
test("address submission refuses foreign scope and stale catalog without writes", async () => {
  for (const selectedScope of [{ ...scope, merchantId: "foreign" }, { ...scope, sessionId: "foreign" }, scope]) {
    const f = await acceptedAddressFixture(); if (selectedScope === scope) f.rows[1]!.price.basePriceInCents++;
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.updateAddress(selectedScope, { expectedVersion: 5, address: deliveryAddress }));
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  }
});
for (const patch of [null, { fullName: "" }, { email: "" }, { cpf: "123" }, { phone: "abc" }])
  test(`address command preserves existing registration prerequisite (${JSON.stringify(patch)})`, async () => {
    const f = await acceptedAddressFixture(); f.mutate(state => { state.session.customer = patch === null ? null : { ...contact, ...patch }; });
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress })); noWrites(f.calls);
    assert.deepEqual(f.state(), before);
  });
test("address confirmation cannot promote email/phone verification or returning-buyer identity", async () => {
  const f = await acceptedAddressFixture(); f.mutate(state => { Object.assign(state.session.customer!, {
    email_verified: false, phone_verified: false, recognized_buyer: false, isReturning: false,
  }); });
  await f.adapter.updateAddress(scope, { expectedVersion: 5, address: deliveryAddress });
  const customer = f.state().session.customer!;
  for (const field of ["email_verified", "phone_verified", "recognized_buyer", "isReturning"]) assert.equal(customer[field], false);
  assert.equal(f.state().session.globalUserId, "buyer"); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});

async function acceptedEmailOtpFixture() {
  const f = fixture();
  f.mutate(state => { state.session.customer = { ...contact, email_verified: false, phone_verified: false,
    recognized_buyer: false, isReturning: false, otp_code: "123456", otp_expires_at: "2026-10-20T12:01:00.000Z",
    phone_otp_code: "654321", address: deliveryAddress, address_verified: true,
    externalCustomerId: "server-provider" }; });
  const expectedQuote = await f.adapter.quote(scope, request); await f.adapter.accept(scope, { expectedQuote });
  f.calls.length = 0; return f;
}
test("email OTP consumes only the stored challenge, preserves benefit/context and emits no PII", async () => {
  const f = await acceptedEmailOtpFixture(), before = f.state();
  const ack = await f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" });
  assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
  const saved = f.state(), receipt = widgetCrossSellCheckoutReceiptSchema.parse(saved.session.cart._widgetCrossSellAcceptance);
  assert.deepEqual(saved.session.customer, { ...before.session.customer, email_verified: true, otp_code: "", otp_expires_at: "" });
  assert.equal(saved.session.globalUserId, before.session.globalUserId); assert.deepEqual(saved.session.shipping, before.session.shipping);
  assert.deepEqual(saved.session.shippingOptions, before.session.shippingOptions); assert.equal(saved.session.strategyContextVersion, 2);
  assert.equal(receipt.revision?.operation, "email_otp"); assert.equal(receipt.committedVersion, 5);
  assert.deepEqual(receipt.quote, (before.session.cart._widgetCrossSellAcceptance as Record<string, unknown>).quote);
  assert.deepEqual(saved.outbox, before.outbox); assert.deepEqual(saved.suggestion, before.suggestion);
  assert.equal((saved.events[1] as { eventName: string }).eventName, "cross_sell_checkout_email_verified");
  for (const value of [contact.email, "123456", "654321", "otp_code", "otp_expires_at", deliveryAddress.street])
    assert.ok(!JSON.stringify({ ack, event: saved.events[1] }).includes(value));
  assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
for (const patch of [null, { email: "" }, { email: "invalid" }, { email_verified: true }, { otp_code: "" },
  { otp_code: 123456 }, { otp_code: "654321" }, { otp_expires_at: undefined }, { otp_expires_at: "invalid" },
  { otp_expires_at: "2026-10-20T12:00:00.000Z" }, { otp_expires_at: "2026-10-20T11:59:59.999Z" }])
  test(`email OTP refuses missing/consumed/invalid/expired stored challenge ${JSON.stringify(patch)}`, async () => {
    const f = await acceptedEmailOtpFixture(); f.mutate(state => { state.session.customer = patch === null ? null : { ...state.session.customer, ...patch }; });
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }), /cross_sell_quote_review_required/);
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
for (const command of [{ expectedVersion: 5, code: "12345" }, { expectedVersion: 5, code: 123456 },
  { expectedVersion: 5, code: "1234567" }, { expectedVersion: 5, code: " 123456" },
  { expectedVersion: 5, code: "123456", email_verified: true }, { expectedVersion: 5, code: "123456", email: contact.email },
  { expectedVersion: 5, code: "123456", otp_expires_at: "2099-01-01T00:00:00Z" },
  { expectedVersion: 5, code: "123456", customer: {} }, { expectedVersion: 0, code: "123456" }])
  test(`email OTP strict command refuses caller authority ${JSON.stringify(command)}`, async () => {
    const f = fixture(); await assert.rejects(f.adapter.verifyEmailOtp(scope, command)); assert.deepEqual(f.calls, []);
  });
for (const fault of ["checkoutCas", "event"] as const) test(`email OTP ${fault} rolls back consumption and revision`, async () => {
  const f = await acceptedEmailOtpFixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" })); assert.deepEqual(f.state(), before);
});
for (const fault of ["payment", "order", "chat", "coupon", "assignment", "reservation", "abandoned", "clock"] as const)
  test(`email OTP retains ${fault} guard`, async () => {
    const f = await acceptedEmailOtpFixture(), before = f.state(); f.faults[fault] = true;
    await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }));
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
test("email OTP same-version competing consumption has one winner and no replay", async () => {
  const f = await acceptedEmailOtpFixture(), outcomes = await Promise.allSettled([
    f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }),
    f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }),
  ]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 6, code: "123456" }));
  noWrites(f.calls); assert.deepEqual(f.state(), before); assert.equal((await f.adapter.readAccepted(scope)).total, 118);
});
test("email OTP lost commit ACK stays consumed, read-only recovery cannot repeat revision", async () => {
  const f = await acceptedEmailOtpFixture(); f.faults.commitUnknown = true;
  await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }), /commit_outcome_unknown/);
  f.faults.commitUnknown = false; assert.equal((await f.adapter.readAccepted(scope)).total, 118);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }));
  noWrites(f.calls); assert.deepEqual(f.state(), before);
});
for (const change of ["event-kind", "operation", "email", "proof", "deadline", "code"] as const)
  test(`email OTP read rejects corrupted evidence/context ${change}`, async () => {
    const f = await acceptedEmailOtpFixture(); await f.adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" });
    f.mutate(state => {
      if (change === "event-kind") (state.events[1] as Record<string, unknown>).eventName = "cross_sell_checkout_customer_updated";
      if (change === "operation") (state.session.cart._widgetCrossSellAcceptance as { revision: Record<string, unknown> }).revision.operation = "customer";
      if (change === "email") state.session.customer!.email = "foreign@example.test";
      if (change === "proof") state.session.customer!.email_verified = false;
      if (change === "deadline") state.session.customer!.otp_expires_at = "2099-01-01T00:00:00Z";
      if (change === "code") state.session.customer!.otp_code = "123456";
    });
    const before = f.state(); f.calls.length = 0; await assert.rejects(f.adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  });
test("email OTP rejects stale catalog, foreign scope, stale version and context overflow", async () => {
  for (const changed of ["price", "merchant", "session", "version", "overflow"]) {
    const f = await acceptedEmailOtpFixture();
    if (changed === "price") f.rows[1]!.price.basePriceInCents++;
    if (changed === "overflow") f.mutate(state => { state.session.strategyContextVersion = 2_147_483_647; });
    const selectedScope = changed === "merchant" ? { ...scope, merchantId: "foreign" } : changed === "session" ? { ...scope, sessionId: "foreign" } : scope;
    const before = f.state(); f.calls.length = 0;
    await assert.rejects(f.adapter.verifyEmailOtp(selectedScope, { expectedVersion: changed === "version" ? 4 : 5, code: "123456" }));
    noWrites(f.calls); assert.deepEqual(f.state(), before);
  }
});
