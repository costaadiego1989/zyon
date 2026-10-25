import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService, type EmbedTokenClaims } from "../domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../domain/embed-checkout-session.js";
import { RenewStorefrontEmbedSessionService } from "./renew-storefront-embed-session.service.js";

function fixture(patch: Partial<EmbedTokenClaims> = {}) {
  const tokens = new EmbedTokenService({ value: Buffer.from("synthetic-continuity-test-secret-32") });
  const now = Math.floor(Date.now() / 1000), calls: Array<{ kind: string; input: unknown }> = [];
  const claims: EmbedTokenClaims = { typ: "aacp_embed_v1", merchantId: "synthetic-merchant", nonce: "synthetic-original-nonce",
    environment: "test", allowedOrigin: "https://store.fixture.invalid", storefrontCartRef: "synthetic-cart",
    issuedAtUnix: now - 1200, expiresAtUnix: now - 300, scopes: ["checkout:start", "payment:intents:read", "payment:intents:create"], ...patch };
  const session = { merchantId: claims.merchantId, sessionId: embedCheckoutSessionId(claims), globalUserId: "synthetic-buyer",
    customer: { email: "synthetic@example.invalid", email_verified: false } };
  const controls = { missing: false, buyer: undefined as undefined | { globalUserId: string; customer: { email: string; email_verified: true } },
    payment: null as null | { intent_id: string }, fail: false };
  const service = new RenewStorefrontEmbedSessionService(tokens, { checkoutSession: { async findUnique(input: unknown) {
    calls.push({ kind: "checkout", input }); return controls.missing ? null : session;
  } } } as never, { async resolve(merchant: string, token: unknown) { calls.push({ kind: "buyer", input: { merchant, token } }); return controls.buyer; } } as never,
  { async execute(input: unknown) { calls.push({ kind: "payment", input }); if (controls.fail) throw Error("PRIVATE_CANARY"); return { payment: controls.payment }; } } as never,
  { async authorize() { throw Error("unexpected_resume"); } } as never);
  const input = { merchantId: claims.merchantId, storefrontCartRef: claims.storefrontCartRef!, origin: claims.allowedOrigin!,
    environment: "test" as const, previousToken: tokens.sign(claims), scopes: ["checkout:start", "payment:intents:read", "payment:intents:create", "coupons:apply"] };
  return { tokens, claims, service, session, controls, calls, input };
}
const refused = (work: Promise<unknown>) => assert.rejects(work, /embed_checkout_continuation_unavailable/);

test("real signer and renewal preserve the original checkout nonce/session and first issuance age", async () => {
  const f = fixture(); const result = await f.service.execute(f.input), renewed = f.tokens.verify(result.embed_session_token);
  assert.equal(renewed.nonce, f.claims.nonce); assert.equal(embedCheckoutSessionId(renewed), f.session.sessionId);
  assert.equal(renewed.issuedAtUnix, f.claims.issuedAtUnix); assert.equal(renewed.storefrontCartRef, f.claims.storefrontCartRef);
  assert.deepEqual(renewed.scopes, f.claims.scopes); assert.equal(renewed.scopes!.includes("coupons:apply"), false);
  assert.ok(renewed.expiresAtUnix <= f.claims.issuedAtUnix + 86400);
  assert.deepEqual(f.calls.find(call => call.kind === "checkout")!.input, { where: { merchantId_sessionId: {
    merchantId: f.input.merchantId, sessionId: f.session.sessionId } } });
});

test("renewal with no checkout row preserves signed identity rather than choosing an owner by cart", async () => {
  const f = fixture(); f.controls.missing = true;
  const result = await f.service.execute(f.input); assert.equal(embedCheckoutSessionId(f.tokens.verify(result.embed_session_token)), f.session.sessionId);
});

for (const patch of [{ merchantId: "foreign" }, { storefrontCartRef: "foreign" }, { origin: "https://foreign.invalid" },
  { environment: "live" as const }, { installationId: "foreign" }]) test(`continuation refuses changed context ${JSON.stringify(patch)} before storage`, async () => {
  const f = fixture(); await refused(f.service.execute({ ...f.input, ...patch })); assert.equal(f.calls.length, 0);
});

test("invalid signature never falls back to fresh issuance", async () => {
  const f = fixture(); await refused(f.service.execute({ ...f.input, previousToken: `${f.input.previousToken}tampered` })); assert.equal(f.calls.length, 0);
});

test("verified buyer checkout requires current matching buyer proof", async () => {
  const f = fixture(); f.session.customer.email_verified = true;
  await refused(f.service.execute(f.input));
  f.controls.buyer = { globalUserId: "synthetic-buyer", customer: { email: "synthetic@example.invalid", email_verified: true } };
  const result = await f.service.execute({ ...f.input, buyerToken: "synthetic-buyer-proof" });
  assert.equal(embedCheckoutSessionId(f.tokens.verify(result.embed_session_token)), f.session.sessionId);
});

for (const patch of [{ globalUserId: "foreign" }, { customer: { email: "foreign@example.invalid", email_verified: true as const } }]) test(`different authenticated buyer cannot continue ${JSON.stringify(patch)}`, async () => {
  const f = fixture(); f.controls.buyer = { globalUserId: "synthetic-buyer", customer: { email: "synthetic@example.invalid", email_verified: true }, ...patch };
  await refused(f.service.execute({ ...f.input, buyerToken: "synthetic-buyer-proof" })); assert.equal(f.calls.some(call => call.kind === "payment"), false);
});

test("payment already exists: reopen is observation-only, never new payment admission", async () => {
  const f = fixture(); f.controls.payment = { intent_id: "synthetic-pending-intent" };
  const result = await f.service.execute(f.input), claims = f.tokens.verify(result.embed_session_token);
  assert.deepEqual(claims.scopes, ["payment:intents:read"]); assert.equal(claims.paymentResume, undefined);
  assert.equal(embedCheckoutSessionId(claims), f.session.sessionId);
});

test("renewal chains never reset the original one-day continuation limit", async () => {
  const now = Math.floor(Date.now() / 1000), f = fixture({ issuedAtUnix: now - 86390, expiresAtUnix: now - 86000 });
  const result = await f.service.execute(f.input), renewed = f.tokens.verify(result.embed_session_token);
  assert.equal(renewed.issuedAtUnix, f.claims.issuedAtUnix); assert.equal(renewed.expiresAtUnix, f.claims.issuedAtUnix + 86400);
  const expired = fixture({ issuedAtUnix: now - 86400, expiresAtUnix: now - 86000 }); await refused(expired.service.execute(expired.input));
  assert.equal(expired.calls.length, 0);
});

test("payment lookup failure yields fixed refusal without retry or fresh identity", async () => {
  const f = fixture(); f.controls.fail = true; await refused(f.service.execute(f.input));
  assert.equal(f.calls.filter(call => call.kind === "payment").length, 1);
});
