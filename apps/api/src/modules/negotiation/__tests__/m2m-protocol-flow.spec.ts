import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, createHash } from "node:crypto";

// ─── Domain: M2M Protocol Flow (test-first scaffolding) ──────────────────────
// Validates the state machine: discover → negotiate → quote → checkout → track
// and registration correctness per ADR REG-*, ST-*, NEG-*, QTE-*

// ═══════════════════════════════════════════════════════════════════════════════
// Test doubles — Clock port (ADR D5)
// ═══════════════════════════════════════════════════════════════════════════════

class FakeClock {
  private _now: number;
  constructor(initial?: number) {
    this._now = initial ?? Date.now();
  }
  now(): number {
    return this._now;
  }
  advance(ms: number): void {
    this._now += ms;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Minimal M2M protocol in-memory implementation for testing
// ═══════════════════════════════════════════════════════════════════════════════

type AgentCapability = "discover" | "negotiate" | "checkout";
type SessionStatus = "active" | "negotiating" | "quoted" | "checked_out" | "expired";

interface RegisteredAgent {
  agentId: string;
  name: string;
  secretHash: string;
  merchantId: string;
  capabilities: AgentCapability[];
  callbackUrl?: string;
  reputationScore: number;
  status: "active" | "suspended" | "banned";
}

interface M2mSession {
  sessionId: string;
  agentId: string;
  merchantId: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  rounds: number;
  quoteId?: string;
  quoteExpiresAt?: number;
}

class InMemoryM2mProtocol {
  private agents: Map<string, RegisteredAgent> = new Map();
  private sessions: Map<string, M2mSession> = new Map();
  private clock: FakeClock;
  private static SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
  private static QUOTE_TTL_MS = 60 * 60 * 1000;   // 60 min
  private static MAX_ROUNDS = 3;

  constructor(clock: FakeClock) {
    this.clock = clock;
  }

  register(input: {
    agentName: string;
    merchantId: string;
    capabilities: string[];
    callbackUrl?: string;
  }): { agentId: string; agentSecret: string } | { error: string } {
    // REG-03: capabilities required
    if (!input.capabilities || input.capabilities.length === 0) {
      return { error: "capabilities_required" };
    }
    // REG-04: validate capabilities
    const validCapabilities: AgentCapability[] = ["discover", "negotiate", "checkout"];
    for (const cap of input.capabilities) {
      if (!validCapabilities.includes(cap as AgentCapability)) {
        return { error: "unknown_capability" };
      }
    }
    // REG-05: callback_url must be HTTPS
    if (input.callbackUrl && !input.callbackUrl.startsWith("https://")) {
      return { error: "callback_must_be_https" };
    }

    const agentId = `agent_${randomBytes(16).toString("hex")}`;
    const plain = "m2m_" + randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(plain).digest("hex");

    this.agents.set(agentId, {
      agentId,
      name: input.agentName,
      secretHash: hash,
      merchantId: input.merchantId,
      capabilities: input.capabilities as AgentCapability[],
      callbackUrl: input.callbackUrl,
      reputationScore: 100,
      status: "active",
    });

    // REG-01: returns secret exactly once
    return { agentId, agentSecret: plain };
  }

  getAgent(agentId: string): Omit<RegisteredAgent, "secretHash"> & { secretLast4: string } | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    // REG-07: never return full secret — only last 4 of the hash
    const { secretHash, ...rest } = agent;
    return { ...rest, secretLast4: secretHash.slice(-4) };
  }

  discover(input: {
    agentId: string;
    merchantId: string;
  }): { products: { sku: string; name: string; price_cents: number }[]; sessionId: string } | { error: string; statusCode: number } {
    const agent = this.agents.get(input.agentId);
    if (!agent) return { error: "unknown_agent", statusCode: 401 };
    if (agent.status === "suspended") return { error: "agent_suspended", statusCode: 403 };
    if (agent.status === "banned") return { error: "agent_banned", statusCode: 403 };
    if (agent.merchantId !== input.merchantId) return { error: "cross_tenant_blocked", statusCode: 403 };
    if (!agent.capabilities.includes("discover")) return { error: "capability_not_allowed", statusCode: 403 };

    const sessionId = `m2m_session_${randomBytes(8).toString("hex")}`;
    this.sessions.set(sessionId, {
      sessionId,
      agentId: input.agentId,
      merchantId: input.merchantId,
      status: "active",
      createdAt: this.clock.now(),
      expiresAt: this.clock.now() + InMemoryM2mProtocol.SESSION_TTL_MS,
      rounds: 0,
    });

    return {
      products: [
        { sku: "nike_pegasus_41", name: "Nike Pegasus 41", price_cents: 54990 },
        { sku: "adidas_ultra_5", name: "Adidas Ultra 5", price_cents: 59990 },
      ],
      sessionId,
    };
  }

  negotiate(input: {
    agentId: string;
    merchantId: string;
    sessionId: string;
    targetDiscountPercent: number;
  }): { offer: { discount_percent: number; final_price_cents: number }; agreement: boolean } | { error: string; statusCode: number } {
    const agent = this.agents.get(input.agentId);
    if (!agent) return { error: "unknown_agent", statusCode: 401 };
    if (agent.merchantId !== input.merchantId) return { error: "cross_tenant_blocked", statusCode: 403 };
    if (!agent.capabilities.includes("negotiate")) return { error: "capability_not_allowed", statusCode: 403 };

    const session = this.sessions.get(input.sessionId);
    if (!session) return { error: "session_not_found", statusCode: 404 };
    if (session.agentId !== input.agentId) return { error: "not_session_owner", statusCode: 403 };

    // NEG-02: session expiry
    if (this.clock.now() > session.expiresAt) {
      session.status = "expired";
      return { error: "session_expired", statusCode: 410 };
    }

    // ST-04: max rounds
    if (session.rounds >= InMemoryM2mProtocol.MAX_ROUNDS) {
      return { error: "max_rounds_exceeded", statusCode: 400 };
    }

    session.rounds++;
    session.status = "negotiating";

    // Deterministic offer: merchant max discount = 10%
    const MERCHANT_MAX_DISCOUNT = 10;
    const grantedDiscount = Math.min(input.targetDiscountPercent, MERCHANT_MAX_DISCOUNT);
    const agreement = grantedDiscount >= input.targetDiscountPercent * 0.5;

    return {
      offer: {
        discount_percent: grantedDiscount,
        final_price_cents: Math.round(54990 * (1 - grantedDiscount / 100)),
      },
      agreement,
    };
  }

  quote(input: {
    agentId: string;
    merchantId: string;
    sessionId: string;
    acceptOffer: boolean;
  }): { quoteId: string; total_cents: number; expires_at: string } | { error: string; statusCode: number } {
    const agent = this.agents.get(input.agentId);
    if (!agent) return { error: "unknown_agent", statusCode: 401 };

    const session = this.sessions.get(input.sessionId);
    if (!session) return { error: "session_not_found", statusCode: 404 };
    if (session.agentId !== input.agentId) return { error: "not_session_owner", statusCode: 403 };

    // ST-01: must have negotiated first
    if (session.status !== "negotiating") {
      return { error: "invalid_state_transition", statusCode: 400 };
    }

    // NEG-02: session expiry
    if (this.clock.now() > session.expiresAt) {
      session.status = "expired";
      return { error: "session_expired", statusCode: 410 };
    }

    // ST-05: offer must be accepted
    if (!input.acceptOffer) {
      return { error: "offer_not_accepted", statusCode: 400 };
    }

    const quoteId = `quote_${randomBytes(8).toString("hex")}`;
    session.quoteId = quoteId;
    session.quoteExpiresAt = this.clock.now() + InMemoryM2mProtocol.QUOTE_TTL_MS;
    session.status = "quoted";

    return {
      quoteId,
      total_cents: 52641,
      expires_at: new Date(session.quoteExpiresAt).toISOString(),
    };
  }

  checkout(input: {
    agentId: string;
    merchantId: string;
    quoteId: string;
  }): { orderId: string; status: string } | { error: string; statusCode: number } {
    const agent = this.agents.get(input.agentId);
    if (!agent) return { error: "unknown_agent", statusCode: 401 };
    if (agent.merchantId !== input.merchantId) return { error: "cross_tenant_blocked", statusCode: 403 };

    // Find session by quoteId
    let targetSession: M2mSession | undefined;
    for (const session of this.sessions.values()) {
      if (session.quoteId === input.quoteId) {
        targetSession = session;
        break;
      }
    }
    if (!targetSession) return { error: "unknown_quote", statusCode: 404 };
    if (targetSession.agentId !== input.agentId) return { error: "cross_tenant_blocked", statusCode: 403 };
    if (targetSession.status !== "quoted") return { error: "invalid_state_transition", statusCode: 400 };

    // QTE-03: quote expiry
    if (this.clock.now() > (targetSession.quoteExpiresAt ?? 0)) {
      targetSession.status = "expired";
      return { error: "quote_expired", statusCode: 410 };
    }

    targetSession.status = "checked_out";
    const orderId = `order_${randomBytes(8).toString("hex")}`;

    return { orderId, status: "pending_payment" };
  }

  track(input: {
    agentId: string;
    merchantId: string;
    orderId: string;
  }): { orderId: string; status: string } | { error: string; statusCode: number } {
    const agent = this.agents.get(input.agentId);
    if (!agent) return { error: "unknown_agent", statusCode: 401 };
    if (agent.merchantId !== input.merchantId) return { error: "cross_tenant_blocked", statusCode: 403 };
    // Simplified: return a status
    return { orderId: input.orderId, status: "shipped" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Registration Tests (REG-*) ──────────────────────────────────────────────

test("REG-01: register creates agent with unique ID + secret returned once", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "ShopBot v3",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });

  assert.ok("agentId" in result);
  assert.ok("agentSecret" in result);
  assert.match(result.agentSecret, /^m2m_[a-f0-9]{64}$/);
  assert.ok(result.agentId.startsWith("agent_"));
});

test("REG-06: secret length ≥ 68 chars (m2m_ prefix + 64 hex)", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: ["discover"],
  });
  assert.ok("agentSecret" in result);
  assert.ok(result.agentSecret.length >= 68);
});

