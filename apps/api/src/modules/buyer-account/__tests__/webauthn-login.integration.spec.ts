import test from "node:test";
import assert from "node:assert/strict";
import { WebAuthnLoginOptionsUseCase } from "../application/use-cases/webauthn-login-options.use-case.js";
import { WebAuthnLoginVerifyUseCase } from "../application/use-cases/webauthn-login-verify.use-case.js";
import { registerFixture } from "./webauthn-register.integration.spec.js";
import { b64, rpId } from "./webauthn-fixture.js";

test("Discoverable biometric login issues a fresh buyer JWT, persists counter and rejects replay", async () => {
  const deps = await registerFixture();
  const optionsUseCase = new WebAuthnLoginOptionsUseCase({ ...deps, rpId });
  const options = await optionsUseCase.execute({});
  assert.equal(options.rpId, rpId);
  assert.deepEqual(options.allowCredentials, []);
  const assertion = deps.device.assertion(options.challenge);
  const input = { challenge: assertion.challenge, credential: {
    id: deps.device.id, rawId: deps.device.id, type: "public-key" as const,
    authenticatorData: b64(assertion.authenticatorData), clientDataJSON: b64(assertion.clientDataJSON), signature: b64(assertion.signature),
  } };
  const useCase = new WebAuthnLoginVerifyUseCase(deps);
  const session = await useCase.execute(input);
  assert.equal(session.buyer_id, deps.buyer.globalUserId);
  assert.equal(deps.jwt.verify(session.access_token).globalUserId, deps.buyer.globalUserId);
  assert.equal((await deps.credentialStore.findByCredentialId(deps.device.id))?.counter, 1);
  await assert.rejects(() => useCase.execute(input), /challenge_invalid_or_expired/);
  const emailOptions = await optionsUseCase.execute({ email: deps.buyer.email });
  assert.equal(emailOptions.allowCredentials[0].id, deps.device.id);
  await assert.rejects(() => optionsUseCase.execute({ email: "unknown@example.com" }), /no_registered_credentials/);
});
test("Wrong credential IDs cannot authenticate", async () => {
  const deps = await registerFixture();
  const options = await new WebAuthnLoginOptionsUseCase({ ...deps, rpId }).execute({});
  await assert.rejects(() => new WebAuthnLoginVerifyUseCase(deps).execute({
    challenge: Buffer.from(options.challenge, "base64url"),
    credential: { id: deps.device.id, rawId: "different", type: "public-key", authenticatorData: "", clientDataJSON: "", signature: "" },
  }), /credential_invalid/);
});
