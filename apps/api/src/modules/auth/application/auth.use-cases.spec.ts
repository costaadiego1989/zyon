import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { LoginUseCase } from "./login.use-case.js";
import { RegisterMerchantUseCase } from "./register-merchant.use-case.js";

test("register and login return JWTs for the merchant owner", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600);
  const register = new RegisterMerchantUseCase(repository, hasher, jwt);
  const login = new LoginUseCase(repository, hasher, jwt);

  const registered = await register.execute({
    merchant_id: "mrc_1",
    merchant_name: "Demo Store",
    email: " Owner@Example.com ",
    password: "secret"
  });
  const logged = await login.execute({ email: "owner@example.com", password: "secret" });

  assert.equal(registered.merchant_id, "mrc_1");
  assert.equal(registered.email, "owner@example.com");
  assert.equal(logged.merchant_id, "mrc_1");
  assert.ok(logged.access_token);
});

test("auth rejects duplicate email and invalid credentials", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600);
  const register = new RegisterMerchantUseCase(repository, hasher, jwt);
  const login = new LoginUseCase(repository, hasher, jwt);

  await register.execute({
    merchant_name: "Demo Store",
    email: "owner@example.com",
    password: "secret"
  });

  await assert.rejects(
    () => register.execute({ merchant_name: "Other", email: "owner@example.com", password: "secret" }),
    ConflictException
  );
  await assert.rejects(
    () => login.execute({ email: "owner@example.com", password: "wrong" }),
    UnauthorizedException
  );
});
