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

  // B4 (P2): merchant_id is always server-generated (mrc_uuid prefix), so the
  // client-supplied "mrc_1" must be ignored.
  assert.ok(registered.merchant_id.startsWith("mrc_"), "merchant_id must start with mrc_");
  assert.notEqual(registered.merchant_id, "mrc_1", "client-supplied merchant_id must not be honored");
  assert.equal(registered.email, "owner@example.com");
  assert.equal(logged.merchant_id, registered.merchant_id);
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

// B4 (P2) regression: merchant_id from request body must be ignored; server
// always generates it. Two registrations with the same requested merchant_id
// must produce two different server-assigned IDs.
test("RegisterMerchantUseCase ignores client-supplied merchant_id (B4 P2 regression)", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600);
  const register = new RegisterMerchantUseCase(repository, hasher, jwt);

  const r1 = await register.execute({
    merchant_id: "mrc_squatted",
    merchant_name: "Store A",
    email: "a@example.com",
    password: "pass"
  });
  const r2 = await register.execute({
    merchant_id: "mrc_squatted",
    merchant_name: "Store B",
    email: "b@example.com",
    password: "pass"
  });

  // Both must succeed and receive unique server-generated IDs.
  assert.notEqual(r1.merchant_id, "mrc_squatted");
  assert.notEqual(r2.merchant_id, "mrc_squatted");
  assert.notEqual(r1.merchant_id, r2.merchant_id, "each registration gets a unique merchant_id");
});
