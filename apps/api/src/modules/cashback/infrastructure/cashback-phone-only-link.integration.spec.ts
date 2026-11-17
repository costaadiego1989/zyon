import "reflect-metadata";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { buyerPhoneLookupHash, encryptPii } from "../../../shared/crypto/pii-cipher.service.js";
import { CashbackRepository } from "./cashback.repository.js";
import { CashbackService } from "../application/cashback.service.js";
import { BuyerChannelIdentityService } from "../../buyer-account/application/services/buyer-channel-identity.service.js";
import { LinkBuyerWhatsAppUseCase } from "../../buyer-account/application/use-cases/link-buyer-whatsapp.use-case.js";
import { BuyerInboundWhatsAppLinkUseCase } from "../../buyer-account/application/use-cases/buyer-inbound-whatsapp-link.use-case.js";
import { PrismaBuyerAccountRepository } from "../../buyer-account/infrastructure/prisma-buyer-account.repository.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";

const previousKey = process.env.AACP_PII_ENC_KEY;
process.env.AACP_PII_ENC_KEY = "isolated-phone-only-reconciliation-local-key";
const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); if (previousKey === undefined) delete process.env.AACP_PII_ENC_KEY; else process.env.AACP_PII_ENC_KEY = previousKey; });

async function fixture(t: TestContext) {
  const merchantId = "qa_phone_merge_" + randomUUID(), previous = "qa_phone_old_" + randomUUID(), canonical = "qa_phone_web_" + randomUUID();
  const phone = "55119" + randomInt(10000000, 99999999), verificationId = randomUUID(), sessionId = randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "QA phone-only merge" } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_phone_merge_"));
    for (const table of ["cashback_refund_operations", "cashback_buyer_aliases", "cashback_event_receipts", "cashback_budget_periods", "cashback_earning_quotes", "cashback_ledger_entries", "cashback_reservations", "cashback_grants", "cashback_wallets", "cashback_rule_versions", "cashback_programs"])
      await db.$executeRawUnsafe('DELETE FROM "' + table + '" WHERE merchant_id=$1', merchantId);
    const challenges = await db.buyerPhoneOtp.findMany({ where: { phone: { startsWith: "link-inbound:" } } });
    for (const row of challenges) if (JSON.parse(row.codeHash).buyerId === canonical) await db.buyerPhoneOtp.deleteMany({ where: { OR: [{ id: row.id }, { codeHash: row.phone }] } });
    await db.$executeRaw`DELETE FROM buyer_verified_phones WHERE buyer_id=${canonical}`;
    await db.paymentIntent.deleteMany({ where: { merchantId } }); await db.checkoutSession.deleteMany({ where: { merchantId } });
    await db.buyerIdentity.deleteMany({ where: { merchantId } }); await db.merchant.delete({ where: { id: merchantId } });
    await db.buyerAccount.deleteMany({ where: { globalUserId: { in: [previous, canonical] } } });
  });
  await db.buyerAccount.createMany({ data: [
    { globalUserId: previous, email: `phone_${phone}@buyer.aacp`, passwordHash: null, phone: encryptPii(phone), phoneLookupHash: buyerPhoneLookupHash(phone), displayName: "Native anonymous buyer" },
    { globalUserId: canonical, email: canonical + "@example.test", passwordHash: "local-password-hash", displayName: "Website buyer" },
  ] });
  await db.buyerIdentity.create({ data: { merchantId, identityKey: "phone:" + phone, globalUserId: previous } });
  const service = new CashbackService(new CashbackRepository(db));
  for (const [buyer, amount] of [[previous, 1000], [canonical, 500]] as const) await service.adjustWallet(merchantId, buyer,
    { amountCents: amount, reason: "Owned local QA credit", expiryDays: null, idempotencyKey: randomUUID() }, "local-qa");
  const session = checkoutSession({ merchantId, sessionId, conversationId: randomUUID(), globalUserId: previous,
    customer: { phone, phone_verified: true }, cart: { currency: "BRL", total: 100, items: [{ sku: "qa", name: "Local QA", price: 100, quantity: 1 }] } });
  await new PrismaCheckoutRepository(db).saveSession(session);
  const payment = await db.paymentIntent.create({ data: { id: randomUUID(), merchantId, sessionId, idempotencyKey: randomUUID(), status: "pending", amountCents: 10000, currency: "BRL", method: "pix", buyerFacing: { qrCodeCopyPaste: "LOCAL-UNCHANGED-PIX" } } });
  const identities = new BuyerChannelIdentityService(db), accounts = new PrismaBuyerAccountRepository(db);
  await db.whatsAppChannelConfig.create({ data: { merchantId, provider: "META_CLOUD", enabled: true, status: "ACTIVE", whatsappNumber: "5511999999999" } });
  const links = new LinkBuyerWhatsAppUseCase(identities, {} as any, accounts, undefined, service);
  const inbound = new BuyerInboundWhatsAppLinkUseCase(identities, accounts, links);
  const challenge = await inbound.create(canonical, phone, merchantId), key = "link-inbound:" + createHash("sha256").update(challenge.token).digest("hex");
  const proof = async () => {
    await db.$transaction(tx => identities.bind(tx, canonical, phone, verificationId));
    const row = await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key } });
    await db.buyerPhoneOtp.update({ where: { phone: key }, data: { consumedAt: new Date(), attempts: 1, codeHash: JSON.stringify({ ...JSON.parse(row.codeHash), phase: "confirmed", verificationId }) } });
  };
  const snapshot = async () => ({
    accounts: await db.buyerAccount.findMany({ where: { globalUserId: { in: [previous, canonical] } }, orderBy: { globalUserId: "asc" } }),
    checkout: await db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } }),
    payment: await db.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } }),
    ledger: await db.$queryRaw`SELECT * FROM cashback_ledger_entries WHERE merchant_id=${merchantId} ORDER BY id`,
    aliases: await db.$queryRaw`SELECT * FROM cashback_buyer_aliases WHERE merchant_id=${merchantId} ORDER BY alias_buyer_id`,
    grants: await db.$queryRaw`SELECT * FROM cashback_grants WHERE merchant_id=${merchantId} ORDER BY id`,
    wallets: await db.$queryRaw`SELECT * FROM cashback_wallets WHERE merchant_id=${merchantId} ORDER BY buyer_id`,
  });
  const input = { merchantId, previousBuyerId: previous, canonicalBuyerId: canonical, verificationId };
  return { merchantId, previous, canonical, phone, verificationId, service, identities, inbound, challenge, proof, snapshot, input };
}

