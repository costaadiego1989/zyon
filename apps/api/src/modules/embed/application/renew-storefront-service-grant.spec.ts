import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService, type EmbedTokenClaims } from "../domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../domain/embed-checkout-session.js";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { ResolveEmbedBuyerService } from "./resolve-embed-buyer.service.js";
import { AuthorizeStorefrontCartService } from "./authorize-storefront-cart.service.js";
import { DeriveStorefrontServiceScopes } from "./derive-storefront-service-scopes.js";
import { RenewStorefrontEmbedSessionService } from "./renew-storefront-embed-session.service.js";

function fixture() {
  const tokens = new EmbedTokenService({ value: Buffer.from("service-grant-existing-issuer-32-characters") });
  const conversations = new RealtimeCapabilityService("service-grant-conversation-proof-32-characters");
  const jwt = new BuyerJwtService("service-grant-real-buyer-proof-32-characters");
  const account = { globalUserId: "buyer-a", email: "buyer@example.invalid" };
  const buyers = new ResolveEmbedBuyerService(jwt, { findByGlobalUserId: async (id: string) => id === account.globalUserId ? account : null } as never);
  const state = { payment: null as null | { intent_id: string }, ordinaryPayment: null as null | { id: string }, insertDuringGrant: false, session: null as null | { merchantId: string; sessionId: string; globalUserId: string; customer: unknown }, mode: "services" };
  const scopes = new DeriveStorefrontServiceScopes({ merchant: { findUnique: async () => ({ businessMode: state.mode, businessModeSelectedAt: new Date(), businessModeNeedsReview: false }) } } as never, buyers, new AuthorizeStorefrontCartService(conversations));
  const derive = scopes.execute.bind(scopes); scopes.execute = async input => { const result = await derive(input); if (state.insertDuringGrant) state.ordinaryPayment = { id: "payment-created-during-proof" }; return result; };
  const now = Math.floor(Date.now() / 1000);
  const claims: EmbedTokenClaims = { typ: "aacp_embed_v1", merchantId: "merchant-a", storefrontCartRef: "conversation-a", allowedOrigin: "https://store.example.invalid", environment: "test", nonce: "original-guest-nonce", issuedAtUnix: now - 10, expiresAtUnix: now + 800, scopes: ["checkout:start", "payment:intents:read", "payment:intents:create"] };
  const service = new RenewStorefrontEmbedSessionService(tokens, { checkoutSession: { findUnique: async () => state.session }, paymentIntent: { findFirst: async () => state.ordinaryPayment } } as never, buyers,
    { execute: async () => ({ payment: state.payment }) } as never, { authorize: async () => { throw new Error("must not resume"); } } as never, scopes);
  const input = { previousToken: tokens.sign(claims), merchantId: claims.merchantId, storefrontCartRef: claims.storefrontCartRef!, origin: claims.allowedOrigin!, environment: "test" as const, scopes: [...claims.scopes!, "appointments:confirm"],
    conversationToken: conversations.issue({ purpose: "storefront-conversation", merchantId: claims.merchantId, resourceId: claims.storefrontCartRef!, origin: claims.allowedOrigin, aiUserId: "visitor:guest-a" }).token, buyerToken: jwt.sign(account) };
  return { service, tokens, claims, state, input, conversations };
}
test("T45 explicit existing issuance after guest login adds only verified service confirmation, preserving session and age", async () => {
  const f = fixture(); const result = await f.service.execute(f.input); const next = f.tokens.verify(result.embed_session_token);
  assert.deepEqual(next.scopes, [...f.claims.scopes!, "appointments:confirm"]); assert.equal(next.nonce, f.claims.nonce); assert.equal(next.issuedAtUnix, f.claims.issuedAtUnix); assert.equal(embedCheckoutSessionId(next), embedCheckoutSessionId(f.claims)); assert.equal(next.storefrontCartRef, f.claims.storefrontCartRef);
});
test("T45 a payment or observation-only token cannot be reopened for service confirmation", async () => {
  const f = fixture(); f.state.payment = { intent_id: "existing-payment" };
  assert.deepEqual(f.tokens.verify((await f.service.execute(f.input)).embed_session_token).scopes, ["payment:intents:read"]);
  f.state.payment = null; f.input.previousToken = f.tokens.sign({ ...f.claims, scopes: ["payment:intents:read"] });
  assert.deepEqual(f.tokens.verify((await f.service.execute(f.input)).embed_session_token).scopes, ["payment:intents:read"]);
});
test("T45 products, missing login and unrequested service scope do not gain authority", async () => {
  const f = fixture(); f.state.mode = "products"; assert.deepEqual(f.tokens.verify((await f.service.execute(f.input)).embed_session_token).scopes, f.claims.scopes);
  f.state.mode = "services";
  assert.deepEqual(f.tokens.verify((await f.service.execute({ ...f.input, buyerToken: undefined })).embed_session_token).scopes, f.claims.scopes);
  assert.deepEqual(f.tokens.verify((await f.service.execute({ ...f.input, scopes: f.claims.scopes })).embed_session_token).scopes, f.claims.scopes);
});
test("T45 ordinary payment created during the asynchronous login proof is observed before signing and stays read-only", async () => {
  const f = fixture(); f.state.insertDuringGrant = true;
  const next = f.tokens.verify((await f.service.execute(f.input)).embed_session_token);
  assert.deepEqual(next.scopes, ["payment:intents:read"]); assert.equal(next.nonce, f.claims.nonce); assert.equal(next.storefrontCartRef, f.claims.storefrontCartRef);
});
test("T45 forged login transition and another buyer's existing checkout are denied", async () => {
  const f = fixture();
  for (const patch of [{ conversationToken: "forged" }, { buyerToken: "forged" }, { conversationToken: f.conversations.issue({ purpose: "storefront-conversation", merchantId: "foreign", resourceId: f.input.storefrontCartRef, origin: f.input.origin }).token }, { storefrontCartRef: "foreign" }, { origin: "https://foreign.example.invalid" }]) await assert.rejects(f.service.execute({ ...f.input, ...patch }), /embed_checkout_continuation_unavailable/);
  f.state.session = { merchantId: f.claims.merchantId, sessionId: embedCheckoutSessionId(f.claims), globalUserId: "another-buyer", customer: { email: "another@example.invalid", email_verified: true } };
  await assert.rejects(f.service.execute(f.input), /embed_checkout_continuation_unavailable/);
});
