import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { BuyerChannelIdentityService } from "../services/buyer-channel-identity.service.js";
import { LinkBuyerWhatsAppUseCase } from "./link-buyer-whatsapp.use-case.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";
import { RouteToSessionUseCase } from "../../../whatsapp-channel/application/use-cases/route-to-session.use-case.js";
import { NestFactory } from "@nestjs/core";
import { BuyerWhatsAppLinkController } from "../../presentation/http/buyer-whatsapp-link.controller.js";
import { BuyerJwtAuthGuard } from "../../presentation/http/buyer-jwt-auth.guard.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { VerifyBuyerPhoneCodeUseCase } from "./verify-buyer-phone-code.use-case.js";

const schema = `cashback_identity_${randomUUID().replace(/-/g, "")}`;
const url = new URL(process.env.CASHBACK_TEST_DATABASE_URL ?? "postgresql://cashback:cashback-local-test@127.0.0.1:15433/cashback");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Cashback tests require an exclusive local database");
url.searchParams.set("schema", schema);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const identities = new BuyerChannelIdentityService(prisma);
const aliases: any[] = [];
const otp = new InMemoryOtpStore();
let delivered: string[] = [];
const links = new LinkBuyerWhatsAppUseCase(identities, otp, {
  findByGlobalUserId: async (id: string) => ["web_buyer", "other_buyer"].includes(id) ? { globalUserId: id } : null,
} as any, { execute: async (input) => { delivered.push(String(input.variables?.otpCode)); return { channel: "whatsapp_template", status: "sent", messageId: "wamid.local" }; } }, {
  linkVerifiedIdentity: async (input: any) => { aliases.push(input); },
} as any);

before(async () => {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await prisma.$executeRawUnsafe(`CREATE TABLE buyer_verified_phones(phone TEXT PRIMARY KEY,buyer_id TEXT NOT NULL,verification_id TEXT NOT NULL UNIQUE,verified_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "BuyerIdentity"(id TEXT PRIMARY KEY,"merchantId" TEXT,"identityKey" TEXT,"globalUserId" TEXT)`);
  // Delegate model queries without relying on the rest of the commerce schema.
  (prisma as any).buyerIdentity = { findMany: async () => [{ merchantId: "m", globalUserId: "wa_previous" }] };
});
after(async () => { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await prisma.$disconnect(); });

test("CB-07 CB-20 verified WhatsApp phone resolves to the same website account and repairs old merchant identity", async () => {
  const sent = await links.send("web_buyer", "(11) 98888-7777", "merchant-a");
  assert.deepEqual(sent, { sent: true, delivered_to: "***7777" });
  assert.equal(await identities.verifiedAccount("5511988887777"), null);
  await assert.rejects(links.verify("web_buyer", "11988887777", "000000", "merchant-a"), /otp_invalid/);
  assert.equal(await identities.verifiedAccount("5511988887777"), null);
  await links.verify("web_buyer", "11988887777", delivered[0], "merchant-a");
  assert.equal(await identities.verifiedAccount("+55 11 98888-7777"), "web_buyer");
  assert.deepEqual(await identities.status("web_buyer"), { linked: true, phone: "+55 (***) *****-7777" });
  assert.equal(aliases[0].merchantId, "m"); assert.equal(aliases[0].previousBuyerId, "wa_previous");
  assert.equal(aliases[0].canonicalBuyerId, "web_buyer"); assert.ok(aliases[0].verificationId);
  await assert.rejects(links.verify("web_buyer", "11988887777", delivered[0], "merchant-a"), /otp_expired_or_locked/);
});

test("CB-07 another account cannot steal an already linked WhatsApp phone even with a new OTP", async () => {
  await links.send("other_buyer", "11988887777", "merchant-a");
  await assert.rejects(links.verify("other_buyer", "11988887777", delivered.at(-1), "merchant-a"), /phone_already_linked/);
  assert.equal(await identities.verifiedAccount("5511988887777"), "web_buyer");
  assert.deepEqual(await identities.status("other_buyer"), { linked: false, phone: null });
});

test("CB-07 WhatsApp routing uses the canonical website account after verified linking", async () => {
  let sessionCreated: any;
  const transaction={ $queryRaw:async()=>[], checkoutSession:{create:async(input:any)=>{sessionCreated=input.data;}} };
  const route = new RouteToSessionUseCase({ findActiveByPhone: async () => null, create: async (input: any) => ({ ...input, id: "wa_session" }) } as any,
    { buyerIdentity: { findUnique: async () => ({ globalUserId: "wa_previous" }) }, checkoutSession: {
      findFirst: async () => ({ customer: { fullName: "Ana" } }),
    }, $transaction:async(work:(tx:typeof transaction)=>Promise<unknown>)=>work(transaction) } as any, identities);
  const result = await route.execute({ merchantId: "m", deviceId: "dev", fromNumber: "5511988887777" });
  assert.equal(result.buyerData.globalUserId, "web_buyer"); assert.equal(sessionCreated.globalUserId, "web_buyer");
  assert.equal(sessionCreated.customer.phone_verified, true);
});