test("C1/C3/C4 exact verified phone-only account settles inbound status once with conserved credit and unchanged ledger/accounts/payment", async t => {
  const f = await fixture(t); await f.proof(); const before = await f.snapshot();
  assert.deepEqual(await f.inbound.status(f.canonical, f.challenge.token), { status: "confirmed", linked: true, phone: "+55 (***) *****-" + f.phone.slice(-4) });
  const after = await f.snapshot();
  assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.payment, before.payment); assert.deepEqual(after.ledger, before.ledger);
  assert.deepEqual({ ...after.checkout, globalUserId: before.checkout.globalUserId }, before.checkout);
  assert.equal(after.checkout.globalUserId, f.canonical);
  assert.equal((await f.service.wallet(f.merchantId, f.canonical)).balance.availableCents, 1500);
  assert.equal((await f.service.wallet(f.merchantId, f.previous)).balance.availableCents, 1500);
  const settled = await f.snapshot();
  await Promise.all([f.inbound.status(f.canonical, f.challenge.token), f.inbound.status(f.canonical, f.challenge.token)]);
  assert.deepEqual(await f.snapshot(), settled);
  assert.equal((settled.aliases as any[]).length, 1);
});

for (const variant of ["real_email", "different_phone_email", "password", "empty_password", "passkey", "foreign_phone_hash", "missing_phone_hash", "missing_proof", "wrong_proof"])
  test("C2 retains established-account and ownership barrier for " + variant, async t => {
    const f = await fixture(t);
    if (variant !== "missing_proof") await f.proof();
    if (variant === "real_email") await db.buyerAccount.update({ where: { globalUserId: f.previous }, data: { email: f.previous + "@example.test" } });
    if (variant === "different_phone_email") await db.buyerAccount.update({ where: { globalUserId: f.previous }, data: { email: "phone_5511999999999@buyer.aacp" } });
    if (variant === "password" || variant === "empty_password") await db.buyerAccount.update({ where: { globalUserId: f.previous }, data: { passwordHash: variant === "password" ? "local-password-hash" : "" } });
    if (variant === "foreign_phone_hash" || variant === "missing_phone_hash") await db.buyerAccount.update({ where: { globalUserId: f.previous }, data: { phoneLookupHash: variant === "missing_phone_hash" ? null : buyerPhoneLookupHash("5511999999999") } });
    if (variant === "passkey") await db.webAuthnCredential.create({ data: { globalUserId: f.previous, credentialId: randomUUID(), publicKey: Buffer.from("owned-local-key"), origin: "https://local.test" } });
    const before = await f.snapshot();
    await assert.rejects(f.service.linkVerifiedIdentity({ ...f.input, ...(variant === "wrong_proof" ? { verificationId: randomUUID() } : {}) }), /merge_requires_review|proof_required/);
    assert.deepEqual(await f.snapshot(), before);
  });

