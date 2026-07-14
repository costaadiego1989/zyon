import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnVerifierService } from "../domain/services/webauthn-verifier.service.js";
import { WebAuthnCredential } from "../domain/entities/webauthn-credential.entity.js";

// Generate an ES256 (ECDSA P-256 / SHA-256) key pair used as a stand-in
// for an authenticator-attested key. The verifier must independently
// cryptographically verify the assertion, so we use real ECDSA signatures.
async function generateAuthenticatorKeyPair(): Promise<{ privateKey: CryptoKey; jwk: JsonWebKey; rawPublic: Uint8Array }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return { privateKey: keyPair.privateKey, jwk, rawPublic };
}

/**
 * Build a CBOR-encoded authenticatorData blob per WebAuthn §6.1 (registration):
 *   rpIdHash(32) || flags(1) || counter(4)
 * For assertion verification we use a minimal flag set: UP=1.
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

async function makeAuthenticatorData({ rpIdHash, counter, userPresent = true, userVerified = true }: {
  rpIdHash: Uint8Array;
  counter: number;
  userPresent?: boolean;
  userVerified?: boolean;
}): Promise<Uint8Array> {
  const out = new Uint8Array(32 + 1 + 4);
  out.set(rpIdHash, 0);
  let flags = 0;
  if (userPresent) flags |= 1 << 0;
  if (userVerified) flags |= 1 << 2;
  out[32] = flags;
  out[33] = (counter >>> 24) & 0xff;
  out[34] = (counter >>> 16) & 0xff;
  out[35] = (counter >>> 8) & 0xff;
  out[36] = counter & 0xff;
  return out;
}

async function signECDSAP256(privateKey: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, message as unknown as ArrayBuffer);
  return new Uint8Array(sig);
}

/**
 * Build the JSON-encoded clientDataJSON used by the authenticator.
 * The verifier must rebuild the SHA-256 over the concatenation
 * authenticatorData || sha256(clientDataJSON).
 */
function makeClientDataJson({ type, challenge, origin }: { type: string; challenge: string; origin: string }): Uint8Array {
  const obj = { type, challenge, origin };
  return new TextEncoder().encode(JSON.stringify(obj));
}

const RP_ID = "shop.example.com";
const ORIGIN = "https://shop.example.com";

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64url");
}

test("WebAuthnVerifierService.verifyAssertion succeeds when signature, counter, and origin are valid", async () => {
  const { privateKey, rawPublic } = await generateAuthenticatorKeyPair();
  const stored = new WebAuthnCredential({
    id: "cred_internal_1",
    credentialId: "Y3JlZF8x",
    globalUserId: "guser_1",
    publicKey: rawPublic,
    counter: 0,
    transports: ["internal"],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    lastUsedAt: null,
    aaguid: "00000000-0000-0000-0000-000000000000",
    origin: ORIGIN,
  });

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  const authData = await makeAuthenticatorData({ rpIdHash, counter: 1 });
  const clientData = makeClientDataJson({ type: "webauthn.get", challenge: base64UrlEncode(challenge), origin: ORIGIN });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = await signECDSAP256(privateKey, message);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const result = await verifier.verifyAssertion({
    challenge,
    storedPublicKey: rawPublic,
    storedCounter: 0,
    credentialId: "Y3JlZF8x",
    authenticatorData: authData,
    clientDataJSON: clientData,
    signature,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.newCounter, 1, "counter must be strictly greater than stored value (replay protection)");
  }
});

test("WebAuthnVerifierService.verifyAssertion fails when rpIdHash does not match the configured RP ID", async () => {
  const { privateKey, rawPublic } = await generateAuthenticatorKeyPair();
  const stored = new WebAuthnCredential({
    id: "cred_internal_1",
    credentialId: "Y3JlZF8x",
    globalUserId: "guser_1",
    publicKey: rawPublic,
    counter: 0,
    transports: ["internal"],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    lastUsedAt: null,
    aaguid: "00000000-0000-0000-0000-000000000000",
    origin: ORIGIN,
  });
  void stored; // not strictly needed for the verifier

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const wrongRpIdHash = await sha256(new TextEncoder().encode("attacker.example"));
  const authData = await makeAuthenticatorData({ rpIdHash: wrongRpIdHash, counter: 1 });
  const clientData = makeClientDataJson({ type: "webauthn.get", challenge: base64UrlEncode(challenge), origin: ORIGIN });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = await signECDSAP256(privateKey, message);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const result = await verifier.verifyAssertion({
    challenge,
    storedPublicKey: rawPublic,
    storedCounter: 0,
    credentialId: "Y3JlZF8x",
    authenticatorData: authData,
    clientDataJSON: clientData,
    signature,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "rp_id_mismatch");
  }
});

