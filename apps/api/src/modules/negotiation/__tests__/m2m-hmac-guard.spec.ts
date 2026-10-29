import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { M2mHmacVerifier } from "../domain/services/m2m-hmac-verifier.service.js";

describe("M2mHmacVerifier", () => {
  const verifier = new M2mHmacVerifier();
  const secret = "hmac_test_secret_1234567890abcdef";
  const body = '{"cart":{"total":100},"payment_method":"pix"}';
  const now = () => String(Math.floor(Date.now() / 1000));

  it("sign produces sha256= prefixed hex digest", () => {
    const sig = verifier.sign(secret, now(), body);
    assert.ok(sig.startsWith("sha256="));
    assert.equal(sig.length, 7 + 64); // "sha256=" (7) + 64 hex chars
  });

  it("verify accepts valid signature", () => {
    const ts = now();
    const sig = verifier.sign(secret, ts, body);
    const result = verifier.verify(secret, ts, body, sig);
    assert.equal(result.valid, true);
    assert.equal(result.error, undefined);
  });

  it("verify rejects tampered body", () => {
    const ts = now();
    const sig = verifier.sign(secret, ts, body);
    const result = verifier.verify(secret, ts, body + "x", sig);
    assert.equal(result.valid, false);
    assert.equal(result.error, "invalid_signature");
  });

  it("verify rejects wrong secret", () => {
    const ts = now();
    const sig = verifier.sign(secret, ts, body);
    const result = verifier.verify("wrong_secret", ts, body, sig);
    assert.equal(result.valid, false);
    assert.equal(result.error, "invalid_signature");
  });

  it("verify rejects missing signature", () => {
    const result = verifier.verify(secret, now(), body, "");
    assert.equal(result.valid, false);
    assert.equal(result.error, "missing_signature");
  });

  it("verify rejects signature without sha256= prefix", () => {
    const ts = now();
    const sig = verifier.sign(secret, ts, body);
    const result = verifier.verify(secret, ts, body, sig.replace("sha256=", "md5="));
    assert.equal(result.valid, false);
    assert.equal(result.error, "invalid_signature");
  });

  it("verify rejects expired timestamp (>300s old)", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 400);
    const sig = verifier.sign(secret, oldTs, body);
    const result = verifier.verify(secret, oldTs, body, sig);
    assert.equal(result.valid, false);
    assert.equal(result.error, "timestamp_outside_window");
  });

  it("verify rejects future timestamp (>300s ahead)", () => {
    const futureTs = String(Math.floor(Date.now() / 1000) + 400);
    const sig = verifier.sign(secret, futureTs, body);
    const result = verifier.verify(secret, futureTs, body, sig);
    assert.equal(result.valid, false);
    assert.equal(result.error, "timestamp_outside_window");
  });

  it("verify accepts timestamp within window", () => {
    const recentTs = String(Math.floor(Date.now() / 1000) - 60);
    const sig = verifier.sign(secret, recentTs, body);
    const result = verifier.verify(secret, recentTs, body, sig);
    assert.equal(result.valid, true);
  });

  it("verify rejects non-numeric timestamp", () => {
    const result = verifier.verify(secret, "not-a-number", body, "sha256=abc");
    assert.equal(result.valid, false);
    assert.equal(result.error, "timestamp_outside_window");
  });
});
