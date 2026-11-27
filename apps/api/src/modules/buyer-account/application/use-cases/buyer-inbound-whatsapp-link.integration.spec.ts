import "reflect-metadata";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { BuyerChannelIdentityService } from "../services/buyer-channel-identity.service.js";
import { BuyerInboundWhatsAppLinkUseCase } from "./buyer-inbound-whatsapp-link.use-case.js";
import { LinkBuyerWhatsAppUseCase } from "./link-buyer-whatsapp.use-case.js";
import { BuyerWhatsAppLinkController } from "../../presentation/http/buyer-whatsapp-link.controller.js";
import { BuyerJwtAuthGuard } from "../../presentation/http/buyer-jwt-auth.guard.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { PrismaBuyerAccountRepository } from "../../infrastructure/prisma-buyer-account.repository.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => db.$disconnect());
const key = (token: string) => "link-inbound:" + createHash("sha256").update(token).digest("hex");

async function fixture(t: TestContext) {
  const buyerId = "qa_inbound_" + randomUUID(), merchantId = "qa_inbound_" + randomUUID(), phone = "5511990001111";
  const buyer = await db.buyerAccount.create({ data: { globalUserId: buyerId, email: buyerId + "@example.test", passwordHash: "local-test-password-hash", displayName: "QA" } });
  await db.merchant.create({ data: { id: merchantId, name: "QA inbound" } });
  const config = await db.whatsAppChannelConfig.create({ data: { merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE", whatsappNumber: "+5511999999999",
    credentials: { canonicalChatNumber: "5511888888888" } } });
  const identities = new BuyerChannelIdentityService(db), accounts = new PrismaBuyerAccountRepository(db);
  const service = new BuyerInboundWhatsAppLinkUseCase(identities, accounts);
  const ownedKeys = new Set<string>();
  t.after(async () => {
    const records = await db.buyerPhoneOtp.findMany({ where: { phone: { startsWith: "link-inbound:" } } });
    for (const row of records) if (ownedKeys.has(row.phone) || JSON.parse(row.codeHash).buyerId === buyerId) {
      await db.buyerPhoneOtp.deleteMany({ where: { phone: row.phone } });
      await db.buyerPhoneOtp.deleteMany({ where: { phone: { startsWith: "link-inbound-rate:" }, codeHash: row.phone } });
    }
    await db.merchant.delete({ where: { id: merchantId } });
    await db.buyerAccount.delete({ where: { globalUserId: buyerId } });
  });
  return { buyerId, buyer, merchantId, phone, config, identities, service, create: async () => { const result = await service.create(buyerId, phone, merchantId); ownedKeys.add(key(result.token)); return result; } };
}

test("C1 authenticated buyer receives only a scoped random five-minute challenge and official canonical chat", async t => {
  const f = await fixture(t), before = Date.now(), result = await f.create();
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(result.url); assert.equal(url.origin, "https://wa.me"); assert.equal(url.pathname, "/5511888888888");
  assert.equal(url.searchParams.get("text"), "Vincular minha conta " + result.token);
  assert.equal(result.phone, "***1111");
  assert.ok(new Date(result.expiresAt).getTime() >= before + 300_000 && new Date(result.expiresAt).getTime() <= Date.now() + 300_000);
  const row = await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(result.token) } });
  const data = JSON.parse(row.codeHash);
  assert.deepEqual(data, { version: 1, buyerId: f.buyerId, merchantId: f.merchantId, configId: f.config.id, phone: f.phone,
    emailHint: "q***@example.test", phase: "pending" });
  assert.equal(row.consumedAt, null); assert.equal(row.attempts, 0); assert.equal(row.maxAttempts, 1);
  assert.equal(JSON.stringify(row).includes(result.token), false);
  assert.deepEqual(await f.service.status(f.buyerId, result.token), { status: "pending", linked: false, phone: null });
  assert.equal((await f.identities.status(f.buyerId)).linked, false);
  assert.equal(await db.paymentIntent.count({ where: { merchantId: f.merchantId } }), 0);
});

