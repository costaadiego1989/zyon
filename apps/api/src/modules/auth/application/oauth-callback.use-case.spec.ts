import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { OAuthCallbackUseCase } from "./oauth-callback.use-case.js";
import { HttpException } from "@nestjs/common";
import type { OAuthUserProfile } from "../domain/ports/oauth-provider.port.js";

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
    new JwtService("test-secret", 3600, repository),
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

for (const providerName of ["microsoft", "facebook"] as const) {
  test(`${providerName}: repeat login resolves the original merchant by subject even after the display email changes`, async () => {
    const repository = new InMemoryAuthRepository();
    let profile: OAuthUserProfile = { email: "original@example.test", name: "Ana", providerId: "stable-subject", emailVerified: false };
    const useCase = new OAuthCallbackUseCase({ async exchangeCodeForProfile() { return profile; } }, repository,
      { generate: () => "mrc_subject_test" }, new JwtService("test-secret", 3600, repository));
    const first = await useCase.execute({ provider: providerName, code: "first", state: "state" });
    const other = await repository.createMerchantWithOwner({ merchantId: "mrc_other", merchantName: "Other", email: "changed@example.test", passwordHash: "synthetic" });
    profile = { ...profile, email: other.user.email };
    const second = await useCase.execute({ provider: providerName, code: "second", state: "state" });
    assert.equal(second.user_id, first.user_id);
    assert.equal(second.merchant_id, first.merchant_id);
    assert.equal(second.profile.email, "original@example.test");
    assert.notEqual(second.user_id, other.user.id);
  });

  test(`${providerName}: email collision cannot sign into or link another existing account`, async () => {
    const repository = new InMemoryAuthRepository();
    const existing = await repository.createMerchantWithOwner({ merchantId: "mrc_original", merchantName: "Original", email: "owner@example.test", passwordHash: "synthetic" });
    const useCase = new OAuthCallbackUseCase({ async exchangeCodeForProfile() {
      return { email: existing.user.email, name: "Unrelated", providerId: "unrelated-subject", emailVerified: false };
    } }, repository, { generate: () => "must-not-create" }, new JwtService("test-secret", 3600, repository));
    await assert.rejects(() => useCase.execute({ provider: providerName, code: "code", state: "state" }), (error: unknown) =>
      error instanceof HttpException && (error.getResponse() as { code: string }).code === "oauth_account_link_required");
    assert.equal(await repository.findUserByOAuth(providerName, "unrelated-subject"), undefined);
  });
}

test("verified Google identities still sign into an existing email/password account", async () => {
  const repository = new InMemoryAuthRepository();
  const existing = await repository.createMerchantWithOwner({ merchantId: "mrc_google", merchantName: "Original", email: "owner@example.test", passwordHash: "synthetic" });
  const useCase = new OAuthCallbackUseCase({ async exchangeCodeForProfile() {
    return { email: existing.user.email, name: "Owner", providerId: "google-subject", emailVerified: true };
  } }, repository, { generate: () => "must-not-create" }, new JwtService("test-secret", 3600, repository));
  const auth = await useCase.execute({ provider: "google", code: "code", state: "state" });
  assert.equal(auth.user_id, existing.user.id);
  assert.equal((await repository.findUserByOAuth("google", "google-subject"))?.id, existing.user.id);
});
