import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSavedAddressService } from "../application/services/checkout-saved-address.service.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { ListBuyerAddressesUseCase } from "../../buyer-account/application/use-cases/list-buyer-addresses.use-case.js";
import { BuyerAddress } from "../../buyer-account/domain/entities/buyer-address.entity.js";
import type { BuyerAddressRepository } from "../../buyer-account/domain/ports/buyer-address.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

const home = { zip: "01310100", street: "Paulista", number: "100", complement: "", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };
const work = { ...home, zip: "01001000", street: "Praça da Sé", number: "20" };
function setup() {
  const rows = new Map<string, BuyerAddress>(); let writes = 0;
  const addresses: BuyerAddressRepository = { list: async user => [...rows.values()].filter(a => a.globalUserId === user),
    findById: async (user, id) => rows.get(id)?.globalUserId === user ? rows.get(id)! : null,
    save: async a => { writes++; rows.set(a.id, a); }, delete: async () => {}, count: async () => rows.size, clearDefaults: async () => {} };
  const accounts = { findByGlobalUserId: async () => ({ address: home, createdAt: new Date("2026-01-01") }) };
  const list = new ListBuyerAddressesUseCase(addresses, accounts as never);
  const saved = new CheckoutSavedAddressService(addresses, list);
  const session = checkoutSession({ customer: { fullName: "Fixture Buyer", email: "fixture@example.test", email_verified: true,
    cpf: "52998224725", phone: "11987654321", address_verified: true, address: work, deliveryAddressLabel: "Trabalho" } });
  return { rows, saved, session, list, writes: () => writes };
}

test("named checkout address preserves the legacy principal address, deduplicates and can be reused after confirmation", async () => {
  const f = setup();
  assert.equal(await f.saved.saveComplete(f.session), true);
  const addresses = await f.list.execute("usr_1");
  assert.equal(addresses.length, 2);
  assert.equal(addresses[0]?.isDefault, true); assert.equal(addresses[0]?.street, home.street);
  assert.equal(addresses[1]?.label, "Trabalho"); assert.equal(addresses[1]?.isDefault, false);
  await f.saved.saveComplete(f.session); assert.equal(f.writes(), 2, "repeated chat turns do not duplicate or rewrite addresses");
  const selection = await f.saved.resolve(checkoutSession({ customer: { email_verified: true, address: home } }), "entregar no trabalho");
  assert.match(selection?.message ?? "", /Trabalho.*Praça da Sé/);
  assert.equal(selection?.session.customer?.address_verified, false);
  assert.equal(selection?.session.customer?.address?.number, "20");
  assert.equal(await f.saved.resolve(checkoutSession({ customer: { email_verified: false } }), "salvar como Trabalho"), undefined);
  assert.equal(await f.saved.saveComplete({ ...f.session, customer: { ...f.session.customer, address_verified: false } }), false);
});

test("a new workplace starts the correction flow without inheriting the principal shipping quote", async () => {
  const f = setup(); const repo = new InMemoryCheckoutRepository();
  const original = checkoutSession({ customer: { ...f.session.customer, address: home, deliveryAddressLabel: undefined } });
  repo.saveSession(original);
  const customer = new CheckoutCustomerService(repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.saved);
  const correction = await customer.correctCustomerInput(original, "quero entregar no trabalho");
  assert.equal(correction?.needsInput, true); assert.equal(correction?.field, "zip");
  assert.equal(correction?.session.customer?.deliveryAddressLabel, "Trabalho");
  assert.match(correction?.message ?? "", /CEP/);
});

test("shipping preferences choose actual cheapest and fastest quotes instead of assuming PAC/SEDEX order", async () => {
  for (const [text, carrier] of [["frete mais barato", "Jadlog"], ["frete mais rápido", "Azul"]]) {
    const repo = new InMemoryCheckoutRepository();
    const session = checkoutSession({ shipping: undefined, customer: { address: home, address_verified: true }, shippingOptions: [
      { carrier: "Correios", method: "PAC", customerPrice: 30, deliveryDays: 8 },
      { carrier: "Jadlog", method: "Econômico", customerPrice: 12, deliveryDays: 5 },
      { carrier: "Azul", method: "Expresso", customerPrice: 22, deliveryDays: 1 } ] });
    repo.saveSession(session);
    const service = new CheckoutShippingService(repo, new CheckoutCustomerService(repo));
    assert.equal((await service.processShippingState(session, text!)).shipping?.carrier, carrier);
  }
});
