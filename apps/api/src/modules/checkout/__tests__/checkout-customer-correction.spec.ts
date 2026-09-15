import assert from "node:assert/strict";
import test from "node:test";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { DeterministicConversationAdapter } from "../infrastructure/adapters/deterministic-conversation.adapter.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { createSendChatUseCase } from "../application/use-cases/send-chat-message.fixture.js";
import { deriveChatStage, missingFieldsForStage } from "../domain/services/customer-extraction.service.js";

function setup() {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({
    shipping: undefined,
    customer: { phone: "11987654321", email: "wrong@example.test", otp_code: "123456", email_verified: false },
  }));
  const sent: string[] = [];
  let deliveryFails = false;
  const otp = new OtpService();
  otp.generateCode = () => "654321";
  const customerService = new CheckoutCustomerService(repository, undefined, otp, undefined, undefined, {
    async send(input: { to: string }) {
      sent.push(input.to);
      return deliveryFails ? { status: "skipped", messageId: "" } : { status: "sent", messageId: "test-delivery" };
    },
  } as never);
  const useCase = createSendChatUseCase(repository, { customerService, conversation: new DeterministicConversationAdapter(), shippingService: new CheckoutShippingService(repository, customerService), offerService: new CheckoutOfferService(repository) });
  const send = (user_message: string) => useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", conversation_id: "conv_1", user_message });
  const current = () => repository.getSession("mrc_1", "chk_1")!;
  return { repository, send, current, sent, failDelivery: () => { deliveryFails = true; }, recoverDelivery: () => { deliveryFails = false; } };
}

test("email correction leaves OTP loop, survives reload, replaces email and rejects old code", async () => {
  const { send, current, sent } = setup();
  const question = await send("Meu e-mail está errado.");
  assert.match(question.message, /e-mail correto/);
  assert.doesNotMatch(question.message, /Zion:|Enviei/);
  assert.deepEqual(question.missing_fields, ["email"]);
  assert.equal(question.experience?.copy.expected_input_type, "email");
  const restored = JSON.parse(JSON.stringify(current()));
  assert.deepEqual(missingFieldsForStage(restored, deriveChatStage(restored)), ["email"]);
  await send("Meu emailistayh");
  assert.equal(sent.length, 0);
  const replaced = await send("right@example.test");
  assert.match(replaced.message, /right@example.test/);
  assert.equal(current().customer?.email, "right@example.test");
  assert.equal(current().customer?.otp_code, "654321");
  assert.equal(current().customer?.email_verified, false);
  assert.deepEqual(sent, ["right@example.test"]);
  assert.match((await send("123456")).message, /inválido/);
  assert.equal(current().customer?.email_verified, false);
  await send("654321");
  assert.equal(current().customer?.email_verified, true);
});

test("direct replacement and correction quick reply work with a pending code", async () => {
  for (const message of ["Quero corrigir meu email para right@example.test", "Meu e-mail é right@example.test"]) {
    const { send, current, sent } = setup();
    await send(message);
    assert.equal(current().customer?.email, "right@example.test");
    assert.deepEqual(sent, ["right@example.test"]);
  }
  const { send, current } = setup();
  assert.match((await send("Corrigir e-mail")).message, /e-mail correto/);
  await send("Cancelar correção");
  assert.equal(current().customer?.email, "wrong@example.test");
  assert.deepEqual(missingFieldsForStage(current(), deriveChatStage(current()))[0], "código de verificação");
});

test("phone correction during email OTP never consumes a phone as the code or CPF", async () => {
  const { send, current, sent } = setup();
  await send("Meu celular está errado");
  assert.deepEqual((await send("123")).missing_fields, ["telefone"]);
  await send("11 9 9999 0000");
  assert.equal(current().customer?.phone, "11999990000");
  assert.equal(current().customer?.cpf, undefined);
  assert.equal(current().customer?.otp_code, "123456");
  assert.equal(current().customer?.email_verified, false);
  assert.equal(sent.length, 0);
});