test("REG-07: secret NOT returned by getAgent — only last 4 chars", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: ["discover"],
  });
  assert.ok("agentId" in result);

  const agentInfo = protocol.getAgent(result.agentId);
  assert.ok(agentInfo !== null);
  assert.ok("secretLast4" in agentInfo);
  assert.equal(agentInfo.secretLast4.length, 4);
  // Must NOT have a full secretHash or agentSecret field
  assert.equal("secretHash" in agentInfo, false);
  assert.equal("agentSecret" in agentInfo, false);
});

test("REG-08: secret not stored plaintext — only hash persisted", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: ["discover"],
  });
  assert.ok("agentSecret" in result);
  // Internal representation should store hash, not plain
  const agentInfo = protocol.getAgent((result as any).agentId);
  assert.ok(agentInfo !== null);
  // The returned object must not contain the plaintext secret
  const serialized = JSON.stringify(agentInfo);
  assert.ok(!serialized.includes(result.agentSecret));
});

test("REG-03: empty capabilities → capabilities_required", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: [],
  });
  assert.ok("error" in result);
  assert.equal(result.error, "capabilities_required");
});

test("REG-04: unknown capability → unknown_capability", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: ["discover", "delete"],
  });
  assert.ok("error" in result);
  assert.equal(result.error, "unknown_capability");
});

