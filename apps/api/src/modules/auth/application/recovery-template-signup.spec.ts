import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import type { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { OAuthCallbackUseCase } from "./oauth-callback.use-case.js";
import { RegisterMerchantUseCase } from "./register-merchant.use-case.js";

const jwt = () => ({ issue: async () => "test-token", expiresIn: () => 3600 }) as unknown as JwtService;
const input = { merchant_name: "Example Store", email: "owner@example.test", password: "StrongPassword123!" };

test("password signup seeds templates for the server-generated merchant after account persistence", async () => {
  const repo = new InMemoryAuthRepository();
  const ensured: string[] = [];
  const useCase = new RegisterMerchantUseCase(repo, new PasswordHasher(), jwt(), { generate: () => "merchant-generated" }, {
    async ensure(merchantId) {
      assert.ok(await repo.findMerchantById(merchantId));
      ensured.push(merchantId);
    },
  });
  const result = await useCase.execute(input);
  assert.equal(result.merchant_id, "merchant-generated");
  assert.deepEqual(ensured, ["merchant-generated"]);
});

test("template initialization failure does not roll back a successful password registration", async () => {
  const repo = new InMemoryAuthRepository();
  const useCase = new RegisterMerchantUseCase(repo, new PasswordHasher(), jwt(), { generate: () => "merchant-deferred" }, {
    async ensure() { throw new Error("temporary template storage failure"); },
  });
  const result = await useCase.execute(input);
  assert.equal(result.merchant_id, "merchant-deferred");
  assert.ok(await repo.findMerchantById("merchant-deferred"));
});

test("invalid registration does not create templates", async () => {
  let calls = 0;
  const useCase = new RegisterMerchantUseCase(new InMemoryAuthRepository(), new PasswordHasher(), jwt(), { generate: () => "merchant-unused" }, {
    async ensure() { calls++; },
  });
  await assert.rejects(useCase.execute({ ...input, email: "invalid" }));
  assert.equal(calls, 0);
});

test("new OAuth account seeds templates once and existing login does not recreate them", async () => {
  const repo = new InMemoryAuthRepository();
  const ensured: string[] = [];
  const useCase = new OAuthCallbackUseCase({ async exchangeCodeForProfile() {
    return { email: "oauth@example.test", name: "Example Owner", providerId: "google-test" };
  } }, repo, { generate: () => "merchant-oauth" }, jwt(), {
    async ensure(merchantId) { assert.ok(await repo.findMerchantById(merchantId)); ensured.push(merchantId); },
  });
  await useCase.execute({ provider: "google", code: "first", state: "state" });
  await useCase.execute({ provider: "google", code: "second", state: "state" });
  assert.deepEqual(ensured, ["merchant-oauth"]);
});

test("OAuth registration remains usable when template initialization awaits the monitor", async () => {
  const repo = new InMemoryAuthRepository();
  const useCase = new OAuthCallbackUseCase({ async exchangeCodeForProfile() {
    return { email: "oauth@example.test", name: "Example Owner", providerId: "google-test" };
  } }, repo, { generate: () => "merchant-oauth-deferred" }, jwt(), {
    async ensure() { throw new Error("temporary template storage failure"); },
  });
  const result = await useCase.execute({ provider: "google", code: "first", state: "state" });
  assert.equal(result.merchant_id, "merchant-oauth-deferred");
  assert.equal(result.onboarding_required, true);
});
