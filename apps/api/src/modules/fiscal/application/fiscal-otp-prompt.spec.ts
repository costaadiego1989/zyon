import assert from "node:assert/strict";
import test from "node:test";
import { generateDeterministicReply } from "@zyon/conversation-engine";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { CheckoutCustomerService } from "../../checkout/application/services/checkout-customer.service.js";
import { OtpService } from "../../checkout/application/services/otp.service.js";
import { deriveChatStage, missingFieldsForStage } from "../../checkout/domain/services/customer-extraction.service.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import type { SendEmailInput } from "../../notifications/domain/ports/email-sender.port.js";

test("FISCAL-76 accepted buyer email OTP asks for its verification code without exposing the challenge", async () => {
  const repository = new InMemoryCheckoutRepository(), accepted: SendEmailInput[] = [];
  const session = checkoutSession({ customer: { fiscalRecipientMode: "buyer", fullName: "Comprador", cpf: "52998224725",
    phone: "31999999999", email: "buyer@example.test", email_verified: false } });
  repository.saveSession(session);
  const customer = new CheckoutCustomerService(repository, undefined, new OtpService(), undefined, undefined, {
    send: async input => { accepted.push(structuredClone(input)); return { status: "sent", messageId: "synthetic-fiscal-otp" }; },
  });
  await customer.beginEmailVerification(session, "Loja");
  const challenged = repository.getSession(session.merchantId, session.sessionId)!;
  assert.equal(accepted.length, 1); assert.equal(accepted[0].to, challenged.customer!.email);
  assert.equal(accepted[0].requireDelivery, true); assert.ok(challenged.customer!.otp_code);
  assert.ok(accepted[0].html.includes(challenged.customer!.otp_code!));
  const stage = deriveChatStage(challenged), fields = missingFieldsForStage(challenged, stage);
  assert.equal(stage, "data_collection"); assert.equal(fields[0], "código de verificação");
  const response = generateDeterministicReply({ userMessage: "Quero continuar", brandVoice: "consultative", stage,
    missingFields: fields, cart: challenged.cart });
  assert.match(response.message, /código de 6 dígitos.*email.*digit/i);
  assert.doesNotMatch(response.message, /qual.*(?:email|e-mail)/i);
  assert.equal(JSON.stringify(response).includes(challenged.customer!.otp_code!), false);
  assert.notEqual(challenged.customer!.email_verified, true);
});

test("FISCAL-76 nonfiscal contact checkout keeps its existing stage without a fiscal OTP prerequisite", () => {
  const session = checkoutSession({ customer: { fullName: "Comprador", email: "buyer@example.test", phone: "31999999999", email_verified: false } });
  assert.notEqual(deriveChatStage(session), "data_collection");
  assert.deepEqual(missingFieldsForStage(session, "data_collection"), []);
});
