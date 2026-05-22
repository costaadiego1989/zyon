import test from "node:test";
import assert from "node:assert/strict";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { LoginBuyerFromSessionUseCase } from "./login-buyer-from-session.use-case.js";

test("LoginBuyerFromSessionUseCase creates buyer account linked to checkout global user", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const buyers = new InMemoryBuyerAccountRepository();
  checkout.saveSession(
    checkoutSession({
      globalUserId: "guser_checkout_1",
      customer: {
        email: "Buyer@Example.com",
        email_verified: true,
        fullName: "Buyer Test",
        phone: "11999998888"
      }
    })
  );

  const result = await new LoginBuyerFromSessionUseCase(
    checkout,
    buyers,
    new BuyerJwtService("test-secret", 3600),
    new PasswordHasher()
  ).execute({
    merchant_id: "mrc_1",
    session_id: "chk_1"
  });

  assert.equal(result.globalUserId, "guser_checkout_1");
  assert.equal(result.email, "buyer@example.com");
  assert.equal((await buyers.findByEmail("buyer@example.com"))?.displayName, "Buyer Test");
});

test("LoginBuyerFromSessionUseCase rejects sessions without verified email", async () => {
  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(
    checkoutSession({
      customer: { email: "buyer@example.com", email_verified: false }
    })
  );

  await assert.rejects(
    () =>
      new LoginBuyerFromSessionUseCase(
        checkout,
        new InMemoryBuyerAccountRepository(),
        new BuyerJwtService("test-secret", 3600),
        new PasswordHasher()
      ).execute({
        merchant_id: "mrc_1",
        session_id: "chk_1"
      }),
    /buyer_email_not_verified/
  );
});

test("LoginBuyerFromSessionUseCase hydrates missing existing buyer profile from checkout session", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const buyers = new InMemoryBuyerAccountRepository();
  const passwordHash = await new PasswordHasher().hash("BuyerPass123!");
  await buyers.save(new BuyerAccount({
    globalUserId: "existing_guser",
    email: "buyer@example.com",
    passwordHash,
    displayName: "buyer",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z")
  }));
  checkout.saveSession(
    checkoutSession({
      globalUserId: "guser_checkout_2",
      customer: {
        email: "buyer@example.com",
        email_verified: true,
        fullName: "Diego Costa",
        phone: "21993001883"
      }
    })
  );

  const result = await new LoginBuyerFromSessionUseCase(
    checkout,
    buyers,
    new BuyerJwtService("test-secret", 3600),
    new PasswordHasher()
  ).execute({
    merchant_id: "mrc_1",
    session_id: "chk_1"
  });

  const account = await buyers.findByEmail("buyer@example.com");
  assert.equal(result.globalUserId, "existing_guser");
  assert.equal(account?.displayName, "Diego Costa");
  assert.equal(account?.phone, "21993001883");
});
