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

test("checkout stores an email OTP only after Resend accepts it", async () => {
  const repository = new InMemoryCheckoutRepository();
  const sent: Array<{ to: string; requireDelivery?: boolean }> = [];
  const emailSender = {
    async send(input: { to: string; requireDelivery?: boolean }) {
      sent.push(input);
      return { status: "sent" as const, messageId: "resend-message-1" };
    },
  };
  const service = new CheckoutCustomerService(repository, undefined, new OtpService(), undefined, undefined, emailSender as never);
  const session = checkoutSession({ customer: { phone: "11999990000" } });

  const result = await service.processCustomerInput(session, "buyer@example.test", "Qual é seu e-mail?", "Loja Teste");

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, "buyer@example.test");
  assert.equal(sent[0]?.requireDelivery, true);
  assert.match(result.customer?.otp_code ?? "", /^\d{6}$/);
});

test("checkout sends the same OTP through an approved Meta template after Resend rejects it", async () => {
  const repository = new InMemoryCheckoutRepository();
  const emailSender = { async send() { return { status: "skipped" as const, messageId: "" }; } };
  const templates = {
    async findByMerchantAndType() {
      return {
        isActive: true,
        metaStatus: "approved",
        twilioContentSid: "checkout_otp_template",
        metaLanguage: "pt_BR",
        metaVariableMap: { "1": "otpCode" },
      };
    },
  };
  const sent: Array<{ type?: string; contentVariables: Record<string, string> }> = [];
  const whatsappTemplates = {
    async sendTemplate(input: { type?: string; contentVariables: Record<string, string> }) {
      sent.push(input);
      return { status: "sent" as const, messageId: "wamid-1" };
    },
  };
  const service = new CheckoutCustomerService(
    repository, undefined, new OtpService(), undefined, undefined,
    emailSender as never, templates as never, whatsappTemplates as never,
  );
  const session = checkoutSession({ customer: { phone: "11999990000" } });

  const result = await service.processCustomerInput(session, "buyer@example.test", "Qual é seu e-mail?", "Loja Teste");

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, "checkout_otp");
  assert.equal(sent[0]?.contentVariables["1"], result.customer?.otp_code);
});

test("checkout does not persist an OTP when neither transactional channel accepts it", async () => {
  const repository = new InMemoryCheckoutRepository();
  const emailSender = { async send() { return { status: "skipped" as const, messageId: "" }; } };
  const service = new CheckoutCustomerService(repository, undefined, new OtpService(), undefined, undefined, emailSender as never);
  const session = checkoutSession({ customer: { phone: "11999990000" } });

  await assert.rejects(
    service.processCustomerInput(session, "buyer@example.test", "Qual é seu e-mail?", "Loja Teste"),
    /Não foi possível enviar o código de confirmação/,
  );
  assert.equal(await repository.getSession(session.merchantId, session.sessionId), undefined);
});
