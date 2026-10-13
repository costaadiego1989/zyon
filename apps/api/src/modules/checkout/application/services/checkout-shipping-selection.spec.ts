import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutShippingService } from "./checkout-shipping.service.js";
import { checkoutShippingLabel } from "../../domain/services/checkout-shipping-label.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";

const options = [
  { carrier: "Correios", method: "PAC", customerPrice: 0, realCost: 19.9, deliveryDays: 7 },
  { carrier: "Correios", method: "PAC", customerPrice: 22.08, realCost: 22.08, deliveryDays: 6 },
  { carrier: "Correios", method: "Sedex", customerPrice: 34.62, realCost: 34.62, deliveryDays: 2 },
];

async function select(message: string) {
  const repository = new InMemoryCheckoutRepository();
  const session: any = { merchantId: "m1", sessionId: "s1", globalUserId: "buyer", conversationId: "c1", chatHistory: [],
    cart: { currency: "BRL", total: 289.8, items: [{ sku: "sku", name: "Item", price: 289.8, quantity: 1 }] },
    customer: { address_verified: true, address: { zip: "01310100", street: "Rua", city: "São Paulo", state: "SP", number: "1", complement: "" } },
    shippingOptions: structuredClone(options), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  repository.saveSession(session);
  const service = new CheckoutShippingService(repository, {} as any);
  await service.processShippingState(repository.getSession("m1", "s1")!, message);
  return repository.getSession("m1", "s1")!;
}

test("priced native quick reply selects the second PAC exactly, preserving its actual price and time", async () => {
  const session = await select(checkoutShippingLabel(options[1]!));
  assert.equal(session.shipping?.customerPrice, 22.08);
  assert.equal(session.shipping?.deliveryDays, 6);
});

test("stale priced label and ambiguous PAC text never silently select the first/free option", async () => {
  assert.equal((await select("Correios PAC (6 dias) - R$ 25,00")).shipping, undefined);
  assert.equal((await select("Quero PAC")).shipping, undefined);
});

test("a numeric shipping choice uses the displayed ordering and a unique named service still works", async () => {
  assert.equal((await select("2")).shipping?.customerPrice, 22.08);
  assert.equal((await select("Quero Sedex")).shipping?.customerPrice, 34.62);
});
