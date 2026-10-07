import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import { HEADERS_METADATA, OPTIONAL_DEPS_METADATA, SELF_DECLARED_DEPS_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "./embed-scope.decorator.js";
import { EmbedTokenService, type EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";
import { CancelPaymentIntentUseCase } from "../../../payment/application/cancel-payment-intent.use-case.js";
import { ResolveEmbedBuyerService } from "../../application/resolve-embed-buyer.service.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";

function fixture() {
  const now = Math.floor(Date.now() / 1000);
  const claims: EmbedTokenClaims = { typ: "aacp_embed_v1", merchantId: "merchant", nonce: "buyer-session", issuedAtUnix: now,
    expiresAtUnix: now + 600, allowedOrigin: "https://shop.example", scopes: ["payment:intents:confirm"] };
  const calls: any[] = [], sessionId = embedCheckoutSessionId(claims);
  const helper = new EmbedCheckoutGuardHelper({ getSession: async () => ({ merchantId: "merchant", sessionId }) } as never);
  const jwt = new BuyerJwtService("cancellation-local-only-secret-32");
  const resolver = new ResolveEmbedBuyerService(jwt, { findByGlobalUserId: async (id: string) => id === "buyer" ? { globalUserId: "buyer", email: "qa@example.test" } : null } as never);
  const controller = new EmbedCheckoutController({} as never, {} as never, {} as never, helper, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, resolver, undefined, undefined, undefined, undefined,
    { execute: async (input: any) => { calls.push(input); return { version: 1, intent_id: input.intentId, status: "cancelled", cancellation: "cancelled" }; } } as never);
  const body = { session_id: sessionId, idempotency_key: "cancel_intent", buyer_access_token: jwt.sign({ globalUserId: "buyer", email: "qa@example.test", merchantId: "merchant" }) };
  return { claims, calls, body, jwt, controller };
}
test("cancel route uses merchant claims and a verified buyer JWT, never browser-owned financial identity", async () => {
  const f = fixture(); await f.controller.cancelPaymentFromEmbed({ embedClaims: f.claims }, "intent", f.body);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0], { merchantId: "merchant", sessionId: f.body.session_id, intentId: "intent", idempotencyKey: "cancel_intent",
    buyer: { globalUserId: "buyer", customer: { email: "qa@example.test", email_verified: true, fullName: undefined, phone: undefined, cpf: undefined, asaasCustomerId: undefined, address: undefined } } });
});
test("foreign session, malformed body, merchant/buyer spoof and missing buyer JWT never reach cancellation", async () => {
  const f = fixture();
  for (const body of [null, [], { ...f.body, merchant_id: "other" }, { ...f.body, global_user_id: "other" }, { ...f.body, amount: 1 },
    { ...f.body, session_id: "foreign" }, { ...f.body, buyer_access_token: undefined }, { ...f.body, buyer_access_token: "invalid" },
    { ...f.body, buyer_access_token: f.jwt.sign({ globalUserId: "buyer", email: "qa@example.test", merchantId: "other" }) },
    { ...f.body, buyer_access_token: f.jwt.sign({ globalUserId: "foreign", email: "other@example.test", merchantId: "merchant" }) }]) {
    await assert.rejects(f.controller.cancelPaymentFromEmbed({ embedClaims: f.claims }, "intent", body));
  }
  assert.equal(f.calls.length, 0);
});
test("cancel route requires confirm scope, no-store, rate limit and mandatory Nest injection", () => {
  const method = EmbedCheckoutController.prototype.cancelPaymentFromEmbed;
  assert.equal(Reflect.getMetadata(PATH_METADATA, method), "payment/intents/:intentId/cancel");
  assert.equal(Reflect.getMetadata(EMBED_REQUIRED_SCOPE_KEY, method), "payment:intents:confirm");
  assert.ok(Reflect.getMetadata(HEADERS_METADATA, method).some((h: any) => h.name === "Cache-Control" && h.value === "no-store"));
  assert.equal(Reflect.getMetadata("rate-limit", method), 10);
  assert.ok(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, EmbedCheckoutController).some((d: any) => d.index === 16 && d.param === CancelPaymentIntentUseCase));
  assert.equal((Reflect.getMetadata(OPTIONAL_DEPS_METADATA, EmbedCheckoutController) ?? []).includes(16), false);
});
test("checkout edit alias also verifies buyer JWT before the shared cancellation path", async () => {
  const f = fixture(); let edits = 0;
  (f.controller as any).reopenCheckout = { execute: async (merchant: string, session: string, section: string, buyer: any) => {
    assert.equal(merchant, "merchant"); assert.equal(session, f.body.session_id); assert.equal(section, "payment"); assert.equal(buyer.globalUserId, "buyer"); edits++; return {};
  } };
  for (const token of [undefined, "invalid", f.jwt.sign({ globalUserId: "foreign", email: "other@example.test", merchantId: "merchant" })]) {
    await assert.rejects(f.controller.editCheckout({ embedClaims: f.claims }, { session_id: f.body.session_id, section: "payment", buyer_access_token: token }));
  }
  assert.equal(edits, 0);
  await f.controller.editCheckout({ embedClaims: f.claims }, { session_id: f.body.session_id, section: "payment", buyer_access_token: f.body.buyer_access_token });
  assert.equal(edits, 1);
});
test("real signed embed guard rejects wrong origin, expired/tampered token and missing confirm scope", () => {
  const f = fixture(), tokens = new EmbedTokenService({ value: Buffer.from("cancellation-controller-local-secret-32") }), guard = new EmbedAuthGuard(tokens, new Reflector());
  const check = (claims: EmbedTokenClaims | null, origin = "https://shop.example", suffix = "") => {
    const request = { headers: { origin, ...(claims ? { "x-aacp-embed-token": tokens.sign(claims) + suffix } : {}) } };
    return guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }), getClass: () => EmbedCheckoutController,
      getHandler: () => EmbedCheckoutController.prototype.cancelPaymentFromEmbed } as never);
  };
  assert.equal(check(f.claims), true);
  for (const call of [() => check(null), () => check(f.claims, "https://foreign.example"), () => check({ ...f.claims, expiresAtUnix: 1 }),
    () => check({ ...f.claims, scopes: ["payment:intents:read"] }), () => check(f.claims, "https://shop.example", "tampered")]) assert.throws(call);
});
