import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { LoginRateLimiter } from "./login-rate-limiter.service.js";

test("LoginRateLimiter blocks the sixth failed attempt per ip+email in the window (B2 P1 regression)", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  for (let index = 0; index < 5; index += 1) {
    limiter.assertAllowed(scope, 1000);
    limiter.recordFailure(scope, 1000);
  }

  assert.throws(() => limiter.assertAllowed(scope, 1000), HttpException);
  // B2 (P1): Different email on same IP must NOT be blocked.
  assert.doesNotThrow(() => limiter.assertAllowed({ ip: "127.0.0.1", email: "other@example.com" }, 1000));
  // Window expiry clears the block.
  assert.doesNotThrow(() => limiter.assertAllowed(scope, 1000 + 15 * 60 * 1000 + 1));
});

test("LoginRateLimiter fails closed when Redis is declared required in production", (t) => {
  const previousEnv = process.env.NODE_ENV;
  const previousRedis = process.env.REDIS_ENABLED;
  t.after(() => {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousRedis === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = previousRedis;
  });
  process.env.NODE_ENV = "production";
  process.env.REDIS_ENABLED = "true";
  assert.throws(() => new LoginRateLimiter(), /redis_login_rate_limit_store_not_configured/);
});

test("LoginRateLimiter clears failures after a successful login", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const scope = { ip: "127.0.0.1", email: "user@example.com" };
  limiter.recordFailure(scope, 1000);
  limiter.recordSuccess(scope);
  assert.equal(limiter.remaining(scope, 1000), 5);
});

// B2 (P1) regression: The scope key must NOT contain a client-controlled header.
// Before the fix, the key was `${ip}:${deviceId}`, allowing bypass by rotating
// x-device-id. Verify that the key is now based on ip+email only.
test("LoginRateLimiter is not bypassable by rotating email-like scopes (B2 P1 regression)", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const ip = "10.0.0.1";
  const email = "victim@example.com";

  // Exhaust the limit for ip+email.
  for (let index = 0; index < 5; index += 1) {
    limiter.recordFailure({ ip, email }, 1000);
  }
  // Same IP, same email: blocked.
  assert.throws(() => limiter.assertAllowed({ ip, email }, 1000), HttpException);
  // Same IP, different email: NOT blocked (different credential, different bucket).
  assert.doesNotThrow(() => limiter.assertAllowed({ ip, email: "unrelated@example.com" }, 1000));
});
