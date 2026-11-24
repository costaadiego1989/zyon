import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import { ServiceBookingController } from "./service-booking.controller.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService, type EmbedTokenClaims } from "../../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { ResolveEmbedBuyerService } from "../../../embed/application/resolve-embed-buyer.service.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";

// This file proves transport admission, not SQL/Redis or the service writer.
// The companion native file exercises the same routes through the real app.
test("T40", async t => {
  const origin = "https://service-booking.example.test";
  const embedTokens = new EmbedTokenService({ value: Buffer.from("synthetic-t40-embed-secret-32-characters") });
  const buyerTokens = new BuyerJwtService("synthetic-t40-buyer-secret-32-characters");
  const buyer = { globalUserId: "buyer_t40", email: "buyer-t40@example.test", displayName: "Service buyer" };
  const resolver = new ResolveEmbedBuyerService(buyerTokens, { findByGlobalUserId: async (id: string) => id === buyer.globalUserId ? buyer : undefined } as never);
  const choice = { productId: "product", variantId: "variant", professionalId: "professional", professionalVersion: 3,
    policyVersion: 2, date: "2035-02-05", startsAt: "2035-02-05T13:00:00.000Z", endsAt: "2035-02-05T13:20:00.000Z",
    timeZone: "America/Sao_Paulo", durationMinutes: 20, priceInCents: 5000, currency: "BRL", slotId: "a".repeat(64) };
  const principal = buyerTokens.sign({ globalUserId: buyer.globalUserId, email: buyer.email });
  const state: { scopes: unknown[]; prepared: unknown[]; reads: unknown[] } = { scopes: [], prepared: [], reads: [] };
  const summary = { selection: choice, service: { name: "Consultation" }, professional: { name: "Public professional" },
    parent_cart_fingerprint: "b".repeat(64), policy: { version: 2, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null } };
  const service = {
    professionals: async (scope: unknown) => { state.scopes.push(scope); return { professionals: [{ id: "professional", name: "Public professional" }], has_more: false }; },
    dates: async (scope: unknown) => { state.scopes.push(scope); return { dates: [choice.date] }; },
    slots: async (scope: unknown) => { state.scopes.push(scope); return { selections: [choice] }; },
    select: async (scope: unknown) => { state.scopes.push(scope); return structuredClone(summary); },
    prepare: async (scope: unknown, input: unknown) => { state.scopes.push(scope); state.prepared.push(structuredClone(input)); return { session_id: embedCheckoutSessionId(claims()), cart_fingerprint: "c".repeat(64), selections: [choice], confirmed: false, payment_mode: "at_attendance", requires_hold: false, service_slot_hold: null }; },
  };
  const publicService = {
    professionals: async (scope: unknown) => { state.reads.push(scope); return { professionals: [{ id: "professional", name: "Public professional", version: 3, timeZone: "America/Sao_Paulo", profile: {} }], has_more: false }; },
    dates: async (scope: unknown) => { state.reads.push(scope); return { dates: [choice.date], professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" }; },
    slots: async (scope: unknown) => { state.reads.push(scope); return { selections: [choice] }; },
  };
  const controller = new ServiceBookingController(service as never, resolver, publicService as never);
  const guard = new EmbedAuthGuard(embedTokens, new Reflector());
  function claims(patch: Partial<EmbedTokenClaims> = {}): EmbedTokenClaims {
    const now = Math.floor(Date.now() / 1000);
    return { typ: "aacp_embed_v1", merchantId: "merchant", nonce: "signed-capability", issuedAtUnix: now,
      expiresAtUnix: now + 600, allowedOrigin: origin, scopes: ["checkout:start", "appointments:confirm"], storefrontCartRef: "conversation_cart", ...patch };
  }
  function request(patch: Partial<EmbedTokenClaims> = {}, headers: Record<string, string | undefined> = {}) {
    const value = { headers: { "x-aacp-embed-token": embedTokens.sign(claims(patch)), "x-buyer-access-token": principal, origin, ...headers } };
    return value as typeof value & { embedClaims?: EmbedTokenClaims };
  }
  function admit(req: ReturnType<typeof request>, method: keyof ServiceBookingController) {
    const context = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => controller[method] };
    return guard.canActivate(context as never);
  }
  const selectBody = { selection: choice };
  const prepareBody = { selection: choice, parent_cart_fingerprint: summary.parent_cart_fingerprint };

  await t.test("authenticated capability derives the exact buyer, merchant, session and bound cart", async () => {
    const req = request(); admit(req, "select");
    const result = await controller.select(req as never, selectBody);
    assert.deepEqual(result, summary); assert.equal(state.prepared.length, 0);
    const scope = state.scopes.at(-1) as Record<string, any>;
    assert.equal(scope.merchantId, "merchant"); assert.equal(scope.sessionId, embedCheckoutSessionId(claims()));
    assert.equal(scope.cartRef, "conversation_cart"); assert.equal(scope.buyer.globalUserId, buyer.globalUserId);
    assert.equal(scope.buyer.customer.email, buyer.email); assert.equal(scope.allowedOrigin, origin);
    assert.equal(scope.expiresAtUnix, claims().expiresAtUnix);
  });
  await t.test("read, select and prepare methods all require checkout:start", async () => {
    for (const method of ["professionals", "dates", "slots", "select", "prepare"] as const) {
      const req = request({ scopes: ["checkout:track"] });
      assert.throws(() => admit(req, method), /embed_scope_not_granted/);
    }
    assert.equal(state.prepared.length, 0);
  });
  await t.test("missing or forged buyer credentials never enter preparation", async () => {
    for (const token of [undefined, "invalid", buyerTokens.sign({ globalUserId: "absent", email: "absent@example.test" }),
      buyerTokens.sign({ globalUserId: buyer.globalUserId, email: buyer.email, merchantId: "foreign" })]) {
      const req = request({}, { "x-buyer-access-token": token }); admit(req, "prepare");
      await assert.rejects(() => controller.prepare(req as never, prepareBody), /embed_buyer_token_invalid|embed_buyer_merchant_mismatch/);
    }
    assert.equal(state.prepared.length, 0);
  });
  await t.test("missing or foreign origin is refused by the actual embed guard", () => {
    for (const supplied of [undefined, "https://foreign.example.test"]) assert.throws(() => admit(request({}, { origin: supplied }), "prepare"), /embed_origin_not_allowed/);
    assert.equal(state.prepared.length, 0);
  });
  await t.test("unsigned expiry and absent origin binding cannot authorize a new operation", async () => {
    const expired = request({ expiresAtUnix: Math.floor(Date.now() / 1000) - 1 });
    assert.throws(() => admit(expired, "prepare"), /embed_session_token_expired/);
    const unbound = request({ allowedOrigin: undefined, scopes: ["checkout:start"] }); admit(unbound, "prepare");
    await assert.rejects(() => controller.prepare(unbound as never, prepareBody), /service_booking_capability_invalid/);
    assert.equal(state.prepared.length, 0);
  });
  await t.test("development bypass claims never authorize the new booking writer", async () => {
    const req = request({ nonce: "dev_bypass" }); admit(req, "prepare");
    await assert.rejects(() => controller.prepare(req as never, prepareBody), /service_booking_capability_invalid/);
    assert.equal(state.prepared.length, 0);
  });
  await t.test("identity, state, scope and commercial overrides are rejected instead of stripped", async () => {
    for (const extra of [{ merchantId: "foreign" }, { session_id: "foreign" }, { cart_ref: "foreign" },
      { buyer: { globalUserId: "foreign" } }, { paid: true }, { cart: { items: [] } }, { origin: "manual" }]) {
      const req = request(); admit(req, "prepare");
      await assert.rejects(() => controller.prepare(req as never, { ...prepareBody, ...extra }), /service_booking_input_invalid/);
    }
    assert.equal(state.prepared.length, 0);
  });
  await t.test("null, arrays, malformed versions and unbounded dates are not booking commands", async () => {
    for (const body of [null, [], { ...prepareBody, selection: { ...choice, professionalVersion: 0 } },
      { ...prepareBody, selection: { ...choice, priceInCents: -1 } }, { ...prepareBody, parent_cart_fingerprint: "x" }]) {
      const req = request(); admit(req, "prepare");
      await assert.rejects(() => controller.prepare(req as never, body), /service_booking_input_invalid/);
    }
    const req = request(); admit(req, "dates");
    await assert.rejects(() => controller.dates(req as never, { productId: "product", variantId: "variant", professionalId: "professional", fromDate: "invalid", toDate: "2035-02-05" }), /service_booking_input_invalid/);
    assert.equal(state.prepared.length, 0);
  });
  await t.test("GET does not accept buyer tokens or merchant identity in the URL", async () => {
    const req = request(); admit(req, "professionals");
    for (const extra of [{ buyer_access_token: principal }, { merchantId: "foreign" }, { session_id: "foreign" }])
      await assert.rejects(() => controller.professionals(req as never, { productId: "product", variantId: "variant", ...extra }), /service_booking_input_invalid/);
    assert.equal(state.prepared.length, 0);
  });
  await t.test("valid prepare passes only canonical selection and expected full-parent identity", async () => {
    const req = request(); admit(req, "prepare");
    const result = await controller.prepare(req as never, prepareBody);
    assert.deepEqual(state.prepared, [prepareBody]); assert.equal(result.confirmed, false);
    assert.equal(result.session_id, embedCheckoutSessionId(claims())); assert.equal(result.requires_hold, false);
    assert.equal(result.selections[0].professionalId, choice.professionalId); assert.equal(result.selections[0].priceInCents, 5000);
    assert.equal(/buyer_t40|generation|privatePaymentContinuation|access_token|passwordHash/.test(JSON.stringify(result)), false);
  });
  await t.test("the shorter verified buyer-JWT expiry limits the private booking capability", async () => {
    const shorter = new BuyerJwtService("synthetic-t40-buyer-secret-32-characters", 30);
    const token = shorter.sign({ globalUserId: buyer.globalUserId, email: buyer.email });
    const expiration = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")).exp;
    const req = request({}, { "x-buyer-access-token": token }); admit(req, "select");
    await controller.select(req as never, selectBody);
    assert.equal((state.scopes.at(-1) as Record<string, unknown>).expiresAtUnix, expiration);
    assert.ok(expiration < claims().expiresAtUnix);
  });
  await t.test("anonymous signed embed capability browses professionals dates and slots without a buyer or writer context", async () => {
    const initialScopes = state.scopes.length, beforeWrites = structuredClone(state.prepared), beforeReads = state.reads.length;
    const patch = { scopes: ["checkout:start"] as EmbedTokenClaims["scopes"] };
    const requestWithoutBuyer = () => request(patch, { "x-buyer-access-token": undefined });
    const roster = requestWithoutBuyer(); admit(roster, "professionals");
    assert.deepEqual(await controller.professionals(roster as never, { productId: "product", variantId: "variant" }), {
      professionals: [{ id: "professional", name: "Public professional", version: 3, timeZone: "America/Sao_Paulo", profile: {} }], has_more: false });
    const dates = requestWithoutBuyer(); admit(dates, "dates");
    assert.deepEqual(await controller.dates(dates as never, { productId: "product", variantId: "variant", professionalId: "professional", fromDate: choice.date, toDate: choice.date }), {
      dates: [choice.date], professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" });
    const slots = requestWithoutBuyer(); admit(slots, "slots");
    assert.deepEqual(await controller.slots(slots as never, { productId: "product", variantId: "variant", professionalId: "professional", date: choice.date }), { selections: [choice] });
    assert.equal(state.reads.length, beforeReads + 3); assert.equal(state.scopes.length, initialScopes); assert.deepEqual(state.prepared, beforeWrites);
    for (const scope of state.reads.slice(beforeReads)) assert.deepEqual(scope, {
      merchantId: "merchant", allowedOrigin: origin, expiresAtUnix: claims().expiresAtUnix });
  });
  await t.test("explicitly invalid buyer headers on public GETs return 401 without a guest fallback", async () => {
    const beforeReads = state.reads.length;
    for (const method of ["professionals", "dates", "slots"] as const) {
      const req = request({ scopes: ["checkout:start"] }, { "x-buyer-access-token": "invalid" }); admit(req, method);
      const query = method === "professionals" ? { productId: "product", variantId: "variant" } : method === "dates"
        ? { productId: "product", variantId: "variant", professionalId: "professional", fromDate: choice.date, toDate: choice.date }
        : { productId: "product", variantId: "variant", professionalId: "professional", date: choice.date };
      await assert.rejects(() => controller[method](req as never, query), (error: any) => error.getStatus() === 401);
    }
    assert.equal(state.reads.length, beforeReads);
  });
  await t.test("readonly embed plus valid buyer cannot select or prepare before a real issuer upgrade", async () => {
    const beforeScopes = state.scopes.length, beforeWrites = structuredClone(state.prepared);
    for (const method of ["select", "prepare"] as const) {
      const req = request({ scopes: ["checkout:start"] }); admit(req, method);
      await assert.rejects(() => controller[method](req as never, method === "select" ? selectBody : prepareBody),
        (error: any) => error.getStatus() === 403 && error.message === "service_booking_write_scope_required");
    }
    assert.equal(state.scopes.length, beforeScopes); assert.deepEqual(state.prepared, beforeWrites);
  });

  await t.test("upgraded verified buyer keeps the original private read scope for its own hold continuation", async () => {
    const beforePublicReads = state.reads.length, beforeScopes = state.scopes.length;
    const req = request(); admit(req, "slots");
    assert.deepEqual(await controller.slots(req as never, { productId: "product", variantId: "variant", professionalId: "professional", date: choice.date }), { selections: [choice] });
    assert.equal(state.reads.length, beforePublicReads); assert.equal(state.scopes.length, beforeScopes + 1);
    const scope = state.scopes.at(-1) as any;
    assert.equal(scope.sessionId, embedCheckoutSessionId(claims())); assert.equal(scope.cartRef, "conversation_cart");
    assert.equal(scope.buyer.globalUserId, buyer.globalUserId); assert.equal(scope.allowedOrigin, origin);
    const readonly = request({ scopes: ["checkout:start"] }); admit(readonly, "slots");
    assert.deepEqual(await controller.slots(readonly as never, { productId: "product", variantId: "variant", professionalId: "professional", date: choice.date }), { selections: [choice] });
    assert.equal(state.scopes.length, beforeScopes + 1); assert.equal(state.reads.length, beforePublicReads + 1);
    assert.deepEqual(Object.keys(state.reads.at(-1) as any).sort(), ["allowedOrigin", "expiresAtUnix", "merchantId"]);
  });

});
