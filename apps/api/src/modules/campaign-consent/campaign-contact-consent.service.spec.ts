import test from "node:test";
import assert from "node:assert/strict";
import { CampaignContactConsentService } from "./campaign-contact-consent.service.js";

test("campaign consent persists merchant-scoped proof and cancellation on revocation", async () => {
  const upserts: any[] = []; const cancellations: any[] = [];
  const client: any = {
    campaignContactConsent: { async upsert(value: any) { upserts.push(value); } },
    postSaleScheduledMessage: { async updateMany(value: any) { cancellations.push(value); } },
    buyerPreference: { async findUnique() { return null; } },
  };
  client.$transaction = async (fn: any) => fn(client);
  const service = new CampaignContactConsentService(client);
  const input = { merchantId: "merchant-a", globalUserId: "buyer-a", channels: ["email", "whatsapp"] as const,
    policyVersion: "campaign-v1", source: "embedded_checkout", evidence: { checkoutSessionId: "checkout-a" } };
  await service.grant(input);
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].create.merchantId, "merchant-a");
  await service.revoke(input);
  assert.equal(upserts.length, 4);
  assert.deepEqual(cancellations[0].where, {
    merchantId: "merchant-a", buyerId: "buyer-a", channel: { in: ["email", "whatsapp"] }, status: "pending",
  });
});

test("campaign contact requires an active merchant grant and honors a later global opt-out", async () => {
  let preference: { emailOptIn: boolean; whatsappOptIn: boolean } | null = null;
  const service = new CampaignContactConsentService({
    campaignContactConsent: { async findUnique() { return { status: "granted", grantedAt: new Date(), revokedAt: null }; } },
    buyerPreference: { async findUnique() { return preference; } },
  } as any);
  assert.equal(await service.canContact({ merchantId: "merchant-a", globalUserId: "buyer-a", channel: "email" }), true);
  preference = { emailOptIn: false, whatsappOptIn: true };
  assert.equal(await service.canContact({ merchantId: "merchant-a", globalUserId: "buyer-a", channel: "email" }), false);
  assert.equal(await service.canContact({ merchantId: "merchant-a", globalUserId: "buyer-a", channel: "whatsapp" }), true);
});

test("campaign contact only exposes channels that remain eligible to the buyer", async () => {
  const service = new CampaignContactConsentService({
    campaignContactConsent: { async findUnique({ where }: any) {
      return where.merchantId_globalUserId_channel_purpose.channel === "email"
        ? { status: "granted", grantedAt: new Date(), revokedAt: null }
        : { status: "revoked", grantedAt: new Date(), revokedAt: new Date() };
    } },
    buyerPreference: { async findUnique() { return { emailOptIn: true, whatsappOptIn: true }; } },
  } as any);
  assert.deepEqual(
    await service.getGrantedChannels({ merchantId: "merchant-a", globalUserId: "buyer-a" }),
    ["email"],
  );
});

test("replacing campaign channels is atomic and cancels only the channels removed", async () => {
  const upserts: any[] = []; const cancellations: any[] = [];
  const client: any = {
    campaignContactConsent: { async upsert(value: any) { upserts.push(value); } },
    postSaleScheduledMessage: { async updateMany(value: any) { cancellations.push(value); } },
  };
  client.$transaction = async (fn: any) => fn(client);
  const service = new CampaignContactConsentService(client);
  await service.replace({ merchantId: "merchant-a", globalUserId: "buyer-a", channels: ["email"],
    policyVersion: "campaign-v1", source: "embedded_checkout", evidence: { checkoutSessionId: "checkout-a" } });
  assert.equal(upserts.length, 2);
  assert.equal(upserts.find((item) => item.create.channel === "email")?.create.status, "granted");
  assert.deepEqual(cancellations[0].where.channel, { in: ["whatsapp"] });
});
