import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { withWhatsAppExecution } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { revalidateNativeServiceBookingAdmission } from "../../../../shared/bookings/native-service-booking-authority.js";
import { revalidateNativePublicServiceReadScope } from "../../../../shared/bookings/native-public-service-read-scope.js";
import { PublicServiceBookingReader } from "../../../checkout/application/public-service-booking-reader.js";
import { WhatsAppServiceBookingService } from "./whatsapp-service-booking.service.js";
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
  return { authority, input, calls, state, session, inbox, tx, turn, run, context, execution, now, prisma, identity,
    setEnabled: (value: boolean) => { enabled = value; }, setClock: (value: Date) => { clock = value; }, setAccountPhone: (value: string) => { accountPhone = value; },
    setRecognized: (value: boolean) => { recognized = value; } };
}
// New guards use the durable authority itself. Original T46 cases are untouched.
test("native public browsing admission", async t => {
  await t.test("public catalog facts run inside the actual verified transaction, never the root client", async () => {
    const f = fixture(); f.setRecognized(false); let reads = 0;
    f.prisma.merchant = { findUnique: async () => assert.fail("public merchant read escaped transaction") };
    f.prisma.product = { findMany: async () => assert.fail("public catalog read escaped transaction") };
    f.tx.merchant = { findUnique: async () => { reads++; return { businessMode: "services", businessModeSelectedAt: f.now, businessModeNeedsReview: false }; } };
    f.tx.product = { findMany: async () => { reads++; return [{ id: "product", name: "Published service", variants: [{ id: "variant", sku: "SERVICE" }] }]; } };
    const service = new WhatsAppServiceBookingService(f.prisma, f.authority, {} as never, {} as never);
    const response = await f.run(() => service.open(f.input));
    assert.equal(response!.state.serviceBooking!.model.step, "services"); assert.equal(reads, 2);
    assert.equal(f.calls.filter(call => call[0] === "effect").length >= 5, true);
    assert.equal(response!.agentMessage.includes("Meus dados"), false);
  });
  await t.test("ambiguous accounts receive only a live turn-bound public read scope and no synthetic owner", async () => {
    const f = fixture(); f.setRecognized(false);
    await f.run(() => f.authority.runRead(f.input, async context => {
      assert.equal(context.readOnly, true);
      assert.deepEqual(context.scope, { transport: "whatsapp", merchantId: "merchant", expiresAtUnix: f.inbox.leaseExpiresAt.getTime() / 1000 });
      assert.equal(Object.isFrozen(context.scope), true);
      assert.equal(Object.hasOwn(context.scope, "buyer"), false); assert.equal(Object.hasOwn(context.scope, "cartRef"), false);
      assert.equal(Object.hasOwn(context.scope, "sessionId"), false); assert.equal(Object.hasOwn(context.scope, "allowedOrigin"), false);
      assert.equal(context.uiBinding.validUntil, f.now.getTime() + 24 * 60 * 60_000);
      if (context.readOnly !== true) assert.fail("public path required");
      const before = f.calls.filter(call => call[0] === "effect").length;
      assert.equal((await revalidateNativePublicServiceReadScope(f.tx, context.scope)).toISOString(), f.now.toISOString());
      assert.equal(f.calls.filter(call => call[0] === "effect").length, before + 1);
      const reader = new PublicServiceBookingReader(f.prisma);
      await assert.rejects(reader.professionals(structuredClone(context.scope), { productId: "product", variantId: "variant" }), /whatsapp_service_read_authority_required/);
    }));
  });
  await t.test("serialized native scopes and fake HTTP origins fail without a current verified execution", async () => {
    const f = fixture(), reader = new PublicServiceBookingReader(f.prisma);
    await assert.rejects(f.authority.runRead(f.input, async () => assert.fail("not admitted")), /whatsapp_service_authority_required/);
    for (const scope of [{ transport: "whatsapp", merchantId: "merchant", expiresAtUnix: 2_000_000_000 },
      { merchantId: "merchant", expiresAtUnix: 2_000_000_000, allowedOrigin: "wa.me" }])
      await assert.rejects(reader.professionals(scope as never, { productId: "product", variantId: "variant" }), /whatsapp_service_read_authority_required|service_booking_capability_invalid/);
    assert.deepEqual(f.calls, []);
  });
  await t.test("each public transaction rechecks config, original lease, sender, conversation revision and DB time", async () => {
    const changes = [(f: ReturnType<typeof fixture>) => f.setEnabled(false),
      (f: ReturnType<typeof fixture>) => { f.inbox.leaseExpiresAt = f.now; },
      (f: ReturnType<typeof fixture>) => { f.state.revision = "later"; },
      (f: ReturnType<typeof fixture>) => { f.session.buyerPhone = "5511888880000"; },
      (f: ReturnType<typeof fixture>) => { f.inbox.payload.fromNumber = "5511888880000"; },
      (f: ReturnType<typeof fixture>) => { f.inbox.payload.merchantId = "other"; },
      (f: ReturnType<typeof fixture>) => { f.session.checkoutSessionId = "new-private-checkout"; }];
    for (const change of changes) {
      const f = fixture(); f.setRecognized(false);
      await assert.rejects(f.run(() => f.authority.runRead(f.input, async context => {
        if (context.readOnly !== true) assert.fail("public path required");
        change(f);
        await assert.rejects(revalidateNativePublicServiceReadScope(f.tx, context.scope), /whatsapp_service_authority_required/);
      })), /whatsapp_service_authority_required/);
    }
    const f = fixture(); f.setRecognized(false);
    await assert.rejects(f.run(() => f.authority.runRead(f.input, async context => {
      if (context.readOnly !== true) assert.fail("public path required");
      const deadline = context.scope.expiresAtUnix;
      f.inbox.leaseExpiresAt = new Date((deadline + 60) * 1000); f.setClock(new Date(deadline * 1000));
      await assert.rejects(revalidateNativePublicServiceReadScope(f.tx, context.scope), /whatsapp_service_authority_required/);
    })), /whatsapp_service_authority_required/);
  });
  await t.test("real admission failures never enter public work or borrow another execution", async () => {
    const f = fixture(); f.setRecognized(false); f.setEnabled(false);
    await assert.rejects(f.run(() => f.authority.runRead(f.input, async () => assert.fail("no fallback"))), /whatsapp_service_authority_required/);
    const g = fixture(); g.setRecognized(false);
    await g.run(() => g.authority.runRead(g.input, async context => {
      if (context.readOnly !== true) assert.fail("public path required");
      assert.throws(() => withWhatsAppExecution({ ...g.execution } as never, () => revalidateNativePublicServiceReadScope(g.tx, context.scope)), /whatsapp_execution_replace_forbidden/);
      await g.context.run({ ...g.turn, leaseToken: "other" }, async () => {
        await assert.rejects(revalidateNativePublicServiceReadScope(g.tx, context.scope), /whatsapp_service_authority_required/);
      });
    }));
  });
  await t.test("resolved owners and legitimate phone-only bootstrap keep private authority", async () => {
    const f = fixture();
    await f.run(() => f.authority.runRead(f.input, async context => {
      assert.notEqual(context.readOnly, true);
      if (context.readOnly === true) assert.fail("private path required");
      assert.equal(context.scope.buyer.globalUserId, "canonical-buyer");
      await revalidateNativeServiceBookingAdmission(f.tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
    }));
    const g = fixture(); const recognize = g.identity.recognize; let created = 0;
    g.prisma.buyerIdentity = { findUnique: async () => ({ globalUserId: "canonical-buyer" }) };
    g.identity.recognize = async (args: unknown) => created ? recognize(args) : {
      status: "unrecognized", owner: { merchantId: "merchant", conversationId: "cart", phone: g.input.verifiedSender.fromNumber } };
    g.identity.ensurePhoneOnlyHubAccount = async ({ globalUserId }: any) => { assert.equal(globalUserId, "canonical-buyer"); created++; return { globalUserId }; };
    await g.run(() => g.authority.runRead(g.input, async context => {
      assert.notEqual(context.readOnly, true); assert.equal(created, 1);
    }));
  });
  await t.test("a corrupt existing private checkout cannot fall back to public ambiguity", async () => {
    const f = fixture(); f.setRecognized(false); f.session.checkoutSessionId = "existing-private-checkout";
    let called = false; assert.equal(await f.run(() => f.authority.runRead(f.input, async () => { called = true; })), undefined);
    assert.equal(called, false);
    const g = fixture(); g.session.checkoutSessionId = "missing-private-checkout";
    await assert.rejects(g.run(() => g.authority.runRead(g.input, async () => assert.fail("no fallback"))), /whatsapp_service_authority_required/);
  });
  await t.test("public scope cannot admit Continue or Confirm and private unresolved identity stays unresolved", async () => {
    for (const operation of ["continue", "confirm"]) {
      const f = fixture(); f.setRecognized(false); f.input.action = { kind: "service_booking", operation };
      await assert.rejects(f.run(() => f.authority.runRead(f.input, async () => assert.fail("writer forbidden"))), /whatsapp_service_authority_required/);
      assert.equal(await f.run(() => f.authority.run(f.input, async () => assert.fail("ambiguous writer forbidden"))), undefined);
    }
  });
});