test("REG-05: callback_url not HTTPS → callback_must_be_https", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const result = protocol.register({
    agentName: "Bot",
    merchantId: "merchant_test",
    capabilities: ["discover"],
    callbackUrl: "http://insecure.example.com/hook",
  });
  assert.ok("error" in result);
  assert.equal(result.error, "callback_must_be_https");
});

// ─── Capability gating ───────────────────────────────────────────────────────

test("Capability check: agent without 'negotiate' capability cannot negotiate", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "DiscoverOnly",
    merchantId: "merchant_test",
    capabilities: ["discover"],
  });
  assert.ok("agentId" in reg);

  // Discover should work
  const discoverResult = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discoverResult);

  // Negotiate should fail
  const negResult = protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discoverResult as any).sessionId,
    targetDiscountPercent: 10,
  });
  assert.ok("error" in negResult);
  assert.equal(negResult.error, "capability_not_allowed");
});

// ─── Protocol Flow Tests (ST-*) ─────────────────────────────────────────────

test("ST-02: full happy path discover → negotiate → quote → checkout → track", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);

  // Register
  const reg = protocol.register({
    agentName: "FullBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  // Discover
  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);
  assert.ok("products" in discover);
  assert.ok((discover as any).products.length > 0);

  // Negotiate
  const negotiate = protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    targetDiscountPercent: 7,
  });
  assert.ok("offer" in negotiate);
  assert.ok((negotiate as any).agreement === true);

  // Quote
  const quote = protocol.quote({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    acceptOffer: true,
  });
  assert.ok("quoteId" in quote);
  assert.ok("total_cents" in quote);

  // Checkout
  const checkout = protocol.checkout({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    quoteId: (quote as any).quoteId,
  });
  assert.ok("orderId" in checkout);
  assert.equal((checkout as any).status, "pending_payment");

  // Track
  const track = protocol.track({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    orderId: (checkout as any).orderId,
  });
  assert.ok("status" in track);
});

