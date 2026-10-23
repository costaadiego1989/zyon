import assert from "node:assert/strict";
import test from "node:test";
import { verifyNormalCheckoutEmailOtpInTransaction } from "../../../../shared/persistence/normal-checkout-email-otp-verification.js";
import { detachNormalCheckoutBuyerEmailInTransaction } from "../../../../shared/persistence/normal-checkout-email-detachment.js";

const now = new Date("2026-10-20T15:00:00.000Z"), scope = { merchantId: "merchant", sessionId: "checkout" };
function fixture() {
  let row: any = { id: "checkout-row", ...scope, globalUserId: "visitor", version: 4, strategyContextVersion: 0,
    conversationId: "conversation", cart: { currency: "BRL", total: 9, items: [{ sku: "SKU", quantity: 1, price: 9,
      crossSellIntent: { version: 1 } }] }, customer: { email: "buyer@example.test", otp_code: "123456",
      otp_expires_at: new Date(now.getTime() + 60_000).toISOString(), email_verified: false }, shipping: null,
    abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: now, updatedAt: now };
  const events: any[] = [], outbox: any[] = [], writes: any[] = [], active: any[] = [];
  const blocked: Record<string, unknown> = {}, queries: string[] = [];
  let conflict = false, throwEvent = false, strictVersion = false;
  const tx: any = { $queryRaw: async (parts: TemplateStringsArray) => { const query = parts.join("?"); queries.push(query);
      if (query.includes("clock_timestamp")) return [{ now }]; if (query.includes("SELECT id FROM merchants")) return [{ id: scope.merchantId }]; return []; },
    $executeRaw: async () => 0,
    checkoutSession: { findUnique: async () => row, findMany: async () => [], updateMany: async ({ data }: { data: any }) => {
      if (strictVersion && Object.hasOwn(data, "version")) throw new Error("checkout_session_version_is_database_owned");
      if (conflict) return { count: 0 }; writes.push(structuredClone(data)); row = { ...row, ...data, version: row.version + 1 }; return { count: 1 }; } },
    buyerAccount: { findUnique: async ({ where }: { where: { email?: string } }) => where.email ? ({ globalUserId: "returning", email: "buyer@example.test" }) : null },
    crossSellSuggestion: { findMany: async () => [{ id: "suggestion" }] },
    checkoutChatRequest: { findMany: async () => active },
    paymentIntent: { findFirst: async () => blocked.payment }, completedOrder: { findFirst: async () => blocked.order },
    couponRedemption: { findFirst: async () => blocked.coupon }, acceptedOffer: { findFirst: async () => blocked.offer },
    strategyAssignment: { findUnique: async () => blocked.strategy }, strategyIncentiveAssignment: { findUnique: async () => blocked.incentive },
    strategyIncentiveReservation: { findFirst: async () => blocked.reservation },
    storefrontCart: { findUnique: async () => null },
    checkoutEvent: { findFirst: async () => null,
      create: async ({ data }: { data: any }) => { if (throwEvent) throw new Error("synthetic_identity_event_failure"); events.push(data); } },
    outboxMessage: { findFirst: async () => ({ eventId: "normal_cross_sell_fixture" }), create: async ({ data }: { data: any }) => outbox.push(data) } };
  const dependencies = { readAuthority: async () => ({ stored: row, acceptanceEventIds: ["acceptance"], basisHash: "a".repeat(64) }) };
  const run = (input = { expectedVersion: 4, code: "123456" }, claim?: { requestId: string; requestHash: string }) =>
    verifyNormalCheckoutEmailOtpInTransaction(tx, scope, input, claim, dependencies as never);
  return { tx, blocked, active, writes, events, outbox, queries, dependencies, run,
    row: () => row,
    conflict: () => { conflict = true; }, throwEvent: () => { throwEvent = true; }, strictVersion: () => { strictVersion = true; } };
}
test("OTP challenge, canonical returning UID, customer and durable event commit together", async () => {
  const f = fixture(), before = structuredClone(f.row().cart), result = await f.run();
  assert.ok(result);
  assert.equal(result.globalUserId, "returning"); assert.equal(result.customer?.email_verified, true);
  assert.equal(result.customer?.otp_code, ""); assert.equal(result.persistenceVersion, 5);
  assert.deepEqual(f.row().cart, before); assert.equal(f.events.length, 1); assert.equal(f.outbox.length, 1);
  assert.doesNotMatch(JSON.stringify(f.outbox), /123456|buyer@example|Returning Buyer/);
});
for (const kind of ["version", "code", "expired", "verified_flag", "customer_email", "source_discount", "binding", "payment", "order", "coupon", "offer", "strategy", "incentive", "reservation", "unknown_chat"] as const) {
  test(`OTP refuses ${kind} before consuming or partially persisting proof`, async () => {
    const f = fixture(), input = { expectedVersion: 4, code: "123456" };
    if (kind === "version") input.expectedVersion = 3;
    if (kind === "code") input.code = "654321";
    if (kind === "expired") f.row().customer.otp_expires_at = now.toISOString();
    if (kind === "verified_flag") { f.row().customer.email_verified = true; f.row().customer.otp_code = ""; }
    if (kind === "customer_email") f.row().customer.email = "";
    if (kind === "source_discount") f.row().cart.currentDiscount = 1;
    if (kind === "binding") f.row().cart._storefrontCouponBinding = {};
    if (["payment", "order", "coupon", "offer", "strategy", "incentive", "reservation"].includes(kind)) f.blocked[kind] = { id: kind };
    if (kind === "unknown_chat") f.active.push({ id: "unknown", ...scope, conversationId: "conversation", requestHash: "a".repeat(64), status: "unknown" });
    const reason = kind === "version" ? /CHECKOUT_SESSION_VERSION_CONFLICT/ : kind === "code" ? /checkout_email_otp_invalid/
      : kind === "expired" ? /checkout_email_otp_expired/ : /checkout_buyer_identity_review_required/;
    await assert.rejects(f.run(input), reason);
    assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0); assert.equal(f.outbox.length, 0);
  });
}
test("current own chat claim is revalidated instead of bypassing all processing requests", async () => {
  const f = fixture(), claim = { requestId: "request", requestHash: "a".repeat(64) };
  f.active.push({ id: "request", ...scope, conversationId: "conversation", requestHash: claim.requestHash, status: "processing" });
  await f.run(undefined, claim); assert.equal(f.writes.length, 1);
});
test("unknown event write and CAS errors retain their exact failure, never auto retry", async () => {
  const f = fixture(); f.throwEvent(); await assert.rejects(f.run(), /synthetic_identity_event_failure/);
  const c = fixture(); c.conflict(); await assert.rejects(c.run(), /CHECKOUT_SESSION_VERSION_CONFLICT/);
  assert.equal(c.events.length, 0); assert.equal(c.outbox.length, 0);
});
test("canonical account lookup must match the actual verified email", async () => {
  const f = fixture(); f.tx.buyerAccount.findUnique = async () => ({ globalUserId: "other", email: "other@example.test" });
  await assert.rejects(f.run(), /checkout_buyer_identity_review_required/); assert.equal(f.writes.length, 0);
});
test("legacy V1 absence is a presence-only fallback without consuming OTP", async () => {
  const f = fixture(); f.tx.outboxMessage.findFirst = async () => null;
  assert.equal(await f.run(), undefined); assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0);
});
test("a version-zero legacy V1 source may use the old OTP path without a normal grant", async () => {
  const f = fixture(); f.row().version = 0; f.tx.outboxMessage.findFirst = async () => null;
  assert.equal(await f.run({ expectedVersion: 0, code: "123456" }), undefined); assert.equal(f.writes.length, 0);
});
test("missing outbox with a normal technical event never falls back to legacy", async () => {
  const f = fixture(); f.tx.outboxMessage.findFirst = async () => null; f.tx.checkoutEvent.findFirst = async () => ({ id: "normal-event" });
  f.dependencies.readAuthority = async () => { throw new Error("cross_sell_quote_review_required"); };
  await assert.rejects(f.run(), /cross_sell_quote_review_required/); assert.equal(f.writes.length, 0);
});
test("malformed actual normal evidence never falls back or consumes a valid challenge", async () => {
  const f = fixture(); f.dependencies.readAuthority = async () => { throw new Error("cross_sell_quote_review_required"); };
  await assert.rejects(f.run(), /cross_sell_quote_review_required/); assert.equal(f.row().customer.otp_code, "123456"); assert.equal(f.writes.length, 0);
});
test("TTL is checked again after authority/account locks before any consume", async () => {
  const f = fixture(); let clocks = 0;
  const previous = f.tx.$queryRaw;
  f.tx.$queryRaw = async (parts: TemplateStringsArray, ...values: unknown[]) => parts.join("?").includes("clock_timestamp")
    ? [{ now: clocks++ ? new Date(now.getTime() + 60_000) : now }] : previous(parts, ...values);
  await assert.rejects(f.run(), /checkout_email_otp_expired/); assert.equal(f.writes.length, 0);
});
test("actual no-D source remains unchanged without TTL renewal or source write", async () => {
  const f = fixture(); f.row().cart.source = "storefront"; f.row().cart.cart_ref = "source";
  const source = { merchantId: scope.merchantId, sessionId: "source", discount: 0, couponCode: null, expiresAt: new Date(now.getTime() + 60_000) };
  const before = structuredClone(source);
  f.dependencies.readAuthority = async () => ({ stored: f.row(), acceptanceEventIds: ["acceptance"], basisHash: "a".repeat(64), source: { row: source } });
  await f.run(); assert.deepEqual(source, before); assert.ok(f.queries.some(query => query.includes("storefront_carts") && query.includes("FOR SHARE")));
});
test("new buyer with no prior canonical account keeps its actual UID", async () => {
  const f = fixture(); f.tx.buyerAccount.findUnique = async () => null;
  const result = await f.run(); assert.equal(result?.globalUserId, "visitor"); assert.equal(result?.customer?.email_verified, true);
});
const detach = (f: ReturnType<typeof fixture>, claim?: { requestId: string; requestHash: string }) =>
  detachNormalCheckoutBuyerEmailInTransaction(f.tx, scope, { expectedVersion: 4, email: "new@example.test" }, claim, f.dependencies as never);
