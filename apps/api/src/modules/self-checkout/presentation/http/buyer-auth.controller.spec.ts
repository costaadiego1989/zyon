import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuyerAuthController } from "./buyer-auth.controller.js";
import { RegisterBuyerUserUseCase } from "../../application/use-cases/register-buyer-user.use-case.js";
import { InMemoryBuyerUserRepository } from "../../infrastructure/repositories/in-memory-buyer-user.repository.js";
import { InMemoryBuyerWalletRepository } from "../../infrastructure/repositories/in-memory-buyer-wallet.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function makeController() {
  const users = new InMemoryBuyerUserRepository();
  const wallets = new InMemoryBuyerWalletRepository();
  const outbox = new InMemoryOutboxRepository();
  const register = new RegisterBuyerUserUseCase(users, wallets, outbox);
  const controller = new BuyerAuthController(register, users);
  return { controller, users, wallets, outbox };
}

describe("BuyerAuthController", () => {
  it("registerBuyer creates user and returns user_id + token", async () => {
    const { controller } = makeController();

    const result = await controller.registerBuyer({
      email: "new@test.com",
      password: "securepassword123",
    });

    assert.ok(result.user_id, "should return user_id");
    assert.ok(result.token, "should return JWT token");
    // JWT has 3 parts
    assert.equal(result.token.split(".").length, 3);
  });

  it("registerBuyer stores hashed password (scrypt format)", async () => {
    const { controller, users } = makeController();

    const result = await controller.registerBuyer({
      email: "hash@test.com",
      password: "mypassword",
    });

    const user = await users.findById(result.user_id);
    assert.ok(user!.password_hash.startsWith("scrypt:"));
    assert.notEqual(user!.password_hash, "mypassword");
  });

  it("login returns token for valid credentials", async () => {
    const { controller } = makeController();

    await controller.registerBuyer({
      email: "login@test.com",
      password: "correcthorse",
    });

    const loginResult = await controller.login({
      email: "login@test.com",
      password: "correcthorse",
    });

    assert.ok(loginResult.user_id);
    assert.ok(loginResult.token);
    assert.equal(loginResult.token.split(".").length, 3);
  });

  it("login throws UnauthorizedException for wrong password", async () => {
    const { controller } = makeController();

    await controller.registerBuyer({
      email: "wrong@test.com",
      password: "correct",
    });

    await assert.rejects(
      () => controller.login({ email: "wrong@test.com", password: "incorrect" }),
      { message: "INVALID_CREDENTIALS" }
    );
  });

  it("login throws UnauthorizedException for non-existent email", async () => {
    const { controller } = makeController();

    await assert.rejects(
      () => controller.login({ email: "nobody@test.com", password: "any" }),
      { message: "INVALID_CREDENTIALS" }
    );
  });

  it("registerBuyer rejects duplicate email", async () => {
    const { controller } = makeController();

    await controller.registerBuyer({ email: "dup@test.com", password: "p1" });

    await assert.rejects(
      () => controller.registerBuyer({ email: "dup@test.com", password: "p2" }),
      { message: "EMAIL_ALREADY_REGISTERED" }
    );
  });

  it("login is case-insensitive on email", async () => {
    const { controller } = makeController();

    await controller.registerBuyer({
      email: "CaseTest@Example.com",
      password: "pass",
    });

    const result = await controller.login({
      email: "casetest@example.com",
      password: "pass",
    });
    assert.ok(result.token);
  });
});
