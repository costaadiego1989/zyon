import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { deriveChatStage, missingFieldsForStage } from "../domain/services/customer-extraction.service.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../payment/infrastructure/fake-payment-provider.js";
import { StockCheckedCreatePaymentIntentUseCase as CreatePaymentIntentUseCase } from "../../payment/__tests__/payment-stock-reader.fixture.js";

for (const type of ["digital", "service"] as const) test(`${type} advances without delivery and excludes stale freight from payment`, async () => {
  for (const stale of [false, true]) {
    const session = checkoutSession({ cart: { currency: "BRL", total: 100, items: [{ sku: "content", name: "Atendimento", price: 100, quantity: 1, productType: type }] },
      shipping: stale ? { customerPrice: 35, method: "PAC" } : undefined,
      customer: { email: "buyer@example.test", email_verified: true, fullName: "Cliente", cpf: "12345678909", phone: "11988887777", asaasCustomerId: "cus_test" } });
    assert.equal(deriveChatStage(session), "payment"); assert.deepEqual(missingFieldsForStage(session, "shipping"), []);
    const repo = new InMemoryCheckoutRepository(); await repo.saveSession(session);
    const payments = new InMemoryPaymentRepository(repo), provider = new FakePaymentProvider();
    const useCase = new CreatePaymentIntentUseCase(repo, repo, payments, provider);
    const result = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: `${type}-${stale}` });
    assert.equal(result.amountCents, 10099);
  }
});
test("changing the selected appointment invalidates payment identity while labels do not", () => {
  const slot = { slotId: "morning", startsAt: "2026-10-08T12:00:00.000Z", endsAt: "2026-10-08T12:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30 };
  const session = checkoutSession({ shipping: undefined, cart: { currency: "BRL", total: 100,
    items: [{ sku: "service", variantId: "resource", name: "Atendimento", price: 100, quantity: 1, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: slot }] } });
  const before = paymentCartFingerprint(session);
  session.cart.items[0]!.name = "Outro título"; assert.equal(paymentCartFingerprint(session), before);
  session.cart.items[0]!.fulfillmentSchedule = { ...slot, slotId: "afternoon" };
  assert.notEqual(paymentCartFingerprint(session), before);
});
