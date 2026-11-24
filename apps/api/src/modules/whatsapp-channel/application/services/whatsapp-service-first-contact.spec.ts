import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppServiceBookingAuthority } from "./whatsapp-service-booking-authority.js";
import { WhatsAppTurnContext } from "../../domain/services/whatsapp-turn-context.js";
import { encryptPii } from "../../../../shared/crypto/pii-cipher.service.js";
import { revalidateNativeServiceBookingAdmission } from "../../../../shared/bookings/native-service-booking-authority.js";
import { withWhatsAppExecution, admitWhatsAppEffectInTransaction } from "../../../../shared/whatsapp/whatsapp-automation-context.js";

function fixture() {
  const now = new Date("2030-01-01T12:00:00Z"), phone = "5511999991234", calls: unknown[] = [];
  const owner = { merchantId: "merchant", conversationId: "cart", phone };
  const state: any = { version: 1, conversationId: "cart", revision: "revision", stage: "store", history: [], page: 0, previousViews: [] };
  const turns = new WhatsAppTurnContext(), turn: any = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session" },
    inboxId: "inbox", leaseToken: "lease", conversationId: "cart", message: "/servicos", origin: "text" };
  let registered = false, available = true, binding: unknown = { globalUserId: "canonical-route-buyer" }, claimed = true;
  let returnedOwner = owner, phoneCipher = encryptPii(phone);
  const session: any = { id: "wa-session", merchantId: "merchant", buyerPhone: phone, deviceId: "META_CLOUD:config", status: "active",
    checkoutSessionId: null, conversationState: state, lastActivityAt: now };
  const tx: any = { $queryRaw: async () => [{ now }],
    whatsAppSession: { findFirst: async () => session },
    buyerIdentity: { findUnique: async () => binding },
    buyerAccount: { findUnique: async () => available && registered ? { globalUserId: "canonical-route-buyer", phone: phoneCipher } : null },
    checkoutSession: { findUnique: async () => null },
    whatsAppChannelConfig: { findFirst: async () => ({ id: "config" }) },
    whatsAppWebhookInbox: { findFirst: async () => claimed ? { leaseExpiresAt: new Date(now.getTime() + 60_000), payload: {
      merchantId: "merchant", deviceId: "META_CLOUD:config", provider: "META_CLOUD", fromNumber: phone, timestamp: now.getTime() } } : null },
  };
  const prisma: any = { ...tx, $transaction: async (work: (tx: unknown) => unknown) => work(tx) };
  const execution: any = Object.freeze({ authority: Object.freeze({ version: 1, merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session",
    inboxId: "inbox", deviceId: "META_CLOUD:config", buyerPhone: phone, provider: "META_CLOUD", accountId: "account", checkoutSessionId: null,
    bindingId: null, epoch: 0, conversationId: "cart", revision: "revision" }),
    admitEffect: async () => { if (!claimed) throw new Error("synthetic_original_lease_lost"); }, admitDelivery: async () => {},
    startRequest: async (_scope: unknown, callback: () => unknown) => callback() });
  const identity: any = { emailHint: async () => undefined,
    recognize: async () => ({ status: registered ? "recognized" : "unrecognized", owner: returnedOwner,
      ...(registered ? { buyer: { ...owner, globalUserId: "canonical-route-buyer", customer: { phone, phone_verified: true, email_verified: false } } } : {}) }),
    ensurePhoneOnlyHubAccount: async (input: unknown) => { calls.push(structuredClone(input)); await admitWhatsAppEffectInTransaction(tx, "merchant");
      registered = true; return { globalUserId: "canonical-route-buyer" }; },
  };
  const authority = new WhatsAppServiceBookingAuthority(prisma, turns, identity, { isCommittedCheckout: async () => false } as never);
  const input: any = { merchantId: "merchant", state, verifiedSender: { inboxId: "inbox", leaseToken: "lease", deviceId: "META_CLOUD:config", fromNumber: phone },
    buyer: { globalUserId: "caller-forged-id", fullName: "Untrusted caller" } };
  const run = <T>(callback: () => T) => withWhatsAppExecution(execution, () => turns.run(turn, callback));
  return { authority, input, calls, run, tx, owner, registered: () => registered,
    noBinding: () => { binding = null; }, wrongOwner: () => { returnedOwner = { ...owner, merchantId: "foreign" }; },
    deleteAccount: () => { available = false; }, loseClaim: () => { claimed = false; }, corruptCipher: () => { phoneCipher = "pii_v1:malformed"; } };
}

test("T46 native first contact and same-transaction PII", async t => {
  await t.test("guest creation uses the actual canonical route binding and never the caller buyer ID", async () => {
    const f = fixture(); await f.run(() => f.authority.run(f.input, async context => {
      assert.equal(context.scope.buyer.globalUserId, "canonical-route-buyer");
      assert.equal(context.scope.buyer.customer.email, undefined); assert.equal(context.scope.buyer.customer.phone_verified, true);
    }));
    assert.deepEqual(f.calls, [{ owner: f.owner, globalUserId: "canonical-route-buyer" }]); assert.equal(f.registered(), true);
  });
  await t.test("a missing canonical route identity fails before the phone-only account writer", async () => {
    const f = fixture(); f.noBinding(); await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /whatsapp_service_authority_required/);
    assert.deepEqual(f.calls, []); assert.equal(f.registered(), false);
  });
  await t.test("a foreign recognizer owner is not promoted into a local guest", async () => {
    const f = fixture(); f.wrongOwner(); await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /whatsapp_service_authority_required/);
    assert.deepEqual(f.calls, []); assert.equal(f.registered(), false);
  });
  await t.test("the existing account writer retains the original effect lease fence", async () => {
    const f = fixture(); f.loseClaim(); await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /synthetic_original_lease_lost/);
    assert.equal(f.registered(), false);
  });
  await t.test("the account phone is decrypted from the same transaction and checked again after admission", async () => {
    const f = fixture(); await f.run(() => f.authority.run(f.input, async context => {
      assert.equal(context.scope.buyer.globalUserId, "canonical-route-buyer");
      await revalidateNativeServiceBookingAdmission(f.tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
      f.deleteAccount(); await assert.rejects(revalidateNativeServiceBookingAdmission(f.tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId }), /whatsapp_service_authority_required/);
    })); assert.equal(f.calls.length, 1);
  });
  await t.test("an unreadable encrypted phone fails closed without exposing the ciphertext", async () => {
    const f = fixture(); f.corruptCipher();
    await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), error => {
      assert.equal((error as Error).message, "whatsapp_service_authority_required"); return true;
    });
  });
});