test("changing a verified email detaches prior identity and private account data", async () => {
  const { send, current, repository } = setup();
  repository.saveSession({ ...current(), globalUserId: "existing_account", customer: {
    ...current().customer, email_verified: true, otp_code: "", recognized_buyer: true,
    fullName: "Private Buyer", cpf: "52998224725", externalCustomerId: "external_account", asaasCustomerId: "cus_account",
    address: { zip: "01310100", street: "Private Street", number: "100" }, address_verified: true,
  }, shipping: { carrier: "PAC", customerPrice: 10 } });
  await send("Trocar email para right@example.test");
  assert.notEqual(current().globalUserId, "existing_account");
  assert.equal(current().customer?.email_verified, false);
  for (const key of ["fullName", "cpf", "phone", "address", "externalCustomerId", "asaasCustomerId"] as const) assert.equal(current().customer?.[key], undefined);
  assert.equal(current().shipping, undefined);
});

test("delivery failure still revokes old OTP and a subsequent retry targets the corrected email", async () => {
  const { send, current, failDelivery, recoverDelivery, sent } = setup();
  failDelivery();
  assert.match((await send("Trocar email para right@example.test")).message, /Não foi possível enviar/);
  assert.equal(current().customer?.email, "right@example.test");
  assert.equal(current().customer?.otp_code, "");
  await send("123456");
  assert.notEqual(current().customer?.email_verified, true);
  recoverDelivery();
  await send("Reenviar código de e-mail");
  assert.equal(current().customer?.otp_code, "654321");
  assert.deepEqual(sent, ["right@example.test", "right@example.test"]);
});

test("mentioning a wrong email does not resend to it and a correction cannot select payment", async () => {
  const { send, current, repository, sent } = setup();
  await send("O e-mail wrong@example.test está errado");
  assert.equal(sent.length, 0);
  repository.saveSession({ ...current(), chatHistory: [], customer: {
    fullName: "Maria Silva", email: "buyer@example.test", email_verified: true, cpf: "52998224725", phone: "11987654321",
    address: { zip: "01310100", street: "Avenida Paulista", number: "100", complement: "", city: "São Paulo", state: "SP" }, address_verified: true,
  }, shipping: { carrier: "PAC", customerPrice: 10 } });
  await send("Corrigir meu nome para Maria Pix");
  assert.equal(current().customer?.fullName, "Maria Silva", "payment words must not become a customer name");
  assert.equal(current().paymentMethod, undefined);
});

test("name and address correction do not reuse an old shipping quote", async () => {
  const { send, current, repository } = setup();
  repository.saveSession({ ...current(), customer: {
    ...current().customer, fullName: "Maria Silva", email_verified: true, otp_code: "", cpf: "52998224725",
    address: { zip: "01310100", street: "Avenida Paulista", number: "100", complement: "", city: "São Paulo", state: "SP" }, address_verified: true,
  }, shipping: { carrier: "PAC", customerPrice: 10 } });
  await send("Meu nome está errado");
  await send("Maria Oliveira");
  assert.equal(current().customer?.fullName, "Maria Oliveira");
  await send("Quero corrigir o número do imóvel para 200");
  assert.equal(current().customer?.address?.number, "200");
  assert.equal(current().shipping, undefined);
  assert.equal(current().customer?.address?.complement, "");
});

test("an issued payment cannot be rebound to corrected identity", async () => {
  const { send, current, repository, sent } = setup();
  repository.saveSession({ ...current(), paymentMethod: "pix" });
  assert.match((await send("Trocar email para right@example.test")).message, /pagamento já foi iniciado/);
  assert.equal(current().customer?.email, "wrong@example.test");
  assert.equal(sent.length, 0);
});

test("cancelling a CEP correction does not fill or change the saved address", async () => {
  const { send, current, repository } = setup();
  const address = { zip: "01310100", street: "Avenida Paulista", number: "100", city: "São Paulo", state: "SP" };
  repository.saveSession({ ...current(), customer: { ...current().customer, address, address_verified: true } });
  await send("Quero corrigir o CEP");
  await send("Cancelar correção");
  assert.deepEqual(current().customer?.address, address);
});
