import test from "node:test";
import assert from "node:assert/strict";
import { RecoveryLinkTokenService, RECOVERY_LINK_TTL_SECONDS } from "../domain/recovery-link-token.service.js";
import { GenerateRecoveryLinkUseCase, recoveryStoreUrl } from "../application/use-cases/generate-recovery-link.use-case.js";
import { ResumeRecoveryCheckoutUseCase } from "../application/use-cases/resume-recovery-checkout.use-case.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { IssueEmbedSessionUseCase } from "../../embed/application/issue-embed-session.use-case.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "../../embed/presentation/http/embed-checkout.controller.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { createStartCheckoutUseCase } from "../../checkout/application/use-cases/start-checkout.fixture.js";
import { AttemptCartRecoveryUseCase } from "../application/use-cases/attempt-cart-recovery.use-case.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";

const secret = "local-recovery-test-secret-at-least-32-characters";
test("recovery tokens reject tampering, expiry, future issuance and wrong signing key", () => {
  const tokens = new RecoveryLinkTokenService(secret);
  const token = tokens.issue("merchant", "checkout", 1000);
  assert.equal(tokens.verify(token, 1001).sessionId, "checkout");
  for (const value of ["", token + "x", token.replace(/^./, token[0] === "a" ? "b" : "a"), undefined]) {
    assert.throws(() => tokens.verify(value, 1001), /recovery_link_invalid_or_expired/);
  }
  assert.throws(() => tokens.verify(token, 999), /recovery_link_invalid_or_expired/);
  assert.throws(() => tokens.verify(token, 1000 + RECOVERY_LINK_TTL_SECONDS), /recovery_link_invalid_or_expired/);
  assert.throws(() => new RecoveryLinkTokenService(secret + "other").verify(token, 1001));
  assert.throws(() => tokens.issue("merchant", "../checkout"));
});

