import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { prepareWidgetCrossSellCheckoutQuote } from "../../domain/services/widget-cross-sell-checkout-quote.js";
import { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCheckoutRevisionContextHash } from "./widget-cross-sell-checkout-revision.js";
import { requestWidgetCheckoutEmailOtp, claimWidgetCheckoutEmailOtpDelivery, completeWidgetCheckoutEmailOtpDelivery,
  requireWidgetCheckoutEmailOtpAttemptForVerify, invalidatePendingWidgetCheckoutEmailOtpForChangedEmail } from "./widget-checkout-email-otp.js";

const scope = { merchantId: "merchant", sessionId: "checkout" }, now = "2026-10-20T12:00:00.000Z";
const contact = { fullName: "Synthetic Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" };
function fixture() {
  const quote = prepareWidgetCrossSellCheckoutQuote({ merchantId: scope.merchantId, now,
    suggestion: { id: "suggestion", ...scope, promotionId: "promo", status: "pending", rankedSkus: ["TARGET"] },
    checkout: { ...scope, persistenceVersion: 4, currency: "BRL", currentDiscountCents: 0, couponCode: null,
      freeShipping: false, hasActiveCouponReservation: false, items: [{ variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 10000 }] },
    promotion: { id: "promo", merchantId: scope.merchantId, updatedAt: now, status: "active", startsAt: "2026-01-01T00:00:00Z",
      endsAt: null, recommendedSkus: ["TARGET"], discountPercent: "10", maxDiscountPercent: "100", trigger: { skuInCart: ["TRIGGER"] } },
    catalogVariants: [{ variantId: "target", productId: "target-product", sku: "TARGET", merchantId: scope.merchantId,
      isActive: true, productActive: true, productDeletedAt: null, currency: "BRL", baseUnitPriceCents: 2000 }],
    target: { variantId: "target", productId: "target-product", sku: "TARGET", quantity: 1, baseUnitPriceCents: 2000 },
    policy: { merchantId: scope.merchantId, maxDiscountPercent: 20 } });
  if (quote.kind !== "quote_candidate") assert.fail("canonical test quote missing");
  const receipt = widgetCrossSellCheckoutReceiptSchema.parse({ version: 1, origin: "widget_checkout",
    eventId: "synthetic-acceptance", committedVersion: 5, acceptedAt: now, quote });
  let state = { stored: { id: "session-row", ...scope, version: 5, strategyContextVersion: 3, globalUserId: "buyer",
    customer: { ...contact } as Record<string, unknown>, shipping: null, shippingOptions: null,
    cart: { currency: "BRL", total: 120, items: [{ sku: "TRIGGER", price: 100, quantity: 1 }, { sku: "TARGET", price: 20, quantity: 1 }],
      _widgetCrossSellAcceptance: receipt } as Record<string, unknown> }, outbox: [] as Array<Record<string, unknown>>, events: [] as unknown[] };
  const faults = { cas: false, event: false, postWriteVersion:false }, calls: string[] = [];
  const tx = {
    async $queryRaw() { calls.push("outbox-lock"); return []; },
    outboxMessage: {
      async create(args: { data: Record<string, unknown> }) { calls.push("outbox-create"); state.outbox.push(structuredClone(args.data)); return args.data; },
      async findFirst(args: { where: { merchantId: string; eventId: string } }) {
        return structuredClone(state.outbox.find(row => row.merchantId === args.where.merchantId && row.eventId === args.where.eventId) ?? null);
      },
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        calls.push("outbox-update"); const row = state.outbox.find(row => Object.entries(args.where).every(([key, value]) => row[key] === value));
        if (!row) return { count: 0 }; Object.assign(row, structuredClone(args.data)); return { count: 1 };
      },
    },
    checkoutSession: { async findUnique(){return structuredClone({...state.stored,version:state.stored.version+(faults.postWriteVersion?1:0)});},
      async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      calls.push("session-write"); if (faults.cas || args.where.version !== state.stored.version) return { count: 0 };
      state.stored.customer = structuredClone(args.data.customer as Record<string, unknown>);
      state.stored.cart = structuredClone(args.data.cart as Record<string, unknown>); state.stored.version++;
      assert.equal(Object.hasOwn(args.data,"version"),false,"CHECKOUT_SESSION_VERSION_READ_ONLY");
      assert.equal(Object.hasOwn(args.data,"strategyContextVersion"),false,"STRATEGY_CONTEXT_VERSION_DB_OWNED");return { count: 1 };
    } },
    checkoutEvent: { async create(args: { data: unknown }) { calls.push("event-write"); if (faults.event) throw new Error("synthetic_event_failure"); state.events.push(args.data); } },
  };
  const current = () => ({ stored: structuredClone(state.stored), cart: structuredClone(state.stored.cart),
    receipt: widgetCrossSellCheckoutReceiptSchema.parse(state.stored.cart._widgetCrossSellAcceptance), quote });
  return { tx: tx as unknown as Prisma.TransactionClient, current, faults, calls, state: () => structuredClone(state),
    mutate(work: (value: typeof state) => void) { work(state); },
    async transaction<T>(work: () => Promise<T>) { const before = structuredClone(state); try { return await work(); } catch (error) { state = before; throw error; } },
  };
}
async function issued() {
  const f = fixture(), ack = await f.transaction(() => requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 5, action: "issue" }, f.current()));
  return { ...f, ack };
}
test("OTP issuance refuses false actual post-write version and rolls reference/challenge back",async()=>{
  const f=fixture(),before=f.state();f.faults.postWriteVersion=true;
  await assert.rejects(f.transaction(()=>requestWidgetCheckoutEmailOtp(f.tx,scope,{expectedVersion:5,action:"issue"},f.current())));
  assert.deepEqual(f.state(),before);
});

