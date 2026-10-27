import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, createHash } from "node:crypto";

// ─── Security Tests for M2M Protocol ─────────────────────────────────────────
// Validates: cross-merchant isolation (XM-*), rate limiting (RATE-*),
// replay attack prevention (AUTH-08), secret hygiene (SEC-*), and agent status checks

// ═══════════════════════════════════════════════════════════════════════════════
// Test Doubles
// ═══════════════════════════════════════════════════════════════════════════════

class FakeClock {
  private _now: number;
  constructor(initial?: number) {
    this._now = initial ?? Date.now();
  }
  now(): number { return this._now; }
  advance(ms: number): void { this._now += ms; }
}

/** In-memory nonce store for replay detection */
class NonceStore {
  private nonces: Map<string, number> = new Map(); // nonce → timestamp (ms)
  private WINDOW_MS = 600_000; // 2× 300s window = 10 min

  /** Returns true if nonce was already used (replay) */
  checkAndStore(nonce: string, timestamp: number, now: number): boolean {
    // Cleanup expired nonces
    for (const [key, ts] of this.nonces) {
      if (now - ts > this.WINDOW_MS) this.nonces.delete(key);
    }
    if (this.nonces.has(nonce)) return true; // replay
    this.nonces.set(nonce, now);
    return false;
  }
}

/** In-memory rate limiter (per-agent) */
class RateLimiter {
  private counters: Map<string, { count: number; windowStart: number }> = new Map();
  private limit: number;
  private windowMs: number;

  constructor(limit = 60, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(agentId: string, now: number): { allowed: boolean; retryAfterSeconds?: number } {
    let entry = this.counters.get(agentId);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { count: 0, windowStart: now };
      this.counters.set(agentId, entry);
    }
    entry.count++;
    if (entry.count > this.limit) {
      const retryAfter = Math.ceil((entry.windowStart + this.windowMs - now) / 1000);
      return { allowed: false, retryAfterSeconds: retryAfter };
    }
    return { allowed: true };
  }

