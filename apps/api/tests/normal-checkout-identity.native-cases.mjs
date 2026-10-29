import assert from "node:assert/strict";

/** Consumes only the existing owned native Prisma fixture. No provider, env,
 * migration, new lifecycle or cleanup of another namespace. */
export async function runNormalCheckoutIdentityNativeCases({ prisma, check, runId }) {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  assert.deepEqual(await prisma.$queryRaw`SELECT to_regclass('public.buyer_accounts')::text AS account`, [{ account: "buyer_accounts" }]);
  const { createNormalCrossSellSourceNativeFixture } = await import("./normal-cross-sell-source.native-cases.mjs");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { CheckoutCustomerService } = await import("../src/modules/checkout/application/services/checkout-customer.service.ts");
  const { BuyerRecognitionService } = await import("../src/modules/checkout/application/services/buyer-recognition.service.ts");
  const { BuyerAccount } = await import("../src/modules/buyer-account/domain/entities/buyer-account.entity.ts");
  const { OtpService } = await import("../src/modules/checkout/application/services/otp.service.ts");
  const fixture = await createNormalCrossSellSourceNativeFixture({ prisma, runId, namespace: "identity" });
  const repository = new PrismaCheckoutRepository(prisma);
  const row = s => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: s.scope } });
  const source = s => prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: s.scope.merchantId, sessionId: s.cartId } } });
  async function account(s, uid = `${s.scope.sessionId}-returning`) {
    // Exact columns of the real initial buyer_accounts migration; no password is
    // used for login and no account/profile delegate with absent fixture fields.
    await prisma.$executeRaw`INSERT INTO buyer_accounts(global_user_id,email,password_hash,display_name,updated_at)
      VALUES (${uid},${s.email},'synthetic-unused-hash','Synthetic returning buyer',CURRENT_TIMESTAMP)`;
    return uid;
  }
  async function seed(label, { coupon = false, existingAccount = true } = {}) {
    const s = await fixture.seed(label, { coupon }); s.email = `${s.scope.sessionId}@example.test`;
    if (coupon) await fixture.adapter.accept(s.scope, s.acceptance);
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: { customer: { ...s.customer,
      email: s.email, email_verified: false, otp_code: "123456", otp_expires_at: new Date(Date.now() + 600_000).toISOString() } }, select: { id: true } });
    // Requote after changing canonical identity context; no stale expected quote.
    // A coupon requires verified identity during its existing admission. For the
    // negative personal-owner case, accept first under the actual verified owner
    // then seed the pending challenge as an adversarial changed-context fixture.
    if (!coupon) {
      s.quote = await fixture.adapter.quote(s.scope, s.request);
      s.acceptance = { suggestion_id: s.suggestionId, accepted_skus: [fixture.sku.a, fixture.sku.b], expected_quote: s.quote };
      await fixture.adapter.accept(s.scope, s.acceptance);
    }
    if (existingAccount) s.returningId = await account(s);
    return s;
  }
  const verify = async (s, claim) => repository.verifyEmailOtpAndRecognize(s.scope,
    { expectedVersion: (await row(s)).version, code: "123456" }, claim);
  const identities = s => prisma.outboxMessage.findMany({ where: { merchantId: s.scope.merchantId, eventType: "checkout.event.tracked",
    payload: { path: ["session_id"], equals: s.scope.sessionId } } });

  await check("normal OTP returning account commits UID/proof and preserves actual BASE source/options/P/ACK", async () => {
    const s = await seed("returning"), beforeSource = await source(s);
    const original = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: s.scope.merchantId, causationId: s.suggestionId } });
    const result = await verify(s); assert.equal(result.globalUserId, s.returningId);
    assert.equal(result.customer.email_verified, true); assert.equal(result.customer.otp_code, "");
    assert.deepEqual(await source(s), beforeSource);
    assert.deepEqual(await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: original.eventId } }), original);
    assert.equal((await identities(s)).length, 1);
    assert.equal((await fixture.adapter.read(s.scope)).cart.total, 47);
    assert.equal((await fixture.adapter.read(s.scope)).cart.discountBudget.promotionDiscountCents, 300);
    const ack = await fixture.adapter.accept(s.scope, s.acceptance);
    assert.equal(ack.quoteHash, original.payload.ack.quoteHash); assert.equal((await source(s)).items.length, 3);
    assert.equal(await repository.readVerifiedNormalBuyerIdentity(s.scope, { expectedVersion: result.persistenceVersion, expectedBuyerId: result.globalUserId }), s.returningId);
  });
  await check("normal OTP actual own processing claim is accepted without completing or replaying chat", async () => {
    const s = await seed("own-claim"), claim = { requestId: `${s.scope.sessionId}-request`, requestHash: "a".repeat(64) }, stored = await row(s);
    await prisma.checkoutChatRequest.create({ data: { id: claim.requestId, ...s.scope, conversationId: stored.conversationId,
      messageId: `${s.scope.sessionId}-message`, requestHash: claim.requestHash, status: "processing", startedAt: new Date() }, select: { id: true } });
    await verify(s, claim);
    assert.equal((await prisma.checkoutChatRequest.findUniqueOrThrow({ where: { id_merchantId: { id: claim.requestId, merchantId: s.scope.merchantId } } })).status, "processing");
    assert.equal((await row(s)).globalUserId, s.returningId); assert.equal((await identities(s)).length, 1);
  });
  await check("normal OTP unrelated unknown chat refuses before consuming actual current challenge", async () => {
    const s = await seed("unknown-claim"), before = await row(s);
    await prisma.checkoutChatRequest.create({ data: { id: `${s.scope.sessionId}-request`, ...s.scope, conversationId: before.conversationId,
      messageId: `${s.scope.sessionId}-message`, requestHash: "b".repeat(64), status: "unknown", startedAt: new Date() }, select: { id: true } });
    await assert.rejects(verify(s), /checkout_buyer_identity_review_required/);
    assert.deepEqual(await row(s), before); assert.equal((await identities(s)).length, 0);
  });
  await check("normal OTP event/outbox SQL failure rolls back UID/customer/event and leaves source intact", async () => {
    const s = await seed("rollback"), before = await row(s), beforeSource = await source(s);
    const eventCount = await prisma.checkoutEvent.count({ where: s.scope });
    await prisma.$executeRawUnsafe(`ALTER TABLE outbox_messages ADD CONSTRAINT synthetic_normal_identity_rollback
      CHECK (NOT (event_type='checkout.event.tracked' AND merchant_id='${s.scope.merchantId}' AND payload->>'session_id'='${s.scope.sessionId}'))`);
    try { await assert.rejects(verify(s), /synthetic_normal_identity_rollback/); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE outbox_messages DROP CONSTRAINT synthetic_normal_identity_rollback"); }
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource);
    assert.equal(await prisma.checkoutEvent.count({ where: s.scope }), eventCount); assert.equal((await identities(s)).length, 0);
  });
  await check("normal OTP account appearing after verification cannot steal acceptance through remount hydration", async () => {
    const s = await seed("account-phantom", { existingAccount: false }), verified = await verify(s);
    assert.equal(verified.globalUserId, s.buyerId); const before = await row(s); const canonical = await account(s);
    const buyers = { findByEmail: async email => {
      const rows = await prisma.$queryRaw`SELECT global_user_id AS id,email FROM buyer_accounts WHERE email=${email}`;
      if (!rows.length) return null;
      return new BuyerAccount({ globalUserId: rows[0].id, email: rows[0].email, passwordHash: "synthetic-unused-hash",
        displayName: "Synthetic returning buyer", createdAt: new Date(), updatedAt: new Date() });
    } };
    const customer = new CheckoutCustomerService(repository, undefined, new OtpService(), new BuyerRecognitionService(repository, buyers));
    await assert.rejects(customer.hydrateReturningBuyerFromEmailHint(verified), /checkout_buyer_session_binding_mismatch/);
    assert.notEqual(canonical, s.buyerId); assert.deepEqual(await row(s), before); assert.equal((await identities(s)).length, 1);
  });
  await check("normal OTP expired challenge never commits identity or changes the canonical source", async () => {
    const s = await seed("expired"), stored = await row(s);
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: { customer: { ...stored.customer,
      otp_expires_at: new Date(Date.now() - 1).toISOString() } }, select: { id: true } });
    const before = await row(s), beforeSource = await source(s);
    await assert.rejects(verify(s), /checkout_email_otp_expired/);
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource); assert.equal((await identities(s)).length, 0);
  });
  await check("normal OTP cannot move another buyer's actual coupon reservation or consume partially", async () => {
    const s = await seed("personal-coupon", { coupon: true }), before = await row(s), beforeSource = await source(s);
    const reservation = await prisma.couponRedemption.findFirstOrThrow({ where: { merchantId: s.scope.merchantId, sessionId: s.cartId } });
    await assert.rejects(verify(s), /checkout_buyer_identity_review_required/);
    assert.deepEqual(await row(s), before); assert.deepEqual(await source(s), beforeSource);
    assert.deepEqual(await prisma.couponRedemption.findUniqueOrThrow({ where: { id: reservation.id } }), reservation);
    assert.equal((await identities(s)).length, 0);
  });
}
