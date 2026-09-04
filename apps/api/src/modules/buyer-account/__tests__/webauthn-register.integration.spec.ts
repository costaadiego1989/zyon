import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnRegisterOptionsUseCase } from "../application/use-cases/webauthn-register-options.use-case.js";
import { WebAuthnRegisterVerifyUseCase } from "../application/use-cases/webauthn-register-verify.use-case.js";
import { WebAuthnChallengeService } from "../domain/services/webauthn-challenge.service.js";
import { WebAuthnVerifierService } from "../domain/services/webauthn-verifier.service.js";
import { InMemoryWebAuthnCredentialStore } from "../infrastructure/in-memory-webauthn-credential-store.js";
import { InMemoryBuyerAccountRepository } from "../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import { PasswordHasher } from "../../auth/domain/services/password-hasher.service.js";

const RP_ID = "shop.example.com";
const ORIGIN = "https://shop.example.com";

async function setUpBuyer(buyer: InMemoryBuyerAccountRepository): Promise<void> {
  const passwordHash = await new PasswordHasher().hash("BuyerPass123!");
  await buyer.save(new BuyerAccount({
    globalUserId: "guser_1",
    email: "buyer@example.com",
    passwordHash,
    displayName: "Buyer Test",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  }));
}

test("WebAuthnRegisterOptionsUseCase returns a challenge, RP metadata, and user descriptor", async () => {
  const challenges = new WebAuthnChallengeService();
  const buyers = new InMemoryBuyerAccountRepository();
  await setUpBuyer(buyers);

  const useCase = new WebAuthnRegisterOptionsUseCase(challenges, { rpId: RP_ID, rpName: "Zyon Shop" }, buyers);

  const options = await useCase.execute({ buyer_id: "guser_1" });

  assert.equal(options.rp.id, RP_ID);
  assert.equal(options.rp.name, "Zyon Shop");
  assert.equal(options.user.id, "guser_1");
  assert.equal(options.user.name, "buyer@example.com");
  assert.equal(options.user.displayName, "Buyer Test");
  assert.equal(options.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(options.authenticatorSelection.userVerification, "required");
  assert.ok(typeof options.challenge === "string" && options.challenge.length > 0);
});

test("WebAuthnRegisterOptionsUseCase rejects unknown buyer", async () => {
  const challenges = new WebAuthnChallengeService();
  const buyers = new InMemoryBuyerAccountRepository();
  const useCase = new WebAuthnRegisterOptionsUseCase(challenges, { rpId: RP_ID, rpName: "Zyon Shop" }, buyers);

  await assert.rejects(
    () => useCase.execute({ buyer_id: "missing" }),
    /buyer_account_not_found/,
  );
});

test("WebAuthn end-to-end registration flow: options -> verify -> credential stored + counter=0", async () => {
  const challenges = new WebAuthnChallengeService();
  const credStore = new InMemoryWebAuthnCredentialStore();
  const buyers = new InMemoryBuyerAccountRepository();
  await setUpBuyer(buyers);

  const verifier = new WebAuthnVerifierService({ rpId: RP_ID, origin: ORIGIN });
  const optionsUseCase = new WebAuthnRegisterOptionsUseCase(challenges, { rpId: RP_ID, rpName: "Zyon Shop" }, buyers);
  const verifyUseCase = new WebAuthnRegisterVerifyUseCase({
    verifier,
    challengeService: challenges,
    credentialStore: credStore,
    buyerRepo: buyers,
  });

  const options = await optionsUseCase.execute({ buyer_id: "guser_1" });

  // Simulate authenticator -> the client would normally do navigator.credentials.create.
  // For the test we craft a representative attestation object: we skip full CBOR and
  // rely on parseAttestation having been verified separately. Here we call
  // register with stub-data by invoking the use case after spoofing the parsed
  // credential fields directly through the attestation path.
  // To keep this an integration test, we craft raw inputs the verifier can hash.

  // Generate a key pair to embed as the attested credential public key
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const credentialIdBytes = new TextEncoder().encode("Y3JlZF9pbnRlZ3JhdGlvbg");

  // Pre-build authenticator data: rpIdHash || flags(UP|UV) || counter(0) || attestedCredData
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(RP_ID)));
  const authData = new Uint8Array(37 + 16 + 2 + credentialIdBytes.length + rawPub.length);
  authData.set(rpIdHash, 0);
  authData[32] = 1 | (1 << 2); // UP | UV
  authData[33] = 0; authData[34] = 0; authData[35] = 0; authData[36] = 0; // counter = 0
  authData.set(credentialIdBytes, 18 + 16);
  // Set credentialIdLength big-endian
  authData[16 + 16] = (credentialIdBytes.length >>> 8) & 0xff;
  authData[16 + 17] = credentialIdBytes.length & 0xff;
  authData.set(rawPub, 16 + 18 + credentialIdBytes.length);

  const challengeBytes = new Uint8Array(Buffer.from(options.challenge, "base64url"));
  const clientData = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: ORIGIN })
  );

  const result = await verifyUseCase.execute({
    buyer_id: "guser_1",
    credential: {
      id: "Y3JlZF9pbnRlZ3JhdGlvbg",
      rawId: "Y3JlZF9pbnRlZ3JhdGlvbg",
      authenticatorData: Buffer.from(authData).toString("base64url"),
      clientDataJSON: Buffer.from(clientData).toString("base64url"),
      type: "public-key",
    },
    challenge: challengeBytes,
  });

  assert.ok(result.credential_id);
  const stored = await credStore.findByCredentialId("Y3JlZF9pbnRlZ3JhdGlvbg");
  assert.ok(stored);
  assert.equal(stored!.globalUserId, "guser_1");
  assert.equal(stored!.counter, 0);
  assert.equal(stored!.origin, ORIGIN);
});
