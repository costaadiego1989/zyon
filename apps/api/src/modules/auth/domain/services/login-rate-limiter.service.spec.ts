import test from "node:test";
import assert from "node:assert/strict";
import { HttpException } from "@nestjs/common";
import { LoginRateLimiter } from "./login-rate-limiter.service.js";

test("LoginRateLimiter blocks the sixth failed attempt per ip and device in the window", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const scope = { ip: "127.0.0.1", deviceId: "device-1" };
  for (let index = 0; index < 5; index += 1) {
    limiter.assertAllowed(scope, 1000);
    limiter.recordFailure(scope, 1000);
  }

  assert.throws(() => limiter.assertAllowed(scope, 1000), HttpException);
  assert.doesNotThrow(() => limiter.assertAllowed({ ip: "127.0.0.1", deviceId: "device-2" }, 1000));
  assert.doesNotThrow(() => limiter.assertAllowed(scope, 1000 + 15 * 60 * 1000 + 1));
});

test("LoginRateLimiter clears failures after a successful login", () => {
  const limiter = new LoginRateLimiter(5, 15 * 60 * 1000);
  const scope = { ip: "127.0.0.1", deviceId: "device-1" };
  limiter.recordFailure(scope, 1000);
  limiter.recordSuccess(scope);
  assert.equal(limiter.remaining(scope, 1000), 5);
});
