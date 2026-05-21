import test from "node:test";
import assert from "node:assert/strict";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
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