test("NORMAL correction mints anonymous UID server-side and revokes current proofs without granting authentication", async () => {
  const f = fixture(); Object.assign(f.row().customer, { email_verified: true, fullName: "Private buyer", cpf: "12345678901", phone: "11999999999",
    externalCustomerId: "private-external", asaasCustomerId: "private-provider", recognized_buyer: true, address: { zip: "01310000" }, phone_verified: true });
  const before = structuredClone(f.row().cart), result = await detach(f); assert.ok(result);
  assert.match(result.globalUserId, /^usr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(result.customer?.email, "new@example.test"); assert.equal(result.customer?.email_verified, false);
  for (const key of ["fullName", "cpf", "phone", "address", "externalCustomerId", "asaasCustomerId"]) assert.equal(Reflect.get(result.customer!, key), undefined);
  assert.equal(result.customer?.otp_code, ""); assert.deepEqual(f.row().cart, before);
  assert.equal(f.outbox[0].payload.event_name, "buyer_identity_detached"); assert.equal(f.events.length, 1);
});
for (const kind of ["payment", "order", "coupon", "offer", "strategy", "incentive", "reservation", "D", "unknown"] as const) {
  test(`NORMAL correction ${kind} review happens before any UID/code/profile write`, async () => {
    const f = fixture(); if (kind === "D") f.row().cart.currentDiscount = 1;
    else if (kind === "unknown") f.active.push({ id: "unknown", ...scope, conversationId: "conversation", requestHash: "a".repeat(64), status: "unknown" });
    else f.blocked[kind] = { id: kind };
    await assert.rejects(detach(f), /checkout_buyer_identity_review_required/); assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0);
  });
}
test("NORMAL correction uses the exact own claim and legacy absence never mints a new principal", async () => {
  const f = fixture(), claim = { requestId: "request", requestHash: "a".repeat(64) };
  f.active.push({ id: claim.requestId, ...scope, conversationId: "conversation", requestHash: claim.requestHash, status: "processing" });
  await detach(f, claim); assert.equal(f.writes.length, 1);
  const old = fixture(); old.tx.outboxMessage.findFirst = async () => null;
  assert.equal(await detach(old), undefined); assert.equal(old.writes.length, 0);
});
test("OTP CAS leaves version assignment to the real database-owned trigger", async () => {
  const f = fixture(); f.strictVersion(); const result = await f.run(); assert.equal(result?.persistenceVersion, 5);
  assert.equal(Object.hasOwn(f.writes[0], "version"), false);
});
test("detachment CAS leaves version assignment to the real database-owned trigger", async () => {
  const f = fixture(); f.strictVersion(); const result = await detach(f); assert.equal(result?.persistenceVersion, 5);
  assert.equal(Object.hasOwn(f.writes[0], "version"), false);
});
