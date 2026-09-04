import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { ChangePasswordUseCase } from "./change-password.use-case.js";
import { InvalidCredentialsError, WeakPasswordError } from "../domain/errors.js";

function makeSut() {
  const repo = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const sut = new ChangePasswordUseCase(repo, hasher);
  return { repo, hasher, sut };
}

async function seedMerchant(repo: InMemoryAuthRepository) {
  const { user } = await repo.createMerchantWithOwner({
    merchantId: "merch_1",
    merchantName: "Loja X",
    email: "owner@x.com",
    passwordHash: await new PasswordHasher().hash("currentPass1"),
  });
  await repo.updateOwnerProfile(user.id, "merch_1", { ownerName: "Owner", ownerPhone: "" });
  return user;
}

test("ChangePasswordUseCase: rejects when missing current password", async () => {
  const { sut } = makeSut();
  await assert.rejects(
    () => sut.execute({ merchantId: "merch_1", currentPassword: "", newPassword: "newPass123" }),
    BadRequestException,
  );
});

test("ChangePasswordUseCase: rejects weak new password (<8 chars)", async () => {
  const { sut } = makeSut();
  await assert.rejects(
    () => sut.execute({ merchantId: "merch_1", currentPassword: "currentPass1", newPassword: "short" }),
    WeakPasswordError,
  );
});

test("ChangePasswordUseCase: throws NotFound when profile missing", async () => {
  const { sut } = makeSut();
  await assert.rejects(
    () => sut.execute({ merchantId: "ghost", currentPassword: "x", newPassword: "newPass123" }),
    NotFoundException,
  );
});

test("ChangePasswordUseCase: rejects when current password is wrong", async () => {
  const { repo, sut } = makeSut();
  await seedMerchant(repo);
  await assert.rejects(
    () => sut.execute({ merchantId: "merch_1", currentPassword: "wrongPassword", newPassword: "newPass123" }),
    InvalidCredentialsError,
  );
});

test("ChangePasswordUseCase: accepts correct current password and updates hash", async () => {
  const { repo, hasher, sut } = makeSut();
  const user = await seedMerchant(repo);

  const result = await sut.execute({
    merchantId: "merch_1",
    currentPassword: "currentPass1",
    newPassword: "newSecure123",
  });

  assert.equal(result.success, true);
  const updated = await repo.findUserByEmail(user.email);
  assert.ok(updated?.passwordHash);
  const verified = await hasher.verify("newSecure123", updated.passwordHash!);
  assert.equal(verified.valid, true);
});

test("ChangePasswordUseCase: rejects when user has no password (OAuth-only)", async () => {
  const { repo, sut } = makeSut();
  // Seed a user with null passwordHash directly via repo (simulating OAuth signup).
  await seedMerchant(repo);
  const user = await repo.findUserByEmail("owner@x.com");
  if (user) {
    user.passwordHash = undefined;
  }

  await assert.rejects(
    () => sut.execute({ merchantId: "merch_1", currentPassword: "anything8c", newPassword: "newPass123" }),
    InvalidCredentialsError,
  );
});