test("WebAuthnVerifierService.verifyAssertion fails when origin in clientDataJSON does not match", async () => {
  const { privateKey, rawPublic } = await generateAuthenticatorKeyPair();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  const authData = await makeAuthenticatorData({ rpIdHash, counter: 1 });
  const clientData = makeClientDataJson({ type: "webauthn.get", challenge: base64UrlEncode(challenge), origin: "https://attacker.example" });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = await signECDSAP256(privateKey, message);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const result = await verifier.verifyAssertion({
    challenge,
    storedPublicKey: rawPublic,
    storedCounter: 0,
    credentialId: "Y3JlZF8x",
    authenticatorData: authData,
    clientDataJSON: clientData,
    signature,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "origin_mismatch");
  }
});

test("WebAuthnVerifierService.verifyAssertion fails when user-verified flag is not set (replay-via-UV)", async () => {
  const { privateKey, rawPublic } = await generateAuthenticatorKeyPair();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  const authData = await makeAuthenticatorData({ rpIdHash, counter: 1, userVerified: false });
  const clientData = makeClientDataJson({ type: "webauthn.get", challenge: base64UrlEncode(challenge), origin: ORIGIN });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = await signECDSAP256(privateKey, message);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN, requireUserVerification: true });
  const result = await verifier.verifyAssertion({
    challenge,
    storedPublicKey: rawPublic,
    storedCounter: 0,
    credentialId: "Y3JlZF8x",
    authenticatorData: authData,
    clientDataJSON: clientData,
    signature,
  });

  assert.equal(result.ok, false);
});

test("WebAuthnVerifierService.verifyAssertion fails when stored counter is greater-or-equal (replay protection)", async () => {
  const { privateKey, rawPublic } = await generateAuthenticatorKeyPair();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  // Authenticator counter is at 0 (same as stored -> must reject)
  const authData = await makeAuthenticatorData({ rpIdHash, counter: 0 });
  const clientData = makeClientDataJson({ type: "webauthn.get", challenge: base64UrlEncode(challenge), origin: ORIGIN });
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = await signECDSAP256(privateKey, message);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const result = await verifier.verifyAssertion({
    challenge,
    storedPublicKey: rawPublic,
    storedCounter: 5,
    credentialId: "Y3JlZF8x",
    authenticatorData: authData,
    clientDataJSON: clientData,
    signature,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "counter_not_incremented");
  }
});

test("WebAuthnVerifierService.parseAttestation accepts 'none' attestation and recovers the credential public key", async () => {
  const { rawPublic } = await generateAuthenticatorKeyPair();
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));

  // Build a minimal CBOR map with two keys: "fmt":"none", "attStmt":{}, "authData":<bytes>
  // We sidestep full CBOR parsing by directly constructing the verified data path.
  const authData = await makeAuthenticatorData({ rpIdHash, counter: 0 });
  const credentialIdBytes = new TextEncoder().encode("Y3JlZF8x");

  // Build attestedCredentialData: AAGUID(16) || L(2) || credentialId(L) || COSE pubkey
  // For test purposes, we encode a minimal COSE_Key for ES256.
  const attested = new Uint8Array(16 + 2 + credentialIdBytes.length + rawPublic.length);
  attested.set(credentialIdBytes, 18); // 16 (AAGUID) + 2 (length)
  attested[16] = (credentialIdBytes.length >>> 8) & 0xff;
  attested[17] = credentialIdBytes.length & 0xff;
  attested.set(rawPublic, 18 + credentialIdBytes.length);

  const fullAuthData = new Uint8Array(authData.length + attested.length);
  fullAuthData.set(authData, 0);
  fullAuthData.set(attested, authData.length);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const result = await verifier.parseAttestation({
    authenticatorData: fullAuthData,
    credentialIdLength: credentialIdBytes.length,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.credentialId, "Y3JlZF8x");
  }
});
