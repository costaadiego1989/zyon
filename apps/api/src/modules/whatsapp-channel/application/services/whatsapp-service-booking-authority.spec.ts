import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { withWhatsAppExecution } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { revalidateNativeServiceBookingAdmission } from "../../../../shared/bookings/native-service-booking-authority.js";
import { WhatsAppTurnContext } from "../../domain/services/whatsapp-turn-context.js";
import { WhatsAppServiceBookingAuthority } from "./whatsapp-service-booking-authority.js";

function fixture() {
  const now = new Date("2030-01-01T12:00:00Z"), calls: any[] = [];
  const state: any = { version: 1, conversationId: "cart", revision: "revision", stage: "store", history: [], page: 0, previousViews: [] };
  const session: any = { id: "wa-session", merchantId: "merchant", deviceId: "META_CLOUD:config", buyerPhone: "+5511999991234", status: "active",
    conversationState: state, checkoutSessionId: null, lastActivityAt: now };
  const inbox: any = { leaseExpiresAt: new Date(now.getTime() + 60_000), payload: { merchantId: "merchant", deviceId: "META_CLOUD:config",
    provider: "META_CLOUD", fromNumber: "5511999991234", timestamp: now.getTime() } };
  let enabled = true, clock = now, accountPhone = "5511999991234", recognized = true;
  const proof = { inboxId: "inbox", leaseToken: "original-lease", deviceId: "META_CLOUD:config", fromNumber: "5511999991234" };
  const readSession = async (query: unknown) => { calls.push(["session", query]); return session; };
  const readCheckout = async () => undefined;
  const tx: any = { $queryRaw: async () => [{ now: clock }],
    whatsAppWebhookInbox: { findFirst: async (query: unknown) => { calls.push(["inbox", query]); return inbox; } },
    whatsAppChannelConfig: { findFirst: async () => enabled ? { id: "config" } : null },
    whatsAppSession: { findFirst: readSession }, checkoutSession: { findUnique: readCheckout },
    buyerAccount: { findUnique: async () => ({ globalUserId: "canonical-buyer", phone: accountPhone, email: "buyer@example.test" }) } };
  const prisma: any = { ...tx, $transaction: async (work: (tx: unknown) => unknown) => work(tx) };
  const identity: any = { emailHint: async () => undefined, recognize: async (value: unknown) => { calls.push(["recognize", value]);
    return { status: recognized ? "recognized" : "ambiguous", owner: { merchantId: "merchant", conversationId: "cart", phone: proof.fromNumber },
      ...(recognized ? { buyer: { merchantId: "merchant", conversationId: "cart", globalUserId: "canonical-buyer", customer: {
        phone: proof.fromNumber, phone_verified: true, email_verified: false, email: "buyer@example.test", fullName: "Canonical buyer" } } } : {}) }; } };
  const context = new WhatsAppTurnContext();
  const turn: any = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session" }, inboxId: "inbox", leaseToken: proof.leaseToken,
    conversationId: "cart", message: "Quero agendar", origin: "text" };
  const execution: any = Object.freeze({ authority: Object.freeze({ version: 1, merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session",
    inboxId: "inbox", bindingId: null, epoch: 0, deviceId: proof.deviceId, buyerPhone: "+" + proof.fromNumber, provider: "META_CLOUD", accountId: "account",
    checkoutSessionId: null, conversationId: "cart", revision: "revision" }), admitEffect: async () => { calls.push(["effect"]); },
    admitDelivery: async () => {}, startRequest: async (_scope: unknown, start: () => unknown) => start() });
  const authority = new WhatsAppServiceBookingAuthority(prisma, context, identity, { isCommittedCheckout: async () => false } as never);
  const input: any = { merchantId: "merchant", state: { ...state, revision: "caller-forged-revision" }, verifiedSender: proof, buyer: { globalUserId: "attacker" } };
  const run = <T>(work: () => T) => withWhatsAppExecution(execution, () => context.run(turn, work));
  return { authority, input, calls, state, session, inbox, tx, turn, run, context, execution, now,
    setEnabled: (value: boolean) => { enabled = value; }, setClock: (value: Date) => { clock = value; }, setAccountPhone: (value: string) => { accountPhone = value; },
    setRecognized: (value: boolean) => { recognized = value; } };
}
test("T46 durable native verifier", async t => {
  await t.test("actual private turn and durable row checks derive identity without a route buyer, embed origin or nonce", async () => {
    const f = fixture();
    await f.run(() => f.authority.run(f.input, async context => {
      assert.equal(context.scope.buyer.globalUserId, "canonical-buyer"); assert.equal(context.state.revision, "revision");
      assert.equal(context.scope.cartRef, "cart"); assert.match(context.scope.sessionId, /^wa_checkout_[a-f0-9]{32}$/);
      assert.equal(context.scope.allowedOrigin, undefined); assert.equal(Object.hasOwn(context.scope, "nonce"), false);
      assert.equal(context.scope.expiresAtUnix, Math.floor(f.inbox.leaseExpiresAt.getTime() / 1000));
      assert.equal(context.uiBinding.validUntil, f.now.getTime() + 24 * 60 * 60_000);
      const query = f.calls.find(call => call[0] === "inbox")[1];
      assert.deepEqual(query.where, { id: "inbox", merchantId: "merchant", configId: "config", deviceId: "META_CLOUD:config", kind: "message", status: "processing", leaseToken: "original-lease" });
    }));
  });
  await t.test("no execution or a mismatched original sender context is rejected before durable lookup", async () => {
    const f = fixture(); await assert.rejects(f.authority.run(f.input, async () => assert.fail("not admitted")), /whatsapp_service_authority_required/);
    f.input.verifiedSender = { ...f.input.verifiedSender, leaseToken: "foreign" };
    await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /whatsapp_service_authority_required/);
    assert.deepEqual(f.calls, []);
  });
  await t.test("disabled config and expired real lease do not invoke booking work", async () => {
    for (const reason of ["disabled", "lease"] as const) {
      const f = fixture(); if (reason === "disabled") f.setEnabled(false); else f.inbox.leaseExpiresAt = f.now;
      await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /whatsapp_service_authority_required/);
    }
  });
  await t.test("phone-account ownership is reloaded in the actual transaction after initial admission", async () => {
    const f = fixture(); await f.run(() => f.authority.run(f.input, async context => {
      f.setAccountPhone("5511888880000");
      await assert.rejects(revalidateNativeServiceBookingAdmission(f.tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId }), /whatsapp_service_authority_required/);
    }));
  });
  await t.test("lease renewal cannot extend the initial command expiry captured for the same request", async () => {
    const f = fixture(); await f.run(() => f.authority.run(f.input, async context => {
      const expiry = context.scope.expiresAtUnix; f.inbox.leaseExpiresAt = new Date((expiry + 60) * 1000); f.setClock(new Date(expiry * 1000));
      await assert.rejects(revalidateNativeServiceBookingAdmission(f.tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId }), /whatsapp_service_authority_required/);
    }));
  });
  await t.test("ambiguous account recognition grants no actor or writer", async () => {
    const f = fixture(); f.setRecognized(false);
    assert.equal(await f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), undefined);
  });
  await t.test("foreign conversation or changed persisted revision cannot reuse the original frame", async () => {
    for (const patch of [{ conversationId: "foreign" }, { revision: "newer" }]) {
      const f = fixture(); Object.assign(f.state, patch);
      await assert.rejects(f.run(() => f.authority.run(f.input, async () => assert.fail("not admitted"))), /whatsapp_service_authority_required/);
    }
  });
});
