import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { ResolveEmbedBuyerService } from "../../../embed/application/resolve-embed-buyer.service.js";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { StorefrontServiceBookingBridge } from "./storefront-service-booking.bridge.js";
import { sendStoreMessageInputSchema } from "../../domain/contracts/storefront-conversation.schemas.js";

const origin = "https://booking.example.test", offer = { productId: "service", variantId: "variant" };
function fixture() {
  const now = Math.floor(Date.now() / 1000), calls: any[] = [], writeCalls: any[] = [];
  const conversations = new RealtimeCapabilityService("synthetic-t43-conversation-secret-32-characters");
  const embeds = new EmbedTokenService({ value: Buffer.from("synthetic-t43-embed-secret-32-characters") });
  const buyerTokens = new BuyerJwtService("synthetic-t43-buyer-secret-32-characters", 45);
  let account: any = { globalUserId: "buyer", email: "buyer@example.test", displayName: "Private buyer", cpf: "private-cpf" };
  let businessMode = "services";
  const buyer = new ResolveEmbedBuyerService(buyerTokens, { findByGlobalUserId: async (id: string) => id === "buyer" ? account : undefined } as never);
  const conversation = conversations.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "cart", origin });
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant", nonce: "existing-embed-nonce", issuedAtUnix: now, expiresAtUnix: now + 90,
    allowedOrigin: origin, scopes: ["checkout:start" as const], storefrontCartRef: "cart" };
  const embed = embeds.sign(claims), buyerToken = buyerTokens.sign({ globalUserId: "buyer", email: "buyer@example.test" });
  const headers = { authorization: "Bearer " + conversation.token, origin, "x-buyer-authorization": "Bearer " + buyerToken, "x-aacp-embed-token": embed };
  const booking = { professionals: async (scope: unknown, input: unknown) => { calls.push([scope, input]);
    return { professionals: [{ id: "professional", name: "Professional", version: 1, timeZone: "America/Sao_Paulo", profile: {} }], has_more: false }; } };
  const selected = { ...offer, professionalId: "professional", professionalVersion: 1, policyVersion: 2, date: "2035-02-05",
    startsAt: "2035-02-05T13:00:00.000Z", endsAt: "2035-02-05T13:20:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 20,
    priceInCents: 5000, currency: "BRL", slotId: "" };
  selected.slotId = professionalSlotId("merchant", selected);
  const publicBooking = { ...booking,
    dates: async (scope: unknown, input: unknown) => { calls.push([scope, input]); return { dates: [selected.date], professional_version: 1, policy_version: 2, time_zone: "America/Sao_Paulo" }; },
    slots: async (scope: unknown, input: unknown) => { calls.push([scope, input]); return { selections: [selected] }; } };
  const privateBooking = { ...publicBooking, select: async (scope: unknown, input: unknown) => { writeCalls.push([scope, input]); return { selection: selected,
    service: { name: "Consultation" }, professional: { name: "Professional" }, parent_cart_fingerprint: "b".repeat(64),
    policy: { version: 2, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null } }; } };
  const bridge = new StorefrontServiceBookingBridge({ conversations, embeds, resolveBuyer: buyer, booking: privateBooking as never, publicBooking: publicBooking as never,
    prisma: { merchant: { findUnique: async () => ({ businessMode, businessModeSelectedAt: new Date(), businessModeNeedsReview: false }) },
      product: { findFirst: async (input: unknown) => { assert.deepEqual(input, { where: { id: "service", merchantId: "merchant", type: "service", isActive: true, deletedAt: null,
        variants: { some: { id: "variant", isActive: true } } }, select: { name: true } }); return { name: "Consulta canônica" }; } } } as never });
  const context = { merchantId: "merchant", conversationId: "cart", cartRef: "cart" };
  return { bridge, headers, context, calls, writeCalls, selected, claims, now, embeds, buyerToken, embed, conversation,
    setMode: (mode: string) => { businessMode = mode; }, removeAccount: () => { account = undefined; } };
}
test("T43 verified service transport", async t => {
  await t.test("actual signed conversation proof publishes a public read scope without buyer cart or checkout authority", async () => {
    const f = fixture(), factory = f.bridge.capture({ headers: f.headers, conversationId: "cart" }), tools = await factory(f.context);
    assert.ok(tools); const result = await tools.getServiceProfessionals(offer); assert.equal(result.kind, "professionals");
    assert.equal(f.calls.length, 1); const scope = f.calls[0][0];
    assert.deepEqual(scope, { merchantId: "merchant", allowedOrigin: origin, expiresAtUnix: f.now + 45 });
    assert.deepEqual(f.calls[0][1], offer); assert.deepEqual(f.writeCalls, []);
  });
  await t.test("the shortest real buyer/embed/conversation expiry bounds the server capability", async () => {
    const f = fixture(), tools = await f.bridge.capture({ headers: f.headers, conversationId: "cart" })(f.context);
    await tools!.getServiceProfessionals(offer); assert.equal(f.calls[0][0].expiresAtUnix, f.now + 45);
    const shorter = f.embeds.sign({ ...f.claims, expiresAtUnix: f.now + 20 });
    const second = await f.bridge.capture({ headers: { ...f.headers, "x-aacp-embed-token": shorter }, conversationId: "cart" })(f.context);
    await second!.getServiceProfessionals(offer); assert.equal(f.calls[1][0].expiresAtUnix, f.now + 20);
  });
  await t.test("missing buyer or embed token still browses through the signed conversation without promoting identity", async () => {
    for (const field of ["x-buyer-authorization", "x-aacp-embed-token"] as const) {
      const f = fixture(), headers = { ...f.headers }; delete (headers as Partial<typeof headers>)[field];
      const tools = await f.bridge.capture({ headers, conversationId: "cart" })(f.context); assert.ok(tools);
      assert.equal((await tools.getServiceProfessionals(offer)).kind, "professionals"); assert.equal(f.calls.length, 1);
      assert.equal("buyer" in f.calls[0][0], false); assert.equal("sessionId" in f.calls[0][0], false); assert.deepEqual(f.writeCalls, []);
    }
  });
  await t.test("foreign cart, tenant, bypass and legacy embed bindings cannot become a service scope", async () => {
    for (const patch of [{ storefrontCartRef: "foreign" }, { merchantId: "foreign" }, { nonce: "dev_bypass" }, { cartRef: "legacy" }]) {
      const f = fixture(), token = f.embeds.sign({ ...f.claims, ...patch });
      const tools = await f.bridge.capture({ headers: { ...f.headers, "x-aacp-embed-token": token }, conversationId: "cart" })(f.context);
      assert.deepEqual(await tools!.getServiceProfessionals(offer), { kind: "authentication_required", action: "authenticate" }); assert.deepEqual(f.calls, []);
    }
  });
  await t.test("wrong origins or mismatched conversation context never publish an authorized handler", async () => {
    const f = fixture(); assert.equal(await f.bridge.capture({ headers: { ...f.headers, origin: "https://foreign.example.test" }, conversationId: "cart" })(f.context), undefined);
    const factory = f.bridge.capture({ headers: f.headers, conversationId: "cart" });
    assert.equal(await factory({ ...f.context, cartRef: "foreign" }), undefined); assert.deepEqual(f.calls, []);
  });
  await t.test("forged or expired real credential envelopes cannot reach canonical readers", async () => {
    const f = fixture();
    for (const token of [f.embed + "forged", f.embeds.sign({ ...f.claims, issuedAtUnix: f.now - 60, expiresAtUnix: f.now - 1 })]) {
      const tools = await f.bridge.capture({ headers: { ...f.headers, "x-aacp-embed-token": token }, conversationId: "cart" })(f.context);
      assert.equal((await tools!.getServiceProfessionals(offer)).kind, "authentication_required");
    }
    assert.deepEqual(f.calls, []);
  });
  await t.test("every subsequent tool call resolves the persisted buyer again and fails closed after removal", async () => {
    const f = fixture(), tools = await f.bridge.capture({ headers: f.headers, conversationId: "cart" })(f.context);
    await tools!.getServiceProfessionals(offer); f.removeAccount();
    assert.equal((await tools!.getServiceProfessionals(offer)).kind, "authentication_required"); assert.equal(f.calls.length, 1);
  });
  await t.test("captured headers are immutable snapshots and credentials never appear in tool results or public properties", async () => {
    const f = fixture(), factory = f.bridge.capture({ headers: f.headers, conversationId: "cart" }); f.headers["x-aacp-embed-token"] = "changed";
    const tools = await factory(f.context); assert.equal((await tools!.getServiceProfessionals(offer)).kind, "professionals");
    const text = JSON.stringify(tools); for (const secret of [f.embed, f.buyerToken, f.conversation.token, "private-cpf"]) assert.equal(text.includes(secret), false);
    assert.equal(Object.keys(tools!).some(key => /scope|token|credential|prepare|confirm|pay/i.test(key)), false);
  });
  await t.test("products keep the default handler set even if a caller supplies irrelevant embed header garbage", async () => {
    const f = fixture(); f.setMode("products"); f.headers["x-aacp-embed-token"] = "garbage";
    assert.equal(await f.bridge.capture({ headers: f.headers, conversationId: "cart" })(f.context), undefined); assert.deepEqual(f.calls, []);
  });
  await t.test("public message JSON cannot carry the private factory or promote a public service flag", () => {
    for (const extra of [{ serviceBooking: true }, { bookingScope: { merchantId: "merchant" } }, { serviceBookingFactory: () => undefined }])
      assert.equal(sendStoreMessageInputSchema.safeParse({ merchant_id: "merchant", conversation_id: "cart", user_message: "Agendar", ...extra }).success, false);
  });
  await t.test("anonymous conversation alone can resolve an exact slot locally without private select", async () => {
    const f = fixture(), headers = { authorization: f.headers.authorization, origin };
    const tools = await f.bridge.capture({ headers, conversationId: "cart" })(f.context); assert.ok(tools);
    const value = await tools.resolveServiceSelection({ ...offer, professionalName: "Professional", date: { kind: "absolute", value: f.selected.date }, time: { kind: "exact", value: "10:00" } });
    assert.equal(value.kind, "slots"); assert.deepEqual((value as any).selections, [f.selected]);
    assert.deepEqual((value as any).context, { ...offer, serviceName: "Consulta canônica", professional: { id: "professional", version: 1, name: "Professional" } });
    assert.equal((value as any).has_more, false); assert.deepEqual(f.writeCalls, []);
    assert.equal(/buyer|parent_cart_fingerprint|sessionId/.test(JSON.stringify(value)), false);
  });
  await t.test("readonly embed plus real buyer remains public while the real write grant preserves the original nonce", async () => {
    const f = fixture();
    const hints = { ...offer, professionalName: "Professional", date: { kind: "absolute", value: f.selected.date }, time: { kind: "exact", value: "10:00" } };
    const readOnly = await f.bridge.capture({ headers: f.headers, conversationId: "cart" })(f.context);
    assert.equal((await readOnly!.resolveServiceSelection(hints)).kind, "slots"); assert.deepEqual(f.writeCalls, []);
    const upgraded = f.embeds.sign({ ...f.claims, scopes: ["checkout:start", "appointments:confirm"] });
    const writer = await f.bridge.capture({ headers: { ...f.headers, "x-aacp-embed-token": upgraded }, conversationId: "cart" })(f.context);
    const value = await writer!.resolveServiceSelection(hints); assert.equal(value.kind, "selection");
    assert.equal(f.writeCalls.length, 1); const [scope, input] = f.writeCalls[0];
    assert.equal(scope.sessionId, embedCheckoutSessionId(f.claims)); assert.equal(scope.cartRef, "cart");
    assert.equal(scope.buyer.globalUserId, "buyer"); assert.equal(scope.buyer.customer.email_verified, true);
    assert.equal(scope.expiresAtUnix, f.now + 45); assert.deepEqual(input, { selection: f.selected });
    assert.equal((value as any).authorizesConfirmation, false); assert.equal((value as any).authorizesPayment, false);
    assert.equal(JSON.stringify(value).includes("parent_cart_fingerprint"), false);
  });

});