test("C4 concurrent upgrade to a registered credential wins before anonymous reconciliation", async t => {
  const f = await fixture(t); await f.proof();
  let release!: () => void, locked!: () => void;
  const unlock = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { locked = resolve; });
  const upgrade = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT global_user_id FROM buyer_accounts WHERE global_user_id=${f.previous} FOR UPDATE`;
    locked(); await unlock;
    await tx.buyerAccount.update({ where: { globalUserId: f.previous }, data: { passwordHash: "registered-concurrently" } });
  });
  await acquired;
  const merging = f.service.linkVerifiedIdentity(f.input); const rejected = assert.rejects(merging, /merge_requires_review/);
  await new Promise(resolve => setTimeout(resolve, 60)); release(); await upgrade; await rejected;
  assert.equal((await f.snapshot()).aliases.length, 0);
  assert.equal((await db.paymentIntent.findFirstOrThrow({ where: { merchantId: f.merchantId } })).status, "pending");
});

test("C1 legacy anonymous identity without an account retains its existing verified reconciliation", async t => {
  const f = await fixture(t); await db.buyerAccount.delete({ where: { globalUserId: f.previous } }); await f.proof();
  const before = await f.snapshot(); await f.service.linkVerifiedIdentity(f.input);
  assert.equal((await f.service.wallet(f.merchantId, f.canonical)).balance.availableCents, 1500);
  const after = await f.snapshot(); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.ledger, before.ledger); assert.deepEqual(after.payment, before.payment);
});

test("C2 existing alias to another wallet cannot be redirected by a new phone proof", async t => {
  const f = await fixture(t), foreign = "qa_other_wallet_" + randomUUID();
  await f.service.adjustWallet(f.merchantId, foreign, { amountCents: 25, reason: "Owned local conflict fixture", expiryDays: null, idempotencyKey: randomUUID() }, "local-qa");
  await db.$executeRaw`INSERT INTO cashback_buyer_aliases(merchant_id,alias_buyer_id,canonical_buyer_id,verification_id) VALUES(${f.merchantId},${f.previous},${foreign},${randomUUID()})`;
  await f.proof(); const before = await f.snapshot();
  await assert.rejects(f.service.linkVerifiedIdentity(f.input), /identity_already_bound/);
  assert.deepEqual(await f.snapshot(), before);
});
