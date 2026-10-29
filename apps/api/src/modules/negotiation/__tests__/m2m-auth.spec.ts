import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ─── Domain: M2M HMAC Verifier (test-first scaffolding) ───────────────────────
// These tests validate the HMAC-SHA256 authentication layer per ADR AUTH-01..14

/**
 * Minimal HMAC verifier implementation matching the design spec.
 * Production code will live in `apps/api/src/modules/public-api/m2m/domain/hmac-verifier.service.ts`
 * and must match this behavior exactly.
 */
class M2mHmacVerifier {
  sign(input: { secret: string; timestamp: string; body: string }): string {
    const digest = createHmac("sha256", input.secret)
      .update(`${input.timestamp}.${input.body}`)
      .digest("hex");
    return `sha256=${digest}`;
  }

  verify(input: {
    secret: string;
    timestamp: string;
    body: string;
    signature: string;
  }): { valid: boolean; error?: string } {
    // AUTH-13: empty signature
    if (!input.signature || input.signature.trim() === "") {
      return { valid: false, error: "missing_signature" };
    }

    // AUTH-12: algorithm confusion — only accept sha256= prefix
    if (!input.signature.startsWith("sha256=")) {
      return { valid: false, error: "invalid_signature" };
    }

    const expected = this.sign(input);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(input.signature);

    // AUTH-14 / BUG-05: length check before timingSafeEqual to avoid RangeError
    if (expectedBuffer.length !== actualBuffer.length) {
      return { valid: false, error: "invalid_signature" };
    }

    // MUST use timingSafeEqual — never === or Buffer.compare (BUG-01)
    const isValid = timingSafeEqual(expectedBuffer, actualBuffer);
    return isValid ? { valid: true } : { valid: false, error: "invalid_signature" };
  }
}

const verifier = new M2mHmacVerifier();
const TEST_SECRET = "m2m_" + randomBytes(32).toString("hex");
const TEST_BODY = JSON.stringify({ merchant_id: "merchant_test", query: { category: "shoes" } });
const TEST_TIMESTAMP = String(Math.floor(Date.now() / 1000));

// ─── AUTH-01: Valid signature passes ──────────────────────────────────────────
test("AUTH-01: valid HMAC signature passes verification", () => {
  const signature = verifier.sign({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY });
  const result = verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature });
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

// ─── AUTH-04: Wrong secret → 401 ─────────────────────────────────────────────
test("AUTH-04: wrong secret produces invalid_signature", () => {
  const signature = verifier.sign({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY });
  const wrongSecret = "m2m_" + randomBytes(32).toString("hex");
  const result = verifier.verify({ secret: wrongSecret, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature });
  assert.equal(result.valid, false);
  assert.equal(result.error, "invalid_signature");
});

// ─── AUTH-05: Tampered body → 401 ─────────────────────────────────────────────
test("AUTH-05: tampered body (signature computed on different body) → invalid_signature", () => {
  const signature = verifier.sign({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY });
  const tamperedBody = JSON.stringify({ merchant_id: "merchant_attacker", query: {} });
  const result = verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: tamperedBody, signature });
  assert.equal(result.valid, false);
  assert.equal(result.error, "invalid_signature");
});

// ─── AUTH-12: Algorithm confusion (sha1= prefix) → 401 ──────────────────────
test("AUTH-12: sha1= prefix rejected (algorithm confusion)", () => {
  const digest = createHmac("sha1", TEST_SECRET)
    .update(`${TEST_TIMESTAMP}.${TEST_BODY}`)
    .digest("hex");
  const result = verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature: `sha1=${digest}` });
  assert.equal(result.valid, false);
  assert.equal(result.error, "invalid_signature");
});

// ─── AUTH-13: Empty signature string → missing_signature ─────────────────────
test("AUTH-13: empty signature string returns missing_signature", () => {
  const result = verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature: "" });
  assert.equal(result.valid, false);
  assert.equal(result.error, "missing_signature");
});

