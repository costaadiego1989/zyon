import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnLoginOptionsUseCase } from "../application/use-cases/webauthn-login-options.use-case.js";
import { WebAuthnLoginVerifyUseCase } from "../application/use-cases/webauthn-login-verify.use-case.js";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";
import { WebAuthnVerifierService } from "../domain/services/webauthn-verifier.service.js";
import { InMemoryWebAuthnCredentialStore } from "../infrastructure/in-memory-webauthn-credential-store.js";
import { InMemoryBuyerAccountRepository } from "../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import { WebAuthnCredential } from "../domain/entities/webauthn-credential.entity.js";
import { PasswordHasher } from "../../auth/domain/services/password-hasher.service.js";
import { BuyerJwtService } from "../domain/services/buyer-jwt.service.js";

const RP_ID = "shop.example.com";
const ORIGIN = "https://shop.example.com";

async function setUpBuyer(buyer: InMemoryBuyerAccountRepository): Promise<BuyerAccount> {
  const passwordHash = await new PasswordHasher().hash("BuyerPass123!");
  const account = new BuyerAccount({
    globalUserId: "guser_1",
    email: "buyer@example.com",
    passwordHash,
    displayName: "Buyer Test",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  await buyer.save(account);
  return account;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64url");
}

test("WebAuthn login end-to-end flow: options -> verify -> JWT issued, counter incremented", async () => {
  const buyers = new InMemoryBuyerAccountRepository();
  const account = await setUpBuyer(buyers);
  const credStore = new InMemoryWebAuthnCredentialStore();
  const challenges = new WebAuthnChallengeService();

  // Pre-register a credential with a real ES256 public key.
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const credentialId = "Y3JlZF9sb2dpbjE";
  await credStore.save(
    new WebAuthnCredential({
      id: "cred_internal_login",
      credentialId,
      globalUserId: account.globalUserId,
      publicKey: rawPub,
      counter: 0,
      transports: ["internal"],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      lastUsedAt: null,
      aaguid: "00000000-0000-0000-0000-000000000000",
      origin: ORIGIN,
    })
  );

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const jwt = new BuyerJwtService("test-buyer-secret", 3600);
  const optionsUseCase = new WebAuthnLoginOptionsUseCase({ challengeService: challenges, credentialStore: credStore, rpId: RP_ID });
  const verifyUseCase = new WebAuthnLoginVerifyUseCase({
    verifier,
    challengeService: challenges,
    credentialStore: credStore,
    buyerRepo: buyers,
    jwt,
  });

  const opts = await optionsUseCase.execute({ email: "buyer@example.com" });
  assert.ok(opts.allowCredentials.length === 1);
  assert.equal(opts.allowCredentials[0].id, credentialId);

  // Authenticator behavior:
  const challengeBytes = new Uint8Array(Buffer.from(opts.challenge, "base64url"));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  // Counter must increment > 0
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = 1 | (1 << 2); // UP | UV
  authData[33] = 0; authData[34] = 0; authData[35] = 0; authData[36] = 1; // counter = 1
  const clientData = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin: ORIGIN })
  );
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, message as unknown as ArrayBuffer)
  );

  const verifyResult = await verifyUseCase.execute({
    challenge: challengeBytes,
    credential: {
      id: credentialId,
      rawId: credentialId,
      authenticatorData: Buffer.from(authData).toString("base64url"),
      clientDataJSON: Buffer.from(clientData).toString("base64url"),
      signature: base64UrlEncode(signature),
      type: "public-key",
    },
  });

  assert.ok(verifyResult.access_token);
  assert.equal(verifyResult.buyer_id, "guser_1");
  assert.equal(verifyResult.email, "buyer@example.com");

  // JWT must verify
  const principal = jwt.verify(verifyResult.access_token);
  assert.equal(principal.globalUserId, "guser_1");
  assert.equal(principal.email, "buyer@example.com");

  // Counter must be incremented in the credential store
  const stored = await credStore.findByCredentialId(credentialId);
  assert.equal(stored!.counter, 1);
});

test("WebAuthn login with no registered credentials for the email rejects the options call", async () => {
  const buyers = new InMemoryBuyerAccountRepository();
  const credStore = new InMemoryWebAuthnCredentialStore();
  const challenges = new WebAuthnChallengeService();
  const useCase = new WebAuthnLoginOptionsUseCase({ challengeService: challenges, credentialStore: credStore, rpId: RP_ID });
  await assert.rejects(
    () => useCase.execute({ email: "nobody@example.com" }),
    /no_registered_credentials/,
  );
});

test("WebAuthn login verify rejects an assertion that fails signature verification", async () => {
  const buyers = new InMemoryBuyerAccountRepository();
  const account = await setUpBuyer(buyers);
  const credStore = new InMemoryWebAuthnCredentialStore();
  const challenges = new WebAuthnChallengeService();

  // A *different* key pair from the one we'll use to sign; signature won't match.
  const registeredKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const registeredPub = new Uint8Array(await crypto.subtle.exportKey("raw", registeredKeyPair.publicKey));
  const rogueKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const credentialId = "Y3JlZF9zdGVhbA";
  await credStore.save(
    new WebAuthnCredential({
      id: "cred_rogue",
      credentialId,
      globalUserId: account.globalUserId,
      publicKey: registeredPub,
      counter: 0,
      transports: ["internal"],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      lastUsedAt: null,
      aaguid: "00000000-0000-0000-0000-000000000000",
      origin: ORIGIN,
    })
  );

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const jwt = new BuyerJwtService("test-buyer-secret", 3600);
  const optionsUseCase = new WebAuthnLoginOptionsUseCase({ challengeService: challenges, credentialStore: credStore, rpId: RP_ID });
  const verifyUseCase = new WebAuthnLoginVerifyUseCase({
    verifier,
    challengeService: challenges,
    credentialStore: credStore,
    buyerRepo: buyers,
    jwt,
  });

  const opts = await optionsUseCase.execute({ email: "buyer@example.com" });
  const challengeBytes = new Uint8Array(Buffer.from(opts.challenge, "base64url"));
  const rpIdHash = await sha256(new TextEncoder().encode(RP_ID));
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = 1 | (1 << 2);
  authData[36] = 1; // counter = 1
  const clientData = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin: ORIGIN })
  );
  const clientDataHash = await sha256(clientData);
  const message = new Uint8Array(authData.length + clientDataHash.length);
  message.set(authData, 0);
  message.set(clientDataHash, authData.length);
  // Sign with rogue key pair so signature won't match stored key
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, rogueKeyPair.privateKey, message)
  );

  await assert.rejects(
    () =>
      verifyUseCase.execute({
        challenge: challengeBytes,
        credential: {
          id: credentialId,
          rawId: credentialId,
          authenticatorData: Buffer.from(authData).toString("base64url"),
          clientDataJSON: Buffer.from(clientData).toString("base64url"),
          signature: base64UrlEncode(signature),
          type: "public-key",
        },
      }),
    /signature_verification_failed|rp_id_mismatch|origin_mismatch|user_verification_failed/,
  );
});
