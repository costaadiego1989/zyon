import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { RegisterMerchantUseCase } from "./register-merchant.use-case.js";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { JwtService } from "../domain/services/jwt.service.js";

test("T8", async t => {
  for (const business_mode of ["products", "services"] as const) await t.test("persists explicit " + business_mode, async () => {
    const repo = new InMemoryAuthRepository();
    const useCase = new RegisterMerchantUseCase(repo, new PasswordHasher(), new JwtService("synthetic-secret", 3600, repo), { generate: () => "synthetic-merchant" });
    const auth = await useCase.execute({ merchant_name: "Synthetic signup", email: "signup@example.test", password: "SyntheticPassword123!", business_mode });
    const merchant = await repo.findMerchantById(auth.merchant_id);
    assert.equal(merchant?.businessMode, business_mode);
    assert.ok(merchant?.businessModeSelectedAt instanceof Date);
    assert.equal(auth.merchant_id, "synthetic-merchant");
    assert.equal(auth.email, "signup@example.test");
  });
  await t.test("absent or invalid mode never creates a merchant or owner", async () => {
    const repo = new InMemoryAuthRepository();
    const useCase = new RegisterMerchantUseCase(repo, new PasswordHasher(), new JwtService("synthetic-secret", 3600, repo), { generate: () => "synthetic-invalid" });
    for (const business_mode of [undefined, null, "both", "service", "PRODUCTS", 1]) {
      await assert.rejects(useCase.execute({ merchant_name: "Synthetic signup", email: "invalid@example.test", password: "SyntheticPassword123!", business_mode }), BadRequestException);
      assert.equal(await repo.findMerchantById("synthetic-invalid"), undefined);
      assert.equal(await repo.findUserByEmail("invalid@example.test"), undefined);
    }
  });
  await t.test("duplicate email cannot create a second selected merchant", async () => {
    const repo = new InMemoryAuthRepository(); let generated = 0;
    const useCase = new RegisterMerchantUseCase(repo, new PasswordHasher(), new JwtService("synthetic-secret", 3600, repo), { generate: () => "synthetic-" + ++generated });
    const input = { merchant_name: "Synthetic signup", email: "duplicate@example.test", password: "SyntheticPassword123!", business_mode: "products" };
    await useCase.execute(input);
    await assert.rejects(useCase.execute({ ...input, business_mode: "services" }), ConflictException);
    assert.equal(generated, 1);
    assert.equal((await repo.findMerchantById("synthetic-1"))?.businessMode, "products");
  });
});
