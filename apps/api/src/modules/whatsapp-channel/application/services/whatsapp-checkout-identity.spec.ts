import test from "node:test";
import assert from "node:assert/strict";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";

const buyer = { globalUserId: "phone-session", phone: "552171191446" };
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
