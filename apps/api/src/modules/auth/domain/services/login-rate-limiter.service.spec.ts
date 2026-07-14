import test from "node:test";
import assert from "node:assert/strict";
import { LoginRateLimiter } from "./login-rate-limiter.service.js";
import { LoginRateLimitedError } from "../errors.js";

test("LoginRateLimiter blocks the sixth failed attempt per ip+email in the window (B2 P1 regression)", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, 20);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  for (let index = 0; index < 5; index += 1) {
    limiter.assertAllowed(scope, 1000);
    limiter.recordFailure(scope, 1000);
  }

  assert.throws(() => limiter.assertAllowed(scope, 1000), LoginRateLimitedError);
  // B2 (P1): Different email on same IP must NOT be blocked.
  assert.doesNotThrow(() => limiter.assertAllowed({ ip: "127.0.0.1", email: "other@example.com" }, 1000));
  // Window expiry clears the block.
  assert.doesNotThrow(() => limiter.assertAllowed(scope, 1000 + 15 * 60 * 1000 + 1));
});

test("LoginRateLimiter clears failures after a successful login", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, 20);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  limiter.recordFailure(scope, 1000);
  limiter.recordSuccess(scope);
  assert.equal(limiter.remaining(scope, 1000), 5);
});

// B2 (P1) regression: The scope key must NOT contain a client-controlled header.
test("LoginRateLimiter is not bypassable by rotating email-like scopes (B2 P1 regression)", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, 20);
  const ip = "10.0.0.1";
  const email = "victim@example.com";

  // Exhaust the limit for ip+email.
  for (let index = 0; index < 5; index += 1) {
    limiter.recordFailure({ ip, email }, 1000);
  }
  // Same IP, same email: blocked.
  assert.throws(() => limiter.assertAllowed({ ip, email }, 1000), LoginRateLimitedError);
  // Same IP, different email: NOT blocked (different credential, different bucket).
  assert.doesNotThrow(() => limiter.assertAllowed({ ip, email: "unrelated@example.com" }, 1000));
});

// M8: Per-IP throttle — blocks across all emails when IP exceeds global limit
test("LoginRateLimiter per-IP throttle blocks rotation attacks", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, 3); // 3 per IP
  const ip = "attacker-ip";

  // Different emails, same IP — should hit per-IP limit
  limiter.recordFailure({ ip, email: "a@example.com" }, 1000);
  limiter.recordFailure({ ip, email: "b@example.com" }, 1000);
  limiter.recordFailure({ ip, email: "c@example.com" }, 1000);

  // Now any email from this IP is blocked
  assert.throws(
    () => limiter.assertAllowed({ ip, email: "d@example.com" }, 1000),
    LoginRateLimitedError
  );
});

// M10: retryAfterMs returns remaining window time
test("LoginRateLimiter retryAfterMs returns remaining time for active bucket", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000, 20);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  assert.equal(limiter.retryAfterMs(scope, 1000), undefined);

  limiter.recordFailure(scope, 1000);
  const retry = limiter.retryAfterMs(scope, 2000);
  assert.ok(retry !== undefined && retry > 0, "retryAfterMs should return positive value");
});

// C4: Eviction
test("LoginRateLimiter evicts expired buckets to prevent memory leaks (C4)", () => {
  const limiter = new LoginRateLimiter(5, 1000, 20);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  limiter.recordFailure(scope, 1000);
  // After window expires
  const evicted = limiter.evictExpired(5000);
  assert.ok(evicted >= 1, "should evict at least one expired bucket");
});

// L3: Validates env var parsing
test("LoginRateLimiter throws on invalid config values (L3)", () => {
  assert.throws(() => new LoginRateLimiter(NaN, 1000, 5), /must be a positive integer/);
  assert.throws(() => new LoginRateLimiter(5, 500, 5), /must be at least 1000/);
});

// H8: LoginRateLimitedError includes retryAfterMs
test("LoginRateLimitedError includes retryAfterMs for Retry-After header", () => {
  const limiter = new LoginRateLimiter(1, 60000, 20);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  limiter.recordFailure(scope, 1000);

  try {
    limiter.assertAllowed(scope, 1000);
    assert.fail("Should throw");
  } catch (err) {
    assert(err instanceof LoginRateLimitedError);
    assert.ok(err.retryAfterMs > 0, "retryAfterMs should be positive");
  }
});
