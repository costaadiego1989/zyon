import assert from "node:assert/strict";

/** Actual owned SQL correction/identity chain. No provider, public auth grant,
 * nested lifecycle, migration or cleanup outside its isolated namespace. */
export async function runNormalCheckoutDetachmentNativeCases({ prisma, check, runId }) {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  const { createNormalCrossSellSourceNativeFixture } = await import("./normal-cross-sell-source.native-cases.mjs");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { CheckoutCustomerService } = await import("../src/modules/checkout/application/services/checkout-customer.service.ts");
  const { OtpService } = await import("../src/modules/checkout/application/services/otp.service.ts");
  const { CreatePaymentIntentUseCase } = await import("../src/modules/payment/application/create-payment-intent.use-case.ts");
  const fixture = await createNormalCrossSellSourceNativeFixture({ prisma, runId, namespace: "detachment" });
  const repository = new PrismaCheckoutRepository(prisma);
  const row = s => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: s.scope } });
  const source = s => prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: s.scope.merchantId, sessionId: s.cartId } } });
  const proofs = s => prisma.outboxMessage.findMany({ where: { merchantId: s.scope.merchantId, eventType: "checkout.event.tracked",
    payload: { path: ["session_id"], equals: s.scope.sessionId } }, orderBy: { occurredAt: "asc" } });
  const account = async (uid, email) => prisma.$executeRaw`INSERT INTO buyer_accounts(global_user_id,email,password_hash,display_name,updated_at)
    VALUES (${uid},${email},'synthetic-unused-hash','Synthetic original profile',CURRENT_TIMESTAMP)`;
  // Exactly the initial migration columns loaded by this owned SQL parent.
  // Do not select later phone-lookup/profile fields absent from its real DDL.
  const accountSelect = { globalUserId: true, email: true, passwordHash: true, displayName: true,
    phone: true, createdAt: true, updatedAt: true };
  async function seed(label, { coupon = false } = {}) {
    const s = await fixture.seed(label, { coupon });
    s.oldEmail = `${s.scope.sessionId}-old@example.test`; s.newEmail = `${s.scope.sessionId}-new@example.test`;
    await account(s.buyerId, s.oldEmail);
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: { customer: { ...s.customer,
      email: s.oldEmail, recognized_buyer: true, isReturning: true, externalCustomerId: "synthetic-old-provider",
      asaasCustomerId: "synthetic-old-asaas", phone_verified: true, phone_otp_code: "222222", otp_code: "111111",
      otp_expires_at: new Date(Date.now() + 600_000).toISOString() } }, select: { id: true } });
    s.quote = await fixture.adapter.quote(s.scope, s.request);
    s.acceptance = { suggestion_id: s.suggestionId, accepted_skus: [fixture.sku.a, fixture.sku.b], expected_quote: s.quote };
    await fixture.adapter.accept(s.scope, s.acceptance);
    return s;
  }
  const detach = async (s, claim) => repository.detachNormalBuyerEmail(s.scope,
    { expectedVersion: (await row(s)).version, email: s.newEmail }, claim);
  const assertAnonymous = (s, result) => {
    assert.match(result.globalUserId, /^usr_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
    assert.notEqual(result.globalUserId, s.buyerId); assert.equal(result.customer.email, s.newEmail);
    for (const key of ["email_verified", "phone_verified", "recognized_buyer", "isReturning", "address_verified"])
      assert.equal(result.customer[key], false);
    for (const key of ["fullName", "cpf", "phone", "address", "externalCustomerId", "asaasCustomerId"])
      assert.equal(result.customer[key], undefined);
    for (const key of ["otp_code", "otp_expires_at", "phone_otp_code"]) assert.equal(result.customer[key], "");
    assert.equal(result.shipping, undefined); assert.equal(result.shippingOptions, undefined);
  };

  await check("normal correction detaches anonymous identity and preserves actual source/options/P/original ACK", async () => {
    const s = await seed("detach"), before = await row(s), beforeSource = await source(s);
    const original = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: s.scope.merchantId, causationId: s.suggestionId } });
    const result = await detach(s); assertAnonymous(s, result); assert.equal(result.persistenceVersion, before.version + 1);
    assert.deepEqual(await source(s), beforeSource); assert.deepEqual((await row(s)).cart, before.cart);
    assert.deepEqual(await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: original.eventId } }), original);
    const recorded = await proofs(s); assert.equal(recorded.length, 1); assert.equal(recorded[0].payload.event_name, "buyer_identity_detached");
    const proof = recorded[0].payload.metadata.identity_detachment;
    assert.equal(proof.protocol, "checkout_buyer_identity_detachment_v1"); assert.equal("verifiedAt" in proof, false);
    assert.equal("email" in proof, false); assert.equal(proof.fromBuyerId, s.buyerId); assert.equal(proof.toBuyerId, result.globalUserId);
    const read = await fixture.adapter.read(s.scope); assert.equal(read.cart.total, 47); assert.equal(read.cart.discountBudget.promotionDiscountCents, 300);
    const ack = await fixture.adapter.accept(s.scope, s.acceptance); assert.equal(ack.quoteHash, original.payload.ack.quoteHash);
    assert.equal(await prisma.buyerAccount.count({ where: { globalUserId: result.globalUserId } }), 0);
  });
  await check("normal correction own actual chat claim remains processing without replay or completion", async () => {
    const s = await seed("own-claim"), stored = await row(s), claim = { requestId: `${s.scope.sessionId}-request`, requestHash: "c".repeat(64) };
    await prisma.checkoutChatRequest.create({ data: { id: claim.requestId, ...s.scope, conversationId: stored.conversationId,
      messageId: `${s.scope.sessionId}-message`, requestHash: claim.requestHash, status: "processing", startedAt: new Date() }, select: { id: true } });
    assertAnonymous(s, await detach(s, claim));
    assert.equal((await prisma.checkoutChatRequest.findUniqueOrThrow({ where: { id_merchantId: { id: claim.requestId, merchantId: s.scope.merchantId } } })).status, "processing");
    assert.equal((await proofs(s)).length, 1);
  });
  await check("normal correction unknown chat refuses with zero partial privacy or financial writes", async () => {
    const s = await seed("unknown"), before = await row(s), beforeSource = await source(s);
    await prisma.checkoutChatRequest.create({ data: { id: `${s.scope.sessionId}-request`, ...s.scope, conversationId: before.conversationId,
      messageId: `${s.scope.sessionId}-message`, requestHash: "d".repeat(64), status: "unknown", startedAt: new Date() }, select: { id: true } });
    await assert.rejects(detach(s), /checkout_buyer_identity_review_required/);
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource); assert.equal((await proofs(s)).length, 0);
  });
  await check("normal correction then actual new OTP proves anonymous to canonical account without moving old profile", async () => {
    const s = await seed("new-otp"), beforeSource = await source(s), oldAccount = await prisma.buyerAccount.findUniqueOrThrow({ where: { globalUserId: s.buyerId }, select: accountSelect });
    const originalAck = await fixture.adapter.accept(s.scope, s.acceptance);
    const anonymous = await detach(s), canonical = `${s.scope.sessionId}-new-account`; await account(canonical, s.newEmail);
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: { customer: { ...anonymous.customer,
      otp_code: "654321", otp_expires_at: new Date(Date.now() + 600_000).toISOString() } }, select: { id: true } });
    const verified = await repository.verifyEmailOtpAndRecognize(s.scope, { expectedVersion: (await row(s)).version, code: "654321" });
    assert.equal(verified.globalUserId, canonical); assert.equal(verified.customer.email_verified, true);
    assert.equal(verified.customer.otp_code, ""); assert.deepEqual(await source(s), beforeSource);
    const recorded = await proofs(s); assert.deepEqual(recorded.map(value => value.payload.event_name), ["buyer_identity_detached", "auth_identity_confirmed"]);
    assert.equal(recorded[1].payload.metadata.identity_transition.fromBuyerId, anonymous.globalUserId);
    assert.equal(recorded[1].payload.metadata.identity_transition.toBuyerId, canonical);
    assert.deepEqual(await prisma.buyerAccount.findUniqueOrThrow({ where: { globalUserId: s.buyerId }, select: accountSelect }), oldAccount);
    assert.equal((await fixture.adapter.read(s.scope)).cart.total, 47);
    assert.deepEqual(await fixture.adapter.accept(s.scope, s.acceptance), originalAck);
  });
  await check("normal correction named SQL outbox fault rolls back UID/customer/source/paired event", async () => {
    const s = await seed("rollback"), before = await row(s), beforeSource = await source(s), eventCount = await prisma.checkoutEvent.count({ where: s.scope });
    await prisma.$executeRawUnsafe(`ALTER TABLE outbox_messages ADD CONSTRAINT synthetic_normal_detachment_rollback
      CHECK (NOT (event_type='checkout.event.tracked' AND merchant_id='${s.scope.merchantId}' AND payload->>'session_id'='${s.scope.sessionId}'))`);
    try { await assert.rejects(detach(s), /synthetic_normal_detachment_rollback/); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE outbox_messages DROP CONSTRAINT synthetic_normal_detachment_rollback"); }
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource);
    assert.equal(await prisma.checkoutEvent.count({ where: s.scope }), eventCount); assert.equal((await proofs(s)).length, 0);
  });
  await check("normal correction refuses an actual personal coupon before UID, reservation or D can move", async () => {
    const s = await seed("coupon", { coupon: true }), before = await row(s), beforeSource = await source(s);
    const reservation = await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: s.scope.merchantId, sessionId: s.cartId } });
    await assert.rejects(detach(s), /checkout_buyer_identity_review_required/);
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource);
    assert.deepEqual(await prisma.couponRedemption.findUniqueOrThrow({ where: { id: reservation.id } }), reservation); assert.equal((await proofs(s)).length, 0);
  });
  await check("normal corrected anonymous session rejects old trusted buyer and cleared-shipping payment before provider", async () => {
    const s = await seed("old-principal"), detached = await detach(s); let hydrationCalls = 0, providerCalls = 0;
    const customers = new CheckoutCustomerService(repository, undefined, new OtpService(), {
      recognizeVerifiedBuyer: async () => { hydrationCalls++; throw new Error("synthetic_unverified_hydration_forbidden"); },
    });
    await assert.rejects(customers.prepareTrustedBuyerForCheckout(detached, { globalUserId: s.buyerId,
      customer: { email: s.oldEmail, email_verified: true } }), /checkout_buyer_session_binding_mismatch/);
    assert.equal(await customers.hydrateReturningBuyerFromEmailHint(detached), detached); assert.equal(hydrationCalls, 0);
    const deps = [repository, {}, {}, { createPayment: async () => { providerCalls++; throw new Error("synthetic_provider_forbidden"); } }]; deps[12] = prisma;
    const payments = new CreatePaymentIntentUseCase(...deps);
    // Narrow proof: clearing physical shipping blocks this entry before I/O.
    // It does NOT claim the separate unverified+restored-shipping gate is closed.
    await assert.rejects(payments.execute({ merchant_id: s.scope.merchantId, session_id: s.scope.sessionId,
      idempotency_key: `${s.scope.sessionId}-payment`, method: "pix" }), /shipping_method_required_before_payment/);
    assert.equal(providerCalls, 0); assert.equal(await prisma.paymentIntent.count({ where: s.scope }), 0);
    assert.equal(await prisma.completedOrder.count({ where: s.scope }), 0); assert.equal((await fixture.adapter.read(s.scope)).cart.total, 47);
  });
  await check("normal detached identity with persisted shipping restored refuses NEW payment before external preparation", async () => {
    const s = await seed("payment-preflight"), detached = await detach(s); let providerCalls = 0, pendingCalls = 0, merchantCalls = 0;
    // Restore this owned fixture's actual address/selected shipping in storage,
    // not in the payment request. The identity remains explicitly unverified.
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: {
      customer: { ...detached.customer, address: fixture.customer.address, address_verified: true },
      shipping: { customerPrice: 9, carrier: "Synthetic carrier", method: "Synthetic delivery", deliveryDays: 1,
        destinationZip: fixture.customer.address.zip, region: fixture.customer.address.state },
    }, select: { id: true } });
    const before = await row(s), beforeSource = await source(s), beforeProofs = await proofs(s);
    const forbiddenProvider = async () => { providerCalls++; throw new Error("synthetic_provider_preparation_forbidden"); };
    const deps = [repository, { getProfile: async () => { merchantCalls++; throw new Error("synthetic_merchant_route_after_identity_guard"); } },
      { listForSession: async () => [], getByIdempotency: async () => undefined },
      { createPayment: forbiddenProvider, preparePayment: forbiddenProvider, ensureCustomer: forbiddenProvider }];
    deps[6] = { execute: async () => { pendingCalls++; throw new Error("synthetic_pending_order_forbidden"); } }; deps[12] = prisma;
    await assert.rejects(new CreatePaymentIntentUseCase(...deps).execute({ merchant_id: s.scope.merchantId,
      session_id: s.scope.sessionId, idempotency_key: `${s.scope.sessionId}-payment`, method: "pix" }), error => {
      assert.equal(error.message, "cross_sell_quote_review_required"); assert.equal(error.getStatus(), 409); return true;
    });
    assert.equal(providerCalls, 0); assert.equal(pendingCalls, 0); assert.equal(merchantCalls, 0);
    assert.equal(await prisma.paymentIntent.count({ where: s.scope }), 0); assert.equal(await prisma.completedOrder.count({ where: s.scope }), 0);
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource); assert.deepEqual(await proofs(s), beforeProofs);
  });
}