test("ST-01: discover → quote (skipping negotiate) → invalid_state_transition", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "SkipBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);

  // Try to quote without negotiating
  const quote = protocol.quote({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    acceptOffer: true,
  });
  assert.ok("error" in quote);
  assert.equal(quote.error, "invalid_state_transition");
  assert.equal((quote as any).statusCode, 400);
});

test("ST-04: negotiate round > 3 → max_rounds_exceeded", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "PersistentBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);
  const sessionId = (discover as any).sessionId;

  // 3 rounds OK
  for (let i = 0; i < 3; i++) {
    const neg = protocol.negotiate({
      agentId: reg.agentId,
      merchantId: "merchant_test",
      sessionId,
      targetDiscountPercent: 15,
    });
    assert.ok("offer" in neg, `Round ${i + 1} should succeed`);
  }

  // 4th round fails
  const neg4 = protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId,
    targetDiscountPercent: 15,
  });
  assert.ok("error" in neg4);
  assert.equal(neg4.error, "max_rounds_exceeded");
});

test("ST-05: quote with accept_offer=false → offer_not_accepted", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "RejectBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);

  protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    targetDiscountPercent: 5,
  });

  const quote = protocol.quote({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    acceptOffer: false,
  });
  assert.ok("error" in quote);
  assert.equal(quote.error, "offer_not_accepted");
});

// ─── Session Expiry (NEG-02, QTE-03 / ADR D5 clock port) ────────────────────

test("NEG-02: session expires after 30 min — negotiate rejected", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "SlowBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);

  // Advance clock past 30 minutes
  clock.advance(30 * 60 * 1000 + 1000); // 30 min + 1 sec

  const neg = protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    targetDiscountPercent: 5,
  });
  assert.ok("error" in neg);
  assert.equal(neg.error, "session_expired");
  assert.equal((neg as any).statusCode, 410);
});

test("QTE-03: quote expires after 60 min — checkout rejected", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "DelayBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);

  protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    targetDiscountPercent: 5,
  });

  const quote = protocol.quote({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    acceptOffer: true,
  });
  assert.ok("quoteId" in quote);

  // Advance clock past 60 minutes
  clock.advance(60 * 60 * 1000 + 1000); // 60 min + 1 sec

  const checkout = protocol.checkout({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    quoteId: (quote as any).quoteId,
  });
  assert.ok("error" in checkout);
  assert.equal(checkout.error, "quote_expired");
  assert.equal((checkout as any).statusCode, 410);
});

// ─── Failed negotiation (E2E scenario 22) ────────────────────────────────────

test("Failed negotiation: buyer wants 50% but merchant max 10% → partial offer, no full agreement", () => {
  const clock = new FakeClock();
  const protocol = new InMemoryM2mProtocol(clock);
  const reg = protocol.register({
    agentName: "GreedyBot",
    merchantId: "merchant_test",
    capabilities: ["discover", "negotiate", "checkout"],
  });
  assert.ok("agentId" in reg);

  const discover = protocol.discover({ agentId: reg.agentId, merchantId: "merchant_test" });
  assert.ok("sessionId" in discover);

  const neg = protocol.negotiate({
    agentId: reg.agentId,
    merchantId: "merchant_test",
    sessionId: (discover as any).sessionId,
    targetDiscountPercent: 50,
  });
  assert.ok("offer" in neg);
  // Merchant max is 10%, so granted is 10% which is < 50% * 0.5 = 25%
  assert.equal((neg as any).offer.discount_percent, 10);
  assert.equal((neg as any).agreement, false);
});
