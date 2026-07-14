import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";

test("WebAuthnChallengeService.issue returns base64url challenge of 32 random bytes", () => {
  const svc = new WebAuthnChallengeService();

  const a = svc.issue("scope-A");
  const b = svc.issue("scope-B");

  assert.ok(/^[A-Za-z0-9_-]+$/.test(a.challenge), "challenge must be base64url");
  assert.equal(a.scopeKey, "scope-A");
  assert.equal(b.scopeKey, "scope-B");
  // 32 bytes -> base64url length = 43 chars (without padding)
  assert.equal(a.challenge.length, 43);
  assert.notEqual(a.challenge, b.challenge, "challenges must be random per scope");
});

test("WebAuthnChallengeService.consume removes the challenge so it cannot be reused", () => {
  const svc = new WebAuthnChallengeService();

  const issued = svc.issue("buyer_1");
  const first = svc.consume(issued.challenge, "buyer_1");
  const second = svc.consume(issued.challenge, "buyer_1");

  assert.ok(first, "challenge must be valid on first consume");
  assert.equal(first!.challenge, issued.challenge);
  assert.equal(second, null, "single-use: same challenge cannot be consumed twice");
});

test("WebAuthnChallengeService.consume returns null for unknown challenge", () => {
  const svc = new WebAuthnChallengeService();
  assert.equal(svc.consume("nope", "buyer_1"), null);
});

test("WebAuthnChallengeService.consume returns null when challenge has expired (>5 min)", () => {
  const svc = new WebAuthnChallengeService();
  const issued = svc.issue("buyer_1", -1_000); // pretend issued 1s in the past
  // Force expiry by using a clock that is 6 minutes ahead
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;
  try {
    assert.equal(svc.consume(issued.challenge, "buyer_1"), null);
  } finally {
    Date.now = originalNow;
  }
});

test("WebAuthnChallengeService.issues are scoped (different scopes cannot cross-consume)", () => {
  const svc = new WebAuthnChallengeService();
  const issued = svc.issue("buyer_A");

  // Same challenge but consumer is in a different scope -> must reject
  assert.equal(svc.consume(issued.challenge, "buyer_B"), null);
  // Sanity: original scope still valid
  assert.ok(svc.consume(issued.challenge, "buyer_A"));
});
