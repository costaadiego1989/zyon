import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { OAuthCallbackUseCase } from "./oauth-callback.use-case.js";

test("new OAuth users resume a prefilled registration until it is completed", async () => {
  const repository = new InMemoryAuthRepository();
  const provider = {
    async exchangeCodeForProfile() {
      return { email: "owner@example.com", name: "Ana Souza", providerId: "google-1" };
    },
  };
  const useCase = new OAuthCallbackUseCase(
    provider,
    repository,
    { generate: () => "mrc_oauth_test" },
    new JwtService("test-secret", 3600),
  );

  const first = await useCase.execute({ provider: "google", code: "first", state: "state" });
  assert.equal(first.onboarding_required, true);
  assert.deepEqual(first.profile, { name: "Ana Souza", email: "owner@example.com" });

  const second = await useCase.execute({ provider: "google", code: "second", state: "state" });
  assert.equal(second.merchant_id, first.merchant_id);
  assert.equal(second.onboarding_required, true);

  await repository.setStoreSettings(first.merchant_id, { oauth_registration_pending: false });
  const completed = await useCase.execute({ provider: "google", code: "third", state: "state" });
  assert.equal(completed.onboarding_required, false);
});