async function fixture() {
  const tokens = new RecoveryLinkTokenService(secret);
  const embedTokens = new EmbedTokenService({ value: Buffer.from(secret) });
  const sessions = new InMemoryCheckoutRepository();
  const session = checkoutSession();
  await sessions.saveSession(session);
  const state = { buyer: { globalUserId: session.globalUserId, customer: { email: session.customer!.email!, email_verified: true } } as any, paid: false, ordered: false };
  const prisma = {
    merchant: { findUnique: async ({ where }: any) => where.id === session.merchantId ? { storeSlug: "test-store" } : null },
    completedOrder: { findFirst: async ({ where }: any) => { assert.equal(where.merchantId, session.merchantId); return state.ordered ? { id: "order" } : null; } },
    paymentIntent: { findFirst: async ({ where }: any) => { assert.equal(where.sessionId, session.sessionId); return state.paid ? { id: "payment" } : null; } },
  } as any;
  const buyers = { resolve: async (_merchant: string, token: unknown) => token === "buyer-proof" ? state.buyer : undefined };
  const generate = new GenerateRecoveryLinkUseCase(prisma, sessions, tokens);
  const resume = new ResumeRecoveryCheckoutUseCase(prisma, sessions, tokens, buyers as never, new IssueEmbedSessionUseCase(embedTokens));
  const link = new URL(await generate.execute({ merchantId: session.merchantId, sessionId: session.sessionId }));
  return { tokens, embedTokens, sessions, session, state, generate, resume, link, buyers,
    input: { slug: "test-store", token: link.searchParams.get("recovery"), origin: link.origin, buyerToken: "buyer-proof" } };
}
test("generator builds the store checkout URL and scopes its session lookup", async () => {
  const h = await fixture();
  assert.equal(h.link.pathname, "/store/test-store");
  assert.equal(h.link.searchParams.get("show"), "checkout");
  assert.deepEqual([...h.link.searchParams.keys()], ["show", "recovery"]);
  assert.equal(h.tokens.verify(h.input.token).merchantId, h.session.merchantId);
  await assert.rejects(h.generate.execute({ merchantId: "other", sessionId: h.session.sessionId }), /recovery_purchase_unavailable/);
  await assert.rejects(h.generate.execute({ merchantId: h.session.merchantId, sessionId: "" }), /recovery_session_required/);
});
test("configured base query and path never corrupt the checkout destination", () => {
  const before = process.env.PUBLIC_STOREFRONT_URL;
  try {
    process.env.PUBLIC_STOREFRONT_URL = "https://store.example/old?embedToken=old";
    assert.equal(recoveryStoreUrl("my store").href, "https://store.example/store/my%20store");
    process.env.PUBLIC_STOREFRONT_URL = "javascript:alert(1)";
    assert.throws(() => recoveryStoreUrl("test"), /recovery_storefront_url_invalid/);
  } finally { if (before === undefined) delete process.env.PUBLIC_STOREFRONT_URL; else process.env.PUBLIC_STOREFRONT_URL = before; }
});
test("a link alone cannot retrieve checkout credentials and another buyer cannot resume it", async () => {
  const h = await fixture();
  await assert.rejects(h.resume.execute({ ...h.input, buyerToken: undefined }), /recovery_buyer_login_required/);
  await assert.rejects(h.resume.execute({ ...h.input, slug: "other" }), /recovery_store_mismatch/);
  await assert.rejects(h.resume.execute({ ...h.input, origin: "https://other.example" }), /recovery_origin_not_allowed/);
  h.state.buyer.globalUserId = "other";
  await assert.rejects(h.resume.execute(h.input), /recovery_buyer_mismatch/);
});
test("completed and paid purchases never issue new credentials", async () => {
  const h = await fixture();
  h.state.paid = true;
  await assert.rejects(h.resume.execute(h.input), /recovery_purchase_completed/);
  h.state.paid = false; h.state.ordered = true;
  await assert.rejects(h.resume.execute(h.input), /recovery_purchase_completed/);
});
test("authenticated recovery preserves session attribution and requotes the trusted cart before payment review", async () => {
  const h = await fixture();
  const issued = await h.resume.execute(h.input);
  const claims = h.embedTokens.verify(issued.embed_session_token);
  assert.equal(embedCheckoutSessionId(claims), h.session.sessionId);
  assert.equal(claims.allowedOrigin, h.link.origin);
  assert.ok(claims.expiresAtUnix - claims.issuedAtUnix <= 900);
  const authority = { resolve: async (merchant: string, cart: any) => {
    assert.equal(merchant, h.session.merchantId); assert.equal(cart.items[0].sku, "kit");
    return { ...cart, total: 350, items: [{ ...cart.items[0], price: 350 }] };
  } } as any;
  const start = createStartCheckoutUseCase(h.sessions, h.sessions, { cartAuthority: authority });
  const controller = new EmbedCheckoutController(start, {} as never, {} as never, new EmbedCheckoutGuardHelper(h.sessions),
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, h.buyers as never);
  await controller.start({ embedClaims: claims }, { merchant_id: "other", buyer_access_token: "buyer-proof",
    cart: { currency: "BRL", total: 0.01, items: [{ sku: "forged", name: "forged", quantity: 99, price: 0.01 }] } });
  const resumed = await h.sessions.getSession(h.session.merchantId, h.session.sessionId);
  assert.equal(resumed?.cart.total, 350);
  assert.equal(resumed?.globalUserId, h.session.globalUserId);
  assert.equal(resumed?.shipping, undefined);
  assert.equal(resumed?.paymentMethod, undefined);
  await assert.rejects(controller.start({ embedClaims: claims }, { merchant_id: h.session.merchantId, cart: h.session.cart }), /checkout_buyer_proof_required/);
});
test("failure to generate a recovery link sends nothing and leaves the attempt unclaimed", async () => {
  const repo = new InMemoryRecoveryAttemptRepository();
  let sends = 0;
  const attempt = new AttemptCartRecoveryUseCase(repo, undefined, { execute: async () => { sends++; return { status: "sent", channel: "email", messageId: "id" }; } },
    async () => { throw new Error("link_unavailable"); });
  await assert.rejects(attempt.execute({ merchantId: "merchant", sessionId: "checkout", globalUserId: "buyer", abandonmentScore: 0.9,
    events: [], buyerEmail: "buyer@example.test", buyerHistory: { known_buyer: false, discount_sensitivity: "low", recent_skus: [] },
    merchantRules: { allowFreeShipping: false, maxDiscountPercent: 0 }, forcedStrategy: { type: "personalized_cross_sell", recent_skus: [] } } as any), /link_unavailable/);
  assert.equal(repo.count(), 0); assert.equal(sends, 0);
});
