import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";

test("WebAuthnChallengeService.issue returns base64url challenge of 32 random bytes", async () => {
  const svc = new WebAuthnChallengeService();

  const a = await svc.issue("scope-A");
  const b = await svc.issue("scope-B");

  assert.ok(/^[A-Za-z0-9_-]+$/.test(a.challenge), "challenge must be base64url");
  assert.equal(a.scopeKey, "scope-A");
  assert.equal(b.scopeKey, "scope-B");
  // 32 bytes -> base64url length = 43 chars (without padding)
  assert.equal(a.challenge.length, 43);
  assert.notEqual(a.challenge, b.challenge, "challenges must be random per scope");
});

test("WebAuthnChallengeService.consume removes the challenge so it cannot be reused", async () => {
  const svc = new WebAuthnChallengeService();

  const issued = await svc.issue("buyer_1");
  const first = await svc.consume(issued.challenge, "buyer_1");
  const second = await svc.consume(issued.challenge, "buyer_1");

  assert.ok(first, "challenge must be valid on first consume");
  assert.equal(first!.challenge, issued.challenge);
  assert.equal(second, null, "single-use: same challenge cannot be consumed twice");
});

test("WebAuthnChallengeService.consume returns null for unknown challenge", async () => {
  const svc = new WebAuthnChallengeService();
  assert.equal(await svc.consume("nope", "buyer_1"), null);
});

test("WebAuthnChallengeService.consume returns null when challenge has expired (>5 min)", async () => {
  const svc = new WebAuthnChallengeService();
  const issued = await svc.issue("buyer_1", -1_000); // pretend issued 1s in the past
  // Force expiry by using a clock that is 6 minutes ahead
  const originalNow = Date.now;
  Date.now = () => originalNow() + 6 * 60 * 1000;
  try {
    assert.equal(await svc.consume(issued.challenge, "buyer_1"), null);
  } finally {
    Date.now = originalNow;
  }
});

test("WebAuthnChallengeService.issues are scoped (different scopes cannot cross-consume)", async () => {
  const svc = new WebAuthnChallengeService();
  const issued = await svc.issue("buyer_A");

  // Same challenge but consumer is in a different scope -> must reject
  assert.equal(await svc.consume(issued.challenge, "buyer_B"), null);
  // Sanity: original scope still valid
  assert.ok(await svc.consume(issued.challenge, "buyer_A"));
});
