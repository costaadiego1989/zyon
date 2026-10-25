import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { authenticator, b64, origin, rpId } from "./webauthn-fixture.js";
import { WebAuthnVerifierService } from "../domain/services/webauthn-verifier.service.js";

const verifier = new WebAuthnVerifierService({ rpId, origin });
test("Browser-format COSE key and DER ES256 signature authenticate", async () => {
  const device = authenticator();
  assert.deepEqual(await verifier.verifyAssertion(device.assertion(b64(randomBytes(32)))), { ok: true, newCounter: 1 });
});
for (const [name, options] of Object.entries({
  "wrong origin": { origin: "https://evil.example.com" },
  "wrong RP": { rp: "evil.example.com" },
  "wrong ceremony": { type: "webauthn.create" },
  "missing UV": { flags: 1 },
  "missing presence": { flags: 4 },
})) test("Reject assertion: " + name, async () => {
  assert.equal((await verifier.verifyAssertion(authenticator().assertion(b64(randomBytes(32)), 1, options))).ok, false);
});
test("Signed challenge mismatch and tampered signature are rejected", async () => {
  const assertion = authenticator().assertion(b64(randomBytes(32)));
  assert.equal((await verifier.verifyAssertion({ ...assertion, challenge: randomBytes(32) })).ok, false);
  assertion.signature[8] ^= 1;
  assert.equal((await verifier.verifyAssertion(assertion)).ok, false);
});
test("Counter replay is rejected, synced passkeys with zero counters work", async () => {
  const device = authenticator();
  const challenge = b64(randomBytes(32));
  assert.equal((await verifier.verifyAssertion({ ...device.assertion(challenge), storedCounter: 1 })).ok, false);
  assert.equal((await verifier.verifyAssertion(device.assertion(challenge, 0))).ok, true);
});
for (const [name, options] of Object.entries({
  "wrong origin": { origin: "https://evil.example.com" },
  "wrong RP": { rp: "evil.example.com" },
  "wrong ceremony": { type: "webauthn.get" },
  "missing UV": { flags: 0x41 },
  "missing presence": { flags: 0x44 },
})) test("Reject registration: " + name, async () => {
  const challenge = b64(randomBytes(32));
  await assert.rejects(() => verifier.verifyRegistration(challenge, authenticator().registration(challenge, options)));
});
test("Attestation credential ID must match the external ID and signed challenge", async () => {
  const challenge = b64(randomBytes(32));
  const response = authenticator().registration(challenge);
  await assert.rejects(() => verifier.verifyRegistration(b64(randomBytes(32)), response));
  // The ceremony also verifies the external ID against the attested key ID.
  const wrongId = b64(randomBytes(32));
  await assert.rejects(() => verifier.verifyRegistration(challenge, { ...response, id: wrongId, rawId: wrongId }));
});