test("C1 simultaneous resend allows one capability and atomically cancels the replaced challenge after one minute", async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.create(), f.create()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const first = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof f.create>>>).value;
  assert.match(String((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason), /resend_too_soon/);
  await db.buyerPhoneOtp.updateMany({ where: { codeHash: key(first.token) }, data: { lastSentAt: new Date(Date.now() - 60_001) } });
  const second = await f.create(); assert.notEqual(second.token, first.token);
  assert.deepEqual(await f.service.status(f.buyerId, first.token), { status: "cancelled", linked: false, phone: null });
  assert.deepEqual(await f.service.status(f.buyerId, second.token), { status: "pending", linked: false, phone: null });
});

for (const variant of ["expired", "foreign_buyer", "foreign_scope", "disabled", "provider", "unregistered", "malformed"])
  test("C1 challenge status rejects or marks invalid " + variant + " without linking", async t => {
    const f = await fixture(t), result = await f.create();
    if (variant === "expired") {
      await db.buyerPhoneOtp.update({ where: { phone: key(result.token) }, data: { expiresAt: new Date(0) } });
      assert.deepEqual(await f.service.status(f.buyerId, result.token), { status: "expired", linked: false, phone: null });
    } else {
      if (variant === "disabled") await db.whatsAppChannelConfig.update({ where: { id: f.config.id }, data: { enabled: false } });
      if (variant === "provider") await db.whatsAppChannelConfig.update({ where: { id: f.config.id }, data: { provider: "BUBBLEWHATS" } });
      if (variant === "unregistered") await db.buyerAccount.update({ where: { globalUserId: f.buyerId }, data: { email: "phone_qa@buyer.aacp" } });
      if (variant === "malformed") await db.buyerPhoneOtp.update({ where: { phone: key(result.token) }, data: { codeHash: "{}" } });
      await assert.rejects(f.service.status(variant === "foreign_buyer" ? "unknown" : f.buyerId, result.token, variant === "foreign_scope" ? "other-merchant" : undefined),
        /registered_buyer_required|scope_invalid|channel_unavailable|link_invalid/);
    }
    assert.equal((await f.identities.status(f.buyerId)).linked, false);
  });

test("C1 actual HTTP derives buyer and tenant from JWT, rejects anonymous/forged body identity and preserves strict OTP endpoints", async t => {
  const f = await fixture(t), jwt = new BuyerJwtService("inbound-link-local-http-secret-only");
  Reflect.defineMetadata("design:paramtypes", [BuyerChannelIdentityService, LinkBuyerWhatsAppUseCase, BuyerInboundWhatsAppLinkUseCase], BuyerWhatsAppLinkController);
  Reflect.defineMetadata("design:paramtypes", [BuyerJwtService], BuyerJwtAuthGuard);
  const app = await NestFactory.create({ module: class InboundHttp {}, controllers: [BuyerWhatsAppLinkController], providers: [BuyerJwtAuthGuard,
    { provide: BuyerJwtService, useValue: jwt }, { provide: BuyerChannelIdentityService, useValue: f.identities },
    { provide: LinkBuyerWhatsAppUseCase, useValue: {} }, { provide: BuyerInboundWhatsAppLinkUseCase, useValue: f.service }] }, { logger: false });
  await app.listen(0, "127.0.0.1"); t.after(() => app.close());
  const base = await app.getUrl(), path = "/buyer/me/channels/whatsapp/inbound";
  const body = JSON.stringify({ phone: f.phone, merchantId: f.merchantId, buyerId: "forged" });
  assert.equal((await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
  const headers = { "content-type": "application/json", authorization: "Bearer " + jwt.sign({ globalUserId: f.buyerId, email: f.buyer.email, merchantId: f.merchantId }) };
  const created = await fetch(base + path, { method: "POST", headers, body }); assert.equal(created.status, 201);
  const result = await created.json() as any;
  assert.equal(JSON.parse((await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(result.token) } })).codeHash).buyerId, f.buyerId);
  const status = await fetch(base + path + "/status", { method: "POST", headers, body: JSON.stringify({ token: result.token, buyerId: "forged" }) });
  assert.equal(status.status, 201); assert.deepEqual(await status.json(), { status: "pending", linked: false, phone: null });
  const foreign = { ...headers, authorization: "Bearer " + jwt.sign({ globalUserId: f.buyerId, email: f.buyer.email, merchantId: "foreign" }) };
  assert.equal((await fetch(base + path + "/status", { method: "POST", headers: foreign, body: JSON.stringify({ token: result.token }) })).status, 403);
  assert.equal((await fetch(base + path, { method: "POST", headers: foreign, body })).status, 403);
});
