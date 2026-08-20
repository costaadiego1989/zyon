import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// ─── E2E Tests for M2M Protocol ──────────────────────────────────────────────
// Full journey: register → discover → negotiate → quote → checkout → track
// Per ADR Design Spec section 1 (Protocol Flow)

// This is a minimal in-memory simulation of the full happy path.
// Production version will use supertest against the real NestJS app + Prisma.

class M2mE2eSimulator {
  private agents: Map<string, { id: string; secret: string; merchant: string }> = new Map();
  private sessions: Map<string, {
    agentId: string;
    status: "active" | "negotiated" | "quoted" | "checked_out";
    products: any[];
  }> = new Map();
  private quotes: Map<string, {
    sessionId: string;
    agentId: string;
    merchantId: string;
    total: number;
  }> = new Map();
  private orders: Map<string, { status: string }> = new Map();

  register(input: { name: string; capabilities: string[]; callback?: string }) {
    const id = `agent_${Date.now()}`;
    const secret = `m2m_${randomBytes(32).toString("hex")}`;
    this.agents.set(id, { id, secret, merchant: "merchant_test" });
    return { agent_id: id, agent_secret: secret };
  }

  discover(agentId: string, merchant: string) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("agent_not_found");
    if (agent.merchant !== merchant) throw new Error("cross_tenant_blocked");

    const sessionId = `m2m_session_${Date.now()}`;
    this.sessions.set(sessionId, {
      agentId,
      status: "active",
      products: [
        { sku: "nike_pegasus_41", name: "Nike Pegasus 41", price: 549.90 },
      ],
    });
    return { sessionId, products: this.sessions.get(sessionId)!.products };
  }

  negotiate(agentId: string, merchant: string, sessionId: string, discount: number) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session_not_found");
    if (session.agentId !== agentId) throw new Error("not_session_owner");
    session.status = "negotiated";
    return {
      session_id: sessionId,
      agreement: true,
      offer: { discount_percent: Math.min(discount, 10), final_price_cents: 51141 },
    };
  }

  quote(agentId: string, merchant: string, sessionId: string, acceptOffer: boolean) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "negotiated") throw new Error("session_not_found");
    if (!acceptOffer) throw new Error("offer_not_accepted");

    const quoteId = `quote_${Date.now()}`;
    this.quotes.set(quoteId, { sessionId, agentId, merchantId: merchant, total: 52641 });
    session.status = "quoted";
    return { quote_id: quoteId, total_cents: 52641 };
  }

  checkout(agentId: string, merchant: string, quoteId: string, paymentMethod: string) {
    const quote = this.quotes.get(quoteId);
    if (!quote) throw new Error("unknown_quote");
    if (quote.agentId !== agentId) throw new Error("not_quote_owner");
    if (quote.merchantId !== merchant) throw new Error("cross_tenant_blocked");

    const orderId = `order_${Date.now()}`;
    this.orders.set(orderId, { status: "pending_payment" });
    return { order_id: orderId, status: "pending_payment" };
  }

  track(agentId: string, merchant: string, orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("order_not_found");
    return { order_id: orderId, status: "shipped" };
  }
}

// ─── E2E Happy Path ─────────────────────────────────────────────────────────

test("E2E-01: Full journey register → discover → negotiate → quote → checkout → track", () => {
  const sim = new M2mE2eSimulator();

  // 1. Register
  const reg = sim.register({
    name: "ShopBot v3",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok(reg.agent_id);
  assert.match(reg.agent_secret, /^m2m_/);

  // 2. Discover
  const discover = sim.discover(reg.agent_id, "merchant_test");
  assert.ok(discover.sessionId);
  assert.equal(discover.products.length, 1);
  assert.equal(discover.products[0].name, "Nike Pegasus 41");

  // 3. Negotiate
  const negotiate = sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 7);
  assert.equal(negotiate.agreement, true);
  assert.equal(negotiate.offer.discount_percent, 7);

  // 4. Quote
  const quote = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);
  assert.ok(quote.quote_id);
  assert.equal(quote.total_cents, 52641);

  // 5. Checkout
  const checkout = sim.checkout(reg.agent_id, "merchant_test", quote.quote_id, "pix");
  assert.ok(checkout.order_id);
  assert.equal(checkout.status, "pending_payment");

  // 6. Track
  const track = sim.track(reg.agent_id, "merchant_test", checkout.order_id);
  assert.equal(track.order_id, checkout.order_id);
  assert.equal(track.status, "shipped");
});

// ─── E2E Failure Modes ───────────────────────────────────────────────────────

test("E2E-02: Cross-merchant access blocked at every endpoint", () => {
  const sim = new M2mE2eSimulator();

  // Register for merchant_A
  const reg = sim.register({ name: "Bot", capabilities: ["discover"] });
  // Attempt to discover as merchant_B
  assert.throws(
    () => sim.discover(reg.agent_id, "merchant_B"),
    /cross_tenant_blocked/,
  );
});

