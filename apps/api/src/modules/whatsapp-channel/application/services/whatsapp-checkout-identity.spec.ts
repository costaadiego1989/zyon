import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";
import { PrismaBuyerAccountRepository } from "../../../buyer-account/infrastructure/prisma-buyer-account.repository.js";
import { BuyerAccount } from "../../../buyer-account/domain/entities/buyer-account.entity.js";

const buyer = { globalUserId: "phone-session", phone: "552171191446" };

test("HUB-02 atomic phone-only creation encrypts the phone and preserves every existing profile field on repeat", async () => {
  const previous = process.env.AACP_PII_ENC_KEY;
  process.env.AACP_PII_ENC_KEY = "isolated-hub-unit-test-key";
  let stored: any;
  try {
    const repo = new PrismaBuyerAccountRepository({ buyerAccount: { upsert: async ({ create, update }: any) => {
      stored = stored ? { ...stored, ...update } : { ...create, cpf: null, createdAt: new Date(0), updatedAt: new Date(0) };
      return stored;
    } } } as any);
    const account = new BuyerAccount({ globalUserId: "canonical", phone: buyer.phone, email: `phone_${buyer.phone}@buyer.aacp`,
      displayName: "Cliente WhatsApp", passwordHash: null, createdAt: new Date(0), updatedAt: new Date(0) });
    const created = await repo.createPhoneOnlyIfAbsent(account);
    assert.equal(created?.phone, buyer.phone); assert.equal(created?.passwordHash, null); assert.notEqual(stored.phone, buyer.phone);
    const before = structuredClone(stored);
    const existing = await repo.createPhoneOnlyIfAbsent(new BuyerAccount({ ...account, displayName: "Must not overwrite" }));
    assert.equal(existing?.displayName, "Cliente WhatsApp"); assert.deepEqual(stored, before);
  } finally { if (previous === undefined) delete process.env.AACP_PII_ENC_KEY; else process.env.AACP_PII_ENC_KEY = previous; }
});

test("HUB-02 phone-only creation is bound to canonical merchant/phone identity and never sets a password", async () => {
  let created: any;
  const owner = { merchantId: "merchant", conversationId: "conversation", phone: "552171191446" };
  const service = new WhatsAppCheckoutIdentityService({ findByPhone: async () => null, createPhoneOnlyIfAbsent: async (account: any) => { created = account; return account; } } as any,
    { buyerIdentity: { findUnique: async (args: any) => {
      assert.deepEqual(args.where.merchantId_identityKey, { merchantId: "merchant", identityKey: "phone:552171191446" }); return { globalUserId: "canonical" };
    } } } as any);
  assert.equal(await service.ensurePhoneOnlyHubAccount({ owner, globalUserId: "forged" }), null); assert.equal(created, undefined);
  const account = await service.ensurePhoneOnlyHubAccount({ owner, globalUserId: "canonical" });
  assert.equal(account?.globalUserId, "canonical"); assert.equal(account?.phone, owner.phone);
  assert.equal(account?.email, "phone_552171191446@buyer.aacp"); assert.equal(account?.passwordHash, null);
});

test("HUB-02 an unrecognized channel binding cannot authorize a registered profile appearing during phone-only resolution", async () => {
  const owner = { merchantId: "merchant", conversationId: "conversation", phone: buyer.phone };
  const registered = { globalUserId: "canonical", phone: buyer.phone, email: "private@example.com" };
  for (const stage of ["lookup", "create-race"]) {
    const service = new WhatsAppCheckoutIdentityService({
      findByPhone: async () => stage === "lookup" ? registered : null,
      createPhoneOnlyIfAbsent: async () => { if (stage === "lookup") assert.fail("cannot create over a registered profile"); return registered; },
    } as never, { buyerIdentity: { findUnique: async () => ({ globalUserId: "canonical" }) } } as never);
    assert.equal(await service.ensurePhoneOnlyHubAccount({ owner, globalUserId: "canonical" }), null);
  }
});
test("a phone match exposes only an email challenge hint, without authorizing account profile", async () => {
  const service = new WhatsAppCheckoutIdentityService({ findByGlobalUserId: async () => null,
    findByPhone: async () => ({ phone: "21971191446", email: "existing@example.com", cpf: "private", address: { street: "private" } }) } as any);
  assert.equal(await service.emailHint("merchant", buyer), "existing@example.com");
});
test("a linked identity with a different phone cannot supply an account email", async () => {
  let scope: any;
  const service = new WhatsAppCheckoutIdentityService({ findByGlobalUserId: async () => ({ phone: "5511988887777", email: "other@example.com" }), findByPhone: async () => null } as any,
    { checkoutSession: { findFirst: async (input: any) => { scope = input; return null; } } } as any);
  assert.equal(await service.emailHint("own-merchant", buyer), undefined);
  assert.equal(scope.where.merchantId, "own-merchant");
  assert.deepEqual(scope.select, { customer: true });
  assert.equal(scope.where.AND[0].customer.equals, true);
});
test("a prior verified checkout for the same merchant and phone can locate an encrypted returning account", async () => {
  const service = new WhatsAppCheckoutIdentityService({ findByGlobalUserId: async () => null, findByPhone: async () => null } as any,
    { checkoutSession: { findFirst: async () => ({ customer: { email: "returning@example.com", email_verified: true, fullName: "private" } }) } } as any);
  assert.equal(await service.emailHint("own-merchant", buyer), "returning@example.com");
});
test("phone-only placeholder accounts continue the new buyer email registration flow", async () => {
  const service = new WhatsAppCheckoutIdentityService({ findByGlobalUserId: async () => null, findByPhone: async () => ({ phone: "21971191446", email: "phone_21971191446@buyer.aacp" }) } as any);
  assert.equal(await service.emailHint("merchant", buyer), undefined);
});