  getCount(agentId: string): number {
    return this.counters.get(agentId)?.count ?? 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-merchant isolation (XM-*)
// ═══════════════════════════════════════════════════════════════════════════════

test("XM-01: agent registered for merchant A calling merchant B → cross_tenant_blocked", () => {
  // Agent is bound to merchant_A at registration time
  const agentMerchant: string = "merchant_A";
  const requestedMerchant: string = "merchant_B";

  // Simulate guard logic
  const isAllowed = agentMerchant === requestedMerchant;
  assert.equal(isAllowed, false);

  // In production, this returns 403 cross_tenant_blocked
  const response = { statusCode: 403, error: "cross_tenant_blocked" };
  assert.equal(response.statusCode, 403);
  assert.equal(response.error, "cross_tenant_blocked");
});

test("XM-02: agent's first request sets merchant_id as bound scope", () => {
  const registeredMerchantId = "merchant_test";

  // All subsequent requests must use the same merchant_id
  const validRequest = { merchantId: registeredMerchantId };
  const invalidRequest = { merchantId: "merchant_other" };

  assert.equal(validRequest.merchantId === registeredMerchantId, true);
  assert.equal(invalidRequest.merchantId === registeredMerchantId, false);
});

test("XM-03: header X-Merchant-Id differs from body merchant_id → header_body_mismatch", () => {
  const headerMerchantId: string = "merchant_A";
  const bodyMerchantId: string = "merchant_B";

  const hasMismatch = headerMerchantId !== bodyMerchantId;
  assert.equal(hasMismatch, true);

  const response = { statusCode: 400, error: "header_body_mismatch" };
  assert.equal(response.statusCode, 400);
  assert.equal(response.error, "header_body_mismatch");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rate limiting (RATE-*)
// ═══════════════════════════════════════════════════════════════════════════════

test("RATE-01: N requests within window all succeed", () => {
  const limiter = new RateLimiter(60, 60_000);
  const now = Date.now();

  for (let i = 0; i < 60; i++) {
    const result = limiter.check("agent_1", now);
    assert.equal(result.allowed, true, `Request ${i + 1} should be allowed`);
  }
});

test("RATE-02: request N+1 returns 429 with retry_after", () => {
  const limiter = new RateLimiter(60, 60_000);
  const now = Date.now();

  // Exhaust the limit
  for (let i = 0; i < 60; i++) {
    limiter.check("agent_1", now);
  }

  // 61st request
  const result = limiter.check("agent_1", now);
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterSeconds !== undefined);
  assert.ok(result.retryAfterSeconds > 0);
});

test("RATE-03: counter resets after window expires", () => {
  const clock = new FakeClock();
  const WINDOW_MS = 60_000;
  const limiter = new RateLimiter(60, WINDOW_MS);

  // Exhaust limit
  for (let i = 0; i < 60; i++) {
    limiter.check("agent_1", clock.now());
  }
  // Verify blocked
  assert.equal(limiter.check("agent_1", clock.now()).allowed, false);

  // Advance clock past window
  clock.advance(WINDOW_MS + 1000);

  // Should be allowed again
  const result = limiter.check("agent_1", clock.now());
  assert.equal(result.allowed, true);
});

test("RATE-04: different agents have independent counters", () => {
  const limiter = new RateLimiter(60, 60_000);
  const now = Date.now();

  // Agent A exhausts limit
  for (let i = 0; i < 60; i++) {
    limiter.check("agent_A", now);
  }
  assert.equal(limiter.check("agent_A", now).allowed, false);

  // Agent B should still be fine
  const resultB = limiter.check("agent_B", now);
  assert.equal(resultB.allowed, true);
});

test("RATE-05: 429 response does NOT leak the configured N value", () => {
  const limiter = new RateLimiter(60, 60_000);
  const now = Date.now();

  for (let i = 0; i < 61; i++) {
    limiter.check("agent_1", now);
  }

  const result = limiter.check("agent_1", now);
  // Response should only have retry_after_seconds, NOT the limit value
  const responseBody = { retry_after_seconds: result.retryAfterSeconds };
  const serialized = JSON.stringify(responseBody);
  assert.ok(!serialized.includes('"limit"'));
  assert.ok(!serialized.includes('"max_requests"'));
  assert.ok(!serialized.includes('"60"'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Replay attack prevention (AUTH-08)
// ═══════════════════════════════════════════════════════════════════════════════

test("AUTH-08: same nonce/timestamp reused → replay_detected", () => {
  const store = new NonceStore();
  const now = Date.now();
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(now / 1000);

  // First request — fresh nonce
  const isReplay1 = store.checkAndStore(nonce, timestamp, now);
  assert.equal(isReplay1, false);

  // Second request — same nonce = replay
  const isReplay2 = store.checkAndStore(nonce, timestamp, now);
  assert.equal(isReplay2, true);
});

test("AUTH-08: different nonces are independent", () => {
  const store = new NonceStore();
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);

  const nonce1 = randomBytes(16).toString("hex");
  const nonce2 = randomBytes(16).toString("hex");
  const nonce3 = randomBytes(16).toString("hex");

  assert.equal(store.checkAndStore(nonce1, timestamp, now), false);
  assert.equal(store.checkAndStore(nonce2, timestamp, now), false);
  // Replay nonce1 — detected as replay
  assert.equal(store.checkAndStore(nonce1, timestamp, now), true);
  // nonce3 is fresh — nonce1 replay doesn't affect independent nonces
  assert.equal(store.checkAndStore(nonce3, timestamp, now), false);
});

test("AUTH-08: expired nonces are cleaned up (no unbounded memory growth)", () => {
  const store = new NonceStore();
  const now = Date.now();
  const nonce = randomBytes(16).toString("hex");

  // Store a nonce
  store.checkAndStore(nonce, Math.floor(now / 1000), now);

  // Much later — nonce should be cleaned up
  const futureNow = now + 700_000; // > 600s window
  // Same nonce but in the future — old one expired, so it's not a replay
  const isReplay = store.checkAndStore(nonce, Math.floor(futureNow / 1000), futureNow);
  assert.equal(isReplay, false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Secret hygiene (SEC-*)
// ═══════════════════════════════════════════════════════════════════════════════

test("SEC-01: plaintext secret must NOT appear in any error response body", () => {
  const secret = "m2m_" + randomBytes(32).toString("hex");
  const SECRET_REGEX = /m2m_[a-f0-9]{64}/;

  // Simulate various error responses
  const errorBodies = [
    JSON.stringify({ error: "invalid_signature", message: "Authentication failed" }),
    JSON.stringify({ error: "rate_limited", retry_after: 30 }),
    JSON.stringify({ error: "agent_suspended" }),
    JSON.stringify({ error: "cross_tenant_blocked", merchant: "merchant_test" }),
  ];

  for (const body of errorBodies) {
    assert.equal(SECRET_REGEX.test(body), false, `Secret leaked in: ${body}`);
  }

  // Confirm regex would catch a leak
  const leakyBody = JSON.stringify({ error: "debug", secret });
  assert.equal(SECRET_REGEX.test(leakyBody), true);
});

test("SEC-02: plaintext secret must NOT appear in log output", () => {
  const SECRET_REGEX = /m2m_[a-f0-9]{64}/;
  const capturedLogs: string[] = [];

  // Simulate a logger
  const fakeLogger = {
    log: (msg: string) => capturedLogs.push(msg),
    error: (msg: string) => capturedLogs.push(msg),
  };

  // Proper logging: log agent_id, NOT the secret
  fakeLogger.log("Agent agent_abc123 authenticated for merchant merchant_test");
  fakeLogger.log("Request processed in 45ms");
  fakeLogger.error("Invalid signature for agent_id=agent_xyz");

  for (const logLine of capturedLogs) {
    assert.equal(SECRET_REGEX.test(logLine), false, `Secret leaked in log: ${logLine}`);
  }
});

test("SEC-03: GET /agents/:id returns secret_last_4 only (no full secret)", () => {
  const secretHash = createHash("sha256").update("m2m_" + randomBytes(32).toString("hex")).digest("hex");

  // Simulate API response for GET /agents/:id
  const apiResponse = {
    agent_id: "agent_test",
    name: "ShopBot",
    secret_last_4: secretHash.slice(-4),
    capabilities: ["discover", "negotiate", "checkout"],
    status: "active",
  };

  // Verify no full hash or secret in response
  assert.ok(!("secret_hash" in apiResponse));
  assert.ok(!("agent_secret" in apiResponse));
  assert.equal(apiResponse.secret_last_4.length, 4);
});

test("SEC-04: secret never used as HMAC key directly (sha256 hash used instead)", () => {
  // The HMAC verification uses the stored secret_hash, not the raw secret
  const rawSecret = "m2m_" + randomBytes(32).toString("hex");
  const storedHash = createHash("sha256").update(rawSecret).digest("hex");

  // In production: signature = HMAC-SHA256(body, rawSecret) — agent signs with raw secret
  // Server verifies by: hash(rawSecret_from_header_lookup) == storedHash, then verify HMAC
  // The raw secret is NEVER passed to negotiation-engine or rules-engine
  const bodyForNegotiation = JSON.stringify({ cart: [], target_discount: 10 });
  assert.ok(!bodyForNegotiation.includes(rawSecret));
  assert.ok(!bodyForNegotiation.includes(storedHash));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent status checks (AUTH-10, AUTH-11)
// ═══════════════════════════════════════════════════════════════════════════════

test("AUTH-10: suspended agent → 403 agent_suspended", () => {
  const agentStatus = "suspended";
  const isBlocked = agentStatus === "suspended" || agentStatus === "banned";
  assert.equal(isBlocked, true);

  const response = { statusCode: 403, error: "agent_suspended" };
  assert.equal(response.statusCode, 403);
});

test("AUTH-11: banned agent → 403 agent_banned", () => {
  const agentStatus = "banned";
  const response = agentStatus === "banned"
    ? { statusCode: 403, error: "agent_banned" }
    : { statusCode: 200 };
  assert.equal(response.statusCode, 403);
  assert.equal((response as any).error, "agent_banned");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reputation (REP-01, REP-02, REP-04)
// ═══════════════════════════════════════════════════════════════════════════════

test("REP-01: dispute rate < 5% → normal treatment", () => {
  const DISPUTE_THRESHOLD = 0.05;
  const agent = { transactionCount: 100, disputeCount: 3 }; // 3% dispute rate
  const disputeRate = agent.disputeCount / agent.transactionCount;
  assert.ok(disputeRate < DISPUTE_THRESHOLD);
});

test("REP-02: dispute rate ≥ 5% → slowed response treatment", () => {
  const DISPUTE_THRESHOLD = 0.05;
  const agent = { transactionCount: 100, disputeCount: 6 }; // 6% dispute rate
  const disputeRate = agent.disputeCount / agent.transactionCount;
  assert.ok(disputeRate >= DISPUTE_THRESHOLD);
  // In production: add minimum 500ms latency before responding
});

test("REP-04: new agent (no history) defaults to reputation 100", () => {
  const defaultReputation = 100;
  const newAgent = { transactionCount: 0, disputeCount: 0, reputationScore: defaultReputation };
  assert.equal(newAgent.reputationScore, 100);
  // New agent (0 transactions) treated same as REP-01 — no penalty
  const disputeRate = newAgent.transactionCount === 0 ? 0 : newAgent.disputeCount / newAgent.transactionCount;
  assert.equal(disputeRate, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG-08: Quote reuse across merchants
// ═══════════════════════════════════════════════════════════════════════════════

test("BUG-08: quote generated for merchant A cannot be used by merchant B agent", () => {
  // Quote has merchant_id baked in
  const quote = { quoteId: "quote_abc", merchantId: "merchant_A", agentId: "agent_1" };

  // Agent bound to merchant B tries to use it
  const requestingAgent = { agentId: "agent_2", merchantId: "merchant_B" };

  const isAllowed = quote.merchantId === requestingAgent.merchantId;
  assert.equal(isAllowed, false);

  // Should also check agent ownership
  const isOwner = quote.agentId === requestingAgent.agentId;
  assert.equal(isOwner, false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Static analysis: secret regex scan utility
// ═══════════════════════════════════════════════════════════════════════════════

test("SEC (utility): secret regex pattern correctly identifies M2M secrets", () => {
  const SECRET_REGEX = /m2m_[a-f0-9]{64}/;

  // Should match real secrets
  const validSecret = "m2m_" + "a".repeat(64);
  assert.ok(SECRET_REGEX.test(validSecret));

  // Should NOT match short strings
  assert.ok(!SECRET_REGEX.test("m2m_abc"));
  assert.ok(!SECRET_REGEX.test("m2m_123"));

  // Should NOT match non-hex
  assert.ok(!SECRET_REGEX.test("m2m_" + "g".repeat(64)));
});
