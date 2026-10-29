import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnRegisterOptionsUseCase } from "../application/use-cases/webauthn-register-options.use-case.js";
import { WebAuthnRegisterVerifyUseCase } from "../application/use-cases/webauthn-register-verify.use-case.js";
import { authenticator, dependencies, rpId } from "./webauthn-fixture.js";

export async function registerFixture() {
  const deps = await dependencies();
  const device = authenticator();
  const options = await new WebAuthnRegisterOptionsUseCase(deps.challengeService, { rpId, rpName: "Store" }, deps.buyerRepo)
    .execute({ buyer_id: deps.buyer.globalUserId });
  const response = device.registration(options.challenge);
  const input = { buyer_id: deps.buyer.globalUserId, challenge: Buffer.from(options.challenge, "base64url"), credential: {
    id: response.id, rawId: response.rawId, type: response.type,
    authenticatorData: response.response.attestationObject, clientDataJSON: response.response.clientDataJSON,
  } };
  const useCase = new WebAuthnRegisterVerifyUseCase(deps);
  await useCase.execute(input);
  return { ...deps, device, options, useCase, input };
}
test("Enrolls a real CBOR attestation and persists a COSE public key owned by the authenticated buyer", async () => {
  const { credentialStore, device, options, buyer } = await registerFixture();
  assert.equal(Buffer.from(options.user.id, "base64url").toString(), buyer.globalUserId);
  assert.equal(options.authenticatorSelection.residentKey, "required");
  const stored = await credentialStore.findByCredentialId(device.id);
  assert.equal(stored?.globalUserId, buyer.globalUserId);
  assert.deepEqual(stored?.publicKey, device.publicKey);
});
test("Registration challenge is single use and bound to the authenticated buyer", async () => {
  const { useCase, input } = await registerFixture();
  await assert.rejects(() => useCase.execute(input), /challenge_invalid_or_expired/);
  await assert.rejects(() => useCase.execute({ ...input, buyer_id: "another_buyer" }), /buyer_account_not_found/);
});