test("CB-07 phone typed in a profile cannot establish a canonical account without possession proof", async () => {
  assert.equal(await identities.verifiedAccount("5511977776666"), null);
  assert.deepEqual(await identities.status("unknown"), { linked: false, phone: null });
  await assert.rejects(links.send("unknown", "11977776666", "merchant-a"), /buyer_account_not_found/);
});

test("CB-07 HTTP link derives the account from buyer JWT and rejects anonymous and forged account bodies", async () => {
  const jwt = new BuyerJwtService("cashback-local-identity-test-only-secret");
  // The lightweight TS test loader disables emitted type metadata. Restore the
  // declared constructor dependencies; the actual JWT guard still authenticates.
  Reflect.defineMetadata("design:paramtypes", [BuyerChannelIdentityService, LinkBuyerWhatsAppUseCase], BuyerWhatsAppLinkController);
  Reflect.defineMetadata("design:paramtypes", [BuyerJwtService], BuyerJwtAuthGuard);
  const app = await NestFactory.create({ module: class IdentityHttpTest {}, controllers: [BuyerWhatsAppLinkController], providers: [
    BuyerJwtAuthGuard, { provide: BuyerJwtService, useValue: jwt },
    { provide: BuyerChannelIdentityService, useValue: identities }, { provide: LinkBuyerWhatsAppUseCase, useValue: links },
  ] }, { logger: false });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(); const path = "/buyer/me/channels/whatsapp";
  const token = jwt.sign({ globalUserId: "web_buyer", email: "web@example.test" });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    assert.equal((await fetch(base + path)).status, 401);
    const sent = await fetch(base + path + "/code", { method: "POST", headers,
      body: JSON.stringify({ merchantId: "merchant-a", phone: "11966665555", buyerId: "other_buyer" }) });
    assert.equal(sent.status, 201); assert.deepEqual(await sent.json(), { sent: true, delivered_to: "***5555" });
    const verified = await fetch(base + path + "/verify", { method: "POST", headers,
      body: JSON.stringify({ merchantId: "merchant-a", phone: "11966665555", code: delivered.at(-1), buyerId: "other_buyer" }) });
    assert.equal(verified.status, 201); assert.deepEqual(await verified.json(), { linked: true, phone: "+55 (***) *****-5555" });
    assert.equal(await identities.verifiedAccount("5511966665555"), "web_buyer");
    const other = await fetch(base + path, { headers: { authorization: `Bearer ${jwt.sign({ globalUserId: "other_buyer", email: "other@example.test" })}` } });
    assert.deepEqual(await other.json(), { linked: false, phone: null });
  } finally { await app.close(); }
});

test("CB-07 phone OTP login uses the website canonical account and preserves its original linkage proof", async () => {
  const [proofBefore] = await prisma.$queryRaw<Array<{ verification_id: string }>>`SELECT verification_id FROM buyer_verified_phones WHERE phone='5511988887777'`;
  await otp.save({ phone: "BR:5511988887777", codeHash: createHash("sha256").update("334455").digest("hex"),
    maxAttempts: 5, expiresAt: new Date(Date.now() + 60000) });
  const jwt = new BuyerJwtService("local-test-login-secret-for-cashback");
  const auth = new VerifyBuyerPhoneCodeUseCase({
    findByGlobalUserId: async (id: string) => ({ globalUserId: id, email: "web@example.test", displayName: "Ana" }),
    findByPhone: async () => assert.fail("A verified canonical mapping must take precedence over a legacy profile phone"),
  } as any, otp, jwt, identities, links);
  const result = await auth.execute({ phone: "5511988887777", code: "334455" });
  assert.equal(result.globalUserId, "web_buyer"); assert.equal(jwt.verify(result.accessToken).globalUserId, "web_buyer");
  const [proofAfter] = await prisma.$queryRaw<Array<{ verification_id: string }>>`SELECT verification_id FROM buyer_verified_phones WHERE phone='5511988887777'`;
  assert.deepEqual(proofAfter, proofBefore);
  await assert.rejects(auth.execute({ phone: "5511988887777", code: "334455" }), /otp_expired/);
});