test("issue commits legacy code/TTL, private origin, revision and reference-only outbox without financial mutation", async () => {
  const f = fixture(), before = f.state();
  const ack = await f.transaction(() => requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 5, action: "issue" }, f.current()));
  const saved = f.state(), receipt = widgetCrossSellCheckoutReceiptSchema.parse(saved.stored.cart._widgetCrossSellAcceptance);
  assert.equal(ack.status, "pending"); assert.equal(ack.persistenceVersion, 6); assert.equal(saved.stored.version, 6);
  assert.match(String(saved.stored.customer.otp_code), /^[1-9]\d{5}$/); assert.equal(saved.stored.customer.otp_expires_at, "2026-10-20T12:10:00.000Z");
  assert.equal(saved.stored.customer.otp_delivery_id, ack.deliveryId); assert.equal(saved.stored.customer.otp_delivery_email, contact.email);
  assert.equal(saved.stored.customer.email_verified, undefined); assert.equal(saved.stored.globalUserId, "buyer");
  assert.equal(receipt.revision?.operation, "email_otp_issue"); assert.equal(receipt.revision?.contextHash, widgetCheckoutRevisionContextHash(saved.stored));
  assert.deepEqual(receipt.quote, (before.stored.cart._widgetCrossSellAcceptance as typeof receipt).quote); assert.equal(saved.stored.cart.total, 120);
  assert.equal(saved.outbox.length, 1); assert.equal(saved.outbox[0]!.status, "otp_pending");
  for (const sensitive of [contact.email, String(saved.stored.customer.otp_code)]) {
    assert.ok(!JSON.stringify(ack).includes(sensitive)); assert.ok(!JSON.stringify(saved.events).includes(sensitive)); assert.ok(!JSON.stringify(saved.outbox).includes(sensitive));
  }
});
test("issue reuses a valid tracked pending challenge without renewing version/deadline or journaling again", async () => {
  const f = await issued(), before = f.state();
  const again = await requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 6, action: "issue" }, f.current());
  assert.deepEqual(again, f.ack); assert.deepEqual(f.state(), before);
});
test("explicit resend invalidates unsent old challenge and issues a distinct tracked revision", async () => {
  const f = await issued(), again = await f.transaction(() => requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 6, action: "resend" }, f.current()));
  assert.notEqual(again.deliveryId, f.ack.deliveryId); assert.equal(again.persistenceVersion, 7);
  assert.equal(f.state().outbox[0]!.status, "otp_cancelled"); assert.equal(f.state().outbox[1]!.status, "otp_pending");
});
for (const fault of ["cas", "event"] as const) test(`issuance ${fault} rolls back all writes in the caller transaction delegate`, async () => {
  const f = fixture(), before = f.state(); f.faults[fault] = true;
  await assert.rejects(f.transaction(() => requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 5, action: "issue" }, f.current())));
  assert.deepEqual(f.state(), before);
});
test("claim returns credentials only after marking the current challenge sending and does not revise money/customer", async () => {
  const f = await issued(), before = f.state();
  const claim = await claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current());
  assert.equal(claim.kind, "claimed"); if (claim.kind !== "claimed") assert.fail("claim required");
  assert.equal(claim.code, before.stored.customer.otp_code); assert.equal(claim.email, contact.email);
  assert.equal(f.state().outbox[0]!.status, "otp_sending"); assert.deepEqual(f.state().stored, before.stored);
  const again = await claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current());
  assert.equal(again.kind, "settled"); if (again.kind !== "settled") assert.fail("settled claim required"); assert.equal(again.status, "unknown");
});
for (const field of ["otp_delivery_id", "otp_delivery_email", "otp_issued_at", "otp_expires_at", "email"] as const)
  test(`claim rejects current ${field} mismatch without changing the journal`, async () => {
    const f = await issued(); f.mutate(state => { state.stored.customer[field] = "foreign"; }); const before = f.state();
    await assert.rejects(claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current()));
    assert.deepEqual(f.state(), before);
  });