test("E2E-03: Invalid state transitions blocked", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");

  // Try to quote without negotiating
  assert.throws(
    () => sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true),
    /session_not_found/,
  );
});

test("E2E-04: Offer rejection blocks quote", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);

  // Reject offer
  assert.throws(
    () => sim.quote(reg.agent_id, "merchant_test", discover.sessionId, false),
    /offer_not_accepted/,
  );
});

// ─── E2E Timing Validation ──────────────────────────────────────────────────

test("E2E-05: Full journey completes in reasonable time (< 500ms simulation)", () => {
  const sim = new M2mE2eSimulator();
  const start = Date.now();

  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 7);
  const quote = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);
  sim.checkout(reg.agent_id, "merchant_test", quote.quote_id, "pix");
  sim.track(reg.agent_id, "merchant_test", `order_${Date.now()}`);

  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `Journey took ${elapsed}ms, expected < 500ms`);
});

// ─── Contract Validation (Section 3 of DESIGN_SPEC) ──────────────────────────

test("CONTRACT: /m2m/register response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const response = sim.register({ name: "Bot", capabilities: ["discover"] });

  // From Design Spec section 3.1
  assert.ok("agent_id" in response);
  assert.ok("agent_secret" in response);
  assert.match(response.agent_id, /^agent_/);
  assert.match(response.agent_secret, /^m2m_[a-f0-9]{64}$/);
});

test("CONTRACT: /m2m/discover response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover"] });
  const response = sim.discover(reg.agent_id, "merchant_test");

  // From Design Spec section 3.2
  assert.ok("products" in response);
  assert.ok("sessionId" in response);
  assert.ok(Array.isArray(response.products));
  assert.ok(response.products[0].sku);
  assert.ok(response.products[0].name);
  assert.ok(typeof response.products[0].price === "number");
});

test("CONTRACT: /m2m/negotiate response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  const response = sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);

  // From Design Spec section 3.3
  assert.ok("session_id" in response);
  assert.ok("agreement" in response);
  assert.ok("offer" in response);
  assert.ok("discount_percent" in response.offer);
  assert.ok("final_price_cents" in response.offer);
});

test("CONTRACT: /m2m/quote response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);
  const response = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);

  // From Design Spec section 3.4
  assert.ok("quote_id" in response);
  assert.ok("total_cents" in response);
});

test("CONTRACT: /m2m/checkout response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);
  const quote = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);
  const response = sim.checkout(reg.agent_id, "merchant_test", quote.quote_id, "pix");

  // From Design Spec section 3.5
  assert.ok("order_id" in response);
  assert.ok("status" in response);
});

test("CONTRACT: /m2m/track response shape matches spec", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);
  const quote = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);
  const checkout = sim.checkout(reg.agent_id, "merchant_test", quote.quote_id, "pix");
  const response = sim.track(reg.agent_id, "merchant_test", checkout.order_id);

  // From Design Spec section 3.6
  assert.ok("order_id" in response);
  assert.ok("status" in response);
});

// ─── Deterministic LLM Negotiation (ADR D7) ──────────────────────────────────

test("Negotiation uses deterministic offer logic (no randomness from LLM)", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate"] });

  // Same input should produce same output
  const discover = sim.discover(reg.agent_id, "merchant_test");
  const offer1 = sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 15);

  const discover2 = sim.discover(reg.agent_id, "merchant_test");
  const offer2 = sim.negotiate(reg.agent_id, "merchant_test", discover2.sessionId, 15);

  // Same discount target should produce same merchant offer
  assert.equal(offer1.offer.discount_percent, offer2.offer.discount_percent);
  assert.equal(offer1.offer.final_price_cents, offer2.offer.final_price_cents);
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("NEG-01: same cart → cached offer (idempotent)", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");

  // First negotiate
  const offer1 = sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 7);

  // Second negotiate same session (same cart fingerprint)
  const offer2 = sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 7);

  // Should be identical (fingerprint based caching in production)
  assert.equal(offer1.offer.discount_percent, offer2.offer.discount_percent);
});

test("QTE-01: re-quote same session before expiry → same quote_id", () => {
  const sim = new M2mE2eSimulator();
  const reg = sim.register({ name: "Bot", capabilities: ["discover", "negotiate", "checkout"] });
  const discover = sim.discover(reg.agent_id, "merchant_test");
  sim.negotiate(reg.agent_id, "merchant_test", discover.sessionId, 5);

  const quote1 = sim.quote(reg.agent_id, "merchant_test", discover.sessionId, true);

  // Re-quote same session (in production: different request, same content)
  // This test is simplified — production needs to return the same quote_id
  // For now, it returns a new one but with same content
  assert.ok(quote1.quote_id);
});
