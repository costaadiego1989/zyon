import test from "node:test";
import assert from "node:assert/strict";
import { ConflictException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { DefaultMerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { LoginUseCase } from "./login.use-case.js";
import { RegisterMerchantUseCase } from "./register-merchant.use-case.js";
import { InvalidCredentialsError, EmailAlreadyRegisteredError, WeakPasswordError, InvalidEmailError } from "../domain/errors.js";

test("register and login return JWTs for the merchant owner", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);
  const login = new LoginUseCase(repository, hasher, jwt);

  const registered = await register.execute({
    merchant_name: "Demo Store",
    email: " Owner@Example.com ",
    password: "secret-password-123"
  });
  const logged = await login.execute({ email: "owner@example.com", password: "secret-password-123" });

  // B4 (P2): merchant_id is always server-generated (mrc_uuid prefix)
  assert.ok(registered.merchant_id.startsWith("mrc_"), "merchant_id must start with mrc_");
  assert.equal(registered.email, "owner@example.com");
  assert.equal(logged.merchant_id, registered.merchant_id);
  assert.ok(logged.access_token);
});

test("auth rejects duplicate email and invalid credentials", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);
  const login = new LoginUseCase(repository, hasher, jwt);

  await register.execute({
    merchant_name: "Demo Store",
    email: "owner@example.com",
    password: "secret-password-123"
  });

  // Duplicate email rejection
  try {
    await register.execute({ merchant_name: "Other", email: "owner@example.com", password: "another-pass-123" });
    assert.fail("Should reject duplicate email");
  } catch (err) {
    assert(err instanceof ConflictException, "Should throw ConflictException for duplicate email");
  }

  // Invalid credentials
  try {
    await login.execute({ email: "owner@example.com", password: "wrong" });
    assert.fail("Should reject invalid password");
  } catch (err) {
    assert(err instanceof InvalidCredentialsError, "Should throw InvalidCredentialsError");
  }
});

// H5: Input validation tests
test("RegisterMerchantUseCase validates email format", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);

  try {
    await register.execute({
      merchant_name: "Test",
      email: "not-an-email",
      password: "secret-password-123"
    });
    assert.fail("Should reject invalid email");
  } catch (err) {
    assert(err instanceof BadRequestException, "Should throw BadRequestException");
  }
});

test("RegisterMerchantUseCase validates password strength", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);

  try {
    await register.execute({
      merchant_name: "Test",
      email: "owner@example.com",
      password: "short"
    });
    assert.fail("Should reject weak password");
  } catch (err) {
    assert(err instanceof BadRequestException, "Should throw BadRequestException");
  }
});

test("RegisterMerchantUseCase validates non-empty merchant_name", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);

  try {
    await register.execute({
      merchant_name: "",
      email: "owner@example.com",
      password: "secret-password-123"
    });
    assert.fail("Should reject empty merchant_name");
  } catch (err) {
    assert(err instanceof BadRequestException, "Should throw BadRequestException");
  }
});

// H6, M11: merchant_id is no longer accepted from request (server-generated)
test("RegisterMerchantUseCase always generates server-side merchant_id (B4 P2 regression)", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService("test-secret", 3600, repository);
  const idGen = new DefaultMerchantIdGenerator();
  const register = new RegisterMerchantUseCase(repository, hasher, jwt, idGen);

  // Note: merchant_id is no longer in RegisterMerchantRequest interface
  // This test verifies two registrations get unique server-generated IDs
  const r1 = await register.execute({
    merchant_name: "Store A",
    email: "a@example.com",
    password: "secret-password-123"
  });
  const r2 = await register.execute({
    merchant_name: "Store B",
    email: "b@example.com",
    password: "secret-password-123"
  });

  assert.ok(r1.merchant_id.startsWith("mrc_"));
  assert.ok(r2.merchant_id.startsWith("mrc_"));
  assert.notEqual(r1.merchant_id, r2.merchant_id, "each registration gets a unique merchant_id");
});