test("verification accepts attempted unknown/sending origins but never pending/cancelled provenance", async () => {
  const f = await issued(); await assert.rejects(requireWidgetCheckoutEmailOtpAttemptForVerify(f.tx, scope, f.current()));
  const claim = await claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current());
  if (claim.kind !== "claimed") assert.fail("claim required");
  await requireWidgetCheckoutEmailOtpAttemptForVerify(f.tx, scope, f.current());
  await completeWidgetCheckoutEmailOtpDelivery(f.tx, scope, { deliveryId: f.ack.deliveryId, claimToken: claim.claimToken, outcome: { status: "unknown" } },
    { ...f.current(), now: new Date(now) });
  const before = f.state(); await requireWidgetCheckoutEmailOtpAttemptForVerify(f.tx, scope, f.current()); assert.deepEqual(f.state(), before);
});
test("email correction cancels only pending; uncertain attempt remains preserved without blocking contact correction", async () => {
  const f = await issued(); await invalidatePendingWidgetCheckoutEmailOtpForChangedEmail(f.tx, scope, f.current());
  assert.equal(f.state().outbox[0]!.status, "otp_cancelled"); await assert.rejects(requireWidgetCheckoutEmailOtpAttemptForVerify(f.tx, scope, f.current()));
  const g = await issued(); await claimWidgetCheckoutEmailOtpDelivery(g.tx, scope, { expectedVersion: 6, deliveryId: g.ack.deliveryId }, g.current());
  const before = g.state(); await invalidatePendingWidgetCheckoutEmailOtpForChangedEmail(g.tx, scope, g.current()); assert.deepEqual(g.state(), before);
});
test("completion records an old attempt after contact changed without requiring current catalog prices or verifying identity", async () => {
  const f = await issued(); const claim = await claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current());
  if (claim.kind !== "claimed") assert.fail("claim required");
  f.mutate(state => { state.stored.customer = { ...contact, email: "changed@example.test" }; state.stored.version++; });
  const before = f.state().stored;
  const result = await completeWidgetCheckoutEmailOtpDelivery(f.tx, scope, { deliveryId: f.ack.deliveryId, claimToken: claim.claimToken,
    outcome: { status: "sent", providerMessageId: "synthetic-provider-id" } }, { ...f.current(), now: new Date(now) });
  assert.equal(result.status, "sent"); assert.equal(f.state().outbox[0]!.status, "otp_sent"); assert.deepEqual(f.state().stored, before);
});
test("uncertain sending state blocks explicit resend without resetting old evidence", async () => {
  const f = await issued(); await claimWidgetCheckoutEmailOtpDelivery(f.tx, scope, { expectedVersion: 6, deliveryId: f.ack.deliveryId }, f.current());
  const before = f.state(); await assert.rejects(requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 6, action: "resend" }, f.current()));
  assert.deepEqual(f.state(), before);
});
test("legacy valid challenge cannot be retroactively granted outbox provenance; explicit resend may replace it", async () => {
  const f = fixture(); f.mutate(state => { Object.assign(state.stored.customer, { otp_code: "123456", otp_expires_at: "2026-10-20T12:10:00Z" }); });
  const before = f.state(); await assert.rejects(requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 5, action: "issue" }, f.current())); assert.deepEqual(f.state(), before);
  await requestWidgetCheckoutEmailOtp(f.tx, scope, { expectedVersion: 5, action: "resend" }, f.current()); assert.equal(f.state().stored.version, 6);
});
test("stale version, verified email and foreign scope cannot issue or claim", async () => {
  for (const fault of ["version", "verified", "scope"] as const) {
    const f = fixture(); if (fault === "verified") f.mutate(state => { state.stored.customer.email_verified = true; }); const before = f.state();
    await assert.rejects(requestWidgetCheckoutEmailOtp(f.tx, fault === "scope" ? { ...scope, merchantId: "foreign" } : scope,
      { expectedVersion: fault === "version" ? 4 : 5, action: "issue" }, f.current())); assert.deepEqual(f.state(), before);
  }
});