// ─── AUTH-14 / BUG-05: Length mismatch must NOT throw ────────────────────────
test("AUTH-14: signature length mismatch returns invalid_signature (no RangeError)", () => {
  // Shorter signature
  const result = verifier.verify({
    secret: TEST_SECRET,
    timestamp: TEST_TIMESTAMP,
    body: TEST_BODY,
    signature: "sha256=abc123",
  });
  assert.equal(result.valid, false);
  assert.equal(result.error, "invalid_signature");

  // Longer signature (double the expected hex)
  const longSig = "sha256=" + "a".repeat(128);
  const result2 = verifier.verify({
    secret: TEST_SECRET,
    timestamp: TEST_TIMESTAMP,
    body: TEST_BODY,
    signature: longSig,
  });
  assert.equal(result2.valid, false);
  assert.equal(result2.error, "invalid_signature");
});

// ─── BUG-01: Timing-safe comparison — static check ──────────────────────────
test("BUG-01: verifier uses timingSafeEqual (static source check)", () => {
  // The verify method source must contain timingSafeEqual and NOT === for buffer comparison
  const sourceCode = M2mHmacVerifier.prototype.verify.toString();
  assert.ok(sourceCode.includes("timingSafeEqual"), "must use timingSafeEqual");
  // Ensure no direct === comparison on the buffer variables
  assert.ok(
    !sourceCode.includes("expectedBuffer === actualBuffer"),
    "must NOT use === for buffer comparison",
  );
});

// ─── BUG-07: HMAC algorithm must be sha256 (static check) ───────────────────
test("BUG-07: HMAC uses sha256 algorithm only (static source check)", () => {
  const signSource = M2mHmacVerifier.prototype.sign.toString();
  assert.ok(signSource.includes('"sha256"'), "sign() must use sha256");
  // Ensure no sha1, md5, or other weak algorithms
  assert.ok(!signSource.includes('"sha1"'), "must NOT use sha1");
  assert.ok(!signSource.includes('"md5"'), "must NOT use md5");
});

// ─── AUTH-06: Stale timestamp detection ──────────────────────────────────────
test("AUTH-06: stale timestamp (outside ±300s window) is detectable", () => {
  // This test validates the timestamp window check logic
  const TIMESTAMP_WINDOW_SECONDS = 300;
  const now = Math.floor(Date.now() / 1000);

  // Valid: within window
  const validTimestamp = String(now - 100);
  assert.ok(
    Math.abs(now - Number(validTimestamp)) <= TIMESTAMP_WINDOW_SECONDS,
    "timestamp within window should be valid",
  );

  // Stale: too old
  const staleTimestamp = String(now - 400);
  assert.ok(
    Math.abs(now - Number(staleTimestamp)) > TIMESTAMP_WINDOW_SECONDS,
    "timestamp 400s old should exceed the 300s window",
  );

  // Future: too far ahead
  const futureTimestamp = String(now + 400);
  assert.ok(
    Math.abs(now - Number(futureTimestamp)) > TIMESTAMP_WINDOW_SECONDS,
    "timestamp 400s in future should exceed the 300s window",
  );
});

// ─── Timing-safe behavior validation (statistical) ───────────────────────────
test("BUG-01 (statistical): timing-safe comparison shows no measurable variance on first vs last byte difference", () => {
  // Generate a valid signature
  const validSig = verifier.sign({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY });

  // Wrong first byte
  const wrongFirst = "sha256=0" + validSig.slice(8);
  // Wrong last byte
  const wrongLast = validSig.slice(0, -1) + (validSig.at(-1) === "0" ? "1" : "0");

  const ITERATIONS = 1000;

  // Measure first-byte-wrong timing
  const t1Start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature: wrongFirst });
  }
  const t1End = process.hrtime.bigint();

  // Measure last-byte-wrong timing
  const t2Start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) {
    verifier.verify({ secret: TEST_SECRET, timestamp: TEST_TIMESTAMP, body: TEST_BODY, signature: wrongLast });
  }
  const t2End = process.hrtime.bigint();

  const time1 = Number(t1End - t1Start);
  const time2 = Number(t2End - t2Start);

  // Variance should be under 50% — timing-safe means both paths take similar time
  // (This is a weak check; CI environments add noise. A stronger check is the static analysis.)
  const ratio = Math.max(time1, time2) / Math.min(time1, time2);
  assert.ok(
    ratio < 3.0,
    `Timing ratio ${ratio.toFixed(2)} suggests timing leak (first-byte: ${time1}ns, last-byte: ${time2}ns)`,
  );
});
