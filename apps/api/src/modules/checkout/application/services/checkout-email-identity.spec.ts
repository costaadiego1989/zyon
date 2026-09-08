import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { deriveChatStage, missingFieldsForStage } from "../../domain/services/customer-extraction.service.js";
import { CheckoutCustomerService } from "./checkout-customer.service.js";
import { OtpService } from "./otp.service.js";
import { BuyerAccountPersistenceService } from "./buyer-account-persistence.service.js";

test("verified email and contact phone advance without a phone OTP", () => {
  const session = checkoutSession({ customer: {
    fullName: "Buyer Test", email: "buyer@example.test", email_verified: true,
    cpf: "52998224725", phone: "11999990000", phone_verified: false,
  } });
  assert.equal(deriveChatStage(session), "shipping");
  assert.deepEqual(missingFieldsForStage(session, "data_collection"), []);
  assert.equal(new BuyerAccountPersistenceService().isRegistrationComplete(session.customer), true);
  session.customer!.email_verified = false;
  assert.equal(deriveChatStage(session), "data_collection");
  assert.equal(new BuyerAccountPersistenceService().isRegistrationComplete(session.customer), false);
  assert.ok(missingFieldsForStage(session, "data_collection").includes("código de verificação"));
});

test("replying to the phone question stores contact without confusing it with CPF or creating SMS OTP", async () => {
  const repository = new InMemoryCheckoutRepository();
  const service = new CheckoutCustomerService(repository, undefined, new OtpService());
  const session = checkoutSession({ customer: { email: "buyer@example.test", email_verified: true } });
  const result = await service.processCustomerInput(session, "11999990000", "Qual é seu celular com DDD para contato?", "Loja Teste");
  assert.equal(result.customer?.phone, "11999990000");
  assert.equal(result.customer?.cpf, undefined);
  assert.equal(result.customer?.phone_otp_code, undefined);
  assert.notEqual(result.customer?.phone_verified, true);
  assert.equal((await repository.getSession(session.merchantId, session.sessionId))?.customer?.phone, "11999990000");
});
