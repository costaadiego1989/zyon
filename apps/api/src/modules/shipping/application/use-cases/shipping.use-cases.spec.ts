import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "./select-shipping-method.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";

function makeStubCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort {
  return {
    carrierKey: key,
    async fetchQuotes() {
      return results;
    },
  };
}

function makeFailingCarrier(key: string): CarrierPort {
  return {
    carrierKey: key,
    async fetchQuotes() {
      throw new Error("carrier_unavailable");
    },
  };
}

function makeSetup(carriers: CarrierPort[] = []) {
  const quotesRepo = new InMemoryShippingQuoteRepository();
  const useCase = new QuoteShippingUseCase(quotesRepo, carriers);
  return { quotesRepo, useCase };
}

const BASE_INPUT = {
  session_id: "sess_1",
  merchant_id: "mrc_1",
  destination_zip: "01310-100",
  cart_total: 150,
};

describe("QuoteShippingUseCase", () => {
  it("aggregates results from all carriers", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
      makeStubCarrier("loggi", [{ carrier_key: "loggi", label: "Loggi Express", price: 2500, eta_days: 2, is_free: false }]),
    ];
    const { useCase } = makeSetup(carriers);
    const snap = await useCase.execute(BASE_INPUT);

    const keys = snap.results.map((r) => r.carrier_key);
    assert.ok(keys.includes("correios"), "should include correios");
    assert.ok(keys.includes("loggi"), "should include loggi");
  });

  it("persists quote to repository", async () => {
    const carriers = [
      makeStubCarrier("flat-rate", [{ carrier_key: "flat-rate", label: "Flat Rate", price: 990, eta_days: 7, is_free: false }]),
    ];
    const { quotesRepo, useCase } = makeSetup(carriers);
    const snap = await useCase.execute(BASE_INPUT);

    const saved = await quotesRepo.findById(snap.id, "mrc_1");
    assert.ok(saved, "quote should be persisted");
    assert.equal(saved!.snapshot().results.length, snap.results.length);
  });

  it("handles carrier failure gracefully (partial results)", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
      makeFailingCarrier("unavailable-carrier"),
    ];
    const { useCase } = makeSetup(carriers);
    const snap = await useCase.execute(BASE_INPUT);

    assert.ok(snap.results.some((r) => r.carrier_key === "correios"), "should have correios result");
    assert.ok(!snap.results.some((r) => r.carrier_key === "unavailable-carrier"), "should not have failed carrier");
  });

  it("marks existing results as free when cart meets free shipping threshold", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    const { useCase } = makeSetup(carriers);
    const snap = await useCase.execute({ ...BASE_INPUT, free_shipping_threshold: 100 });

    const freeResult = snap.results.find((r) => r.is_free && r.carrier_key === "correios");
    assert.ok(freeResult, "should have a free shipping option when cart_total >= threshold");
  });

  it("does not add free shipping when cart total below threshold", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    const { useCase } = makeSetup(carriers);
    const snap = await useCase.execute({ ...BASE_INPUT, cart_total: 50, free_shipping_threshold: 200 });

    const freeResults = snap.results.filter((r) => r.is_free);
    assert.equal(freeResults.length, 0, "no free shipping when cart below threshold");
  });

  it("returns empty results when no carriers configured", async () => {
    const { useCase } = makeSetup([]);
    const snap = await useCase.execute(BASE_INPUT);
    assert.equal(snap.results.length, 0);
  });
});

describe("SelectShippingMethodUseCase", () => {
  it("persists selected paid shipping to checkout session", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository();
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_1",
      shipping: undefined
    }));
    await quotesRepo.save(
      ShippingQuoteEntity.create({
        merchant_id: "mrc_1",
        session_id: "sess_1",
        destination_zip: "01310-100"
      }).addResults([
        { carrier_key: "correios-pac", label: "Correios PAC", price: 1290, eta_days: 5, is_free: false },
        { carrier_key: "correios-sedex", label: "Correios Sedex", price: 2590, eta_days: 2, is_free: false }
      ])
    );

    const useCase = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo);
    const selected = await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "sess_1",
      carrier_key: "correios-pac"
    });

    assert.equal(selected.selected_carrier_key, "correios-pac");
    const session = await checkoutRepo.getSession("mrc_1", "sess_1");
    assert.equal(session?.shipping?.customerPrice, 12.9);
    assert.equal(session?.shipping?.realCost, 12.9);
    assert.equal(session?.shipping?.carrier, "correios-pac");
    assert.equal(session?.shipping?.method, "Correios PAC");
    assert.equal(session?.shipping?.deliveryDays, 5);
    assert.equal(session?.shipping?.destinationZip, "01310-100");
  });

  it("persists selected free shipping and lets payment guard pass", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository();
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_free",
      cart: {
        currency: "BRL",
        total: 150,
        items: [{ sku: "sku_free", name: "Produto", price: 150, quantity: 1 }]
      },
      shipping: undefined
    }));
    await quotesRepo.save(
      ShippingQuoteEntity.create({
        merchant_id: "mrc_1",
        session_id: "sess_free",
        destination_zip: "01310100"
      }).addResults([
        { carrier_key: "free-pac", label: "Frete gratis PAC", price: 0, eta_days: 7, is_free: true }
      ])
    );

    await new SelectShippingMethodUseCase(quotesRepo, checkoutRepo).execute({
      merchant_id: "mrc_1",
      session_id: "sess_free",
      carrier_key: "free-pac"
    });

    const session = await checkoutRepo.getSession("mrc_1", "sess_free");
    assert.equal(session?.shipping?.customerPrice, 0);
    assert.equal(session?.shipping?.realCost, 0);

    const payment = await new CreatePaymentIntentUseCase(
      checkoutRepo,
      new InMemoryPaymentRepository(),
      new FakePaymentProvider(),
      checkoutRepo
    ).execute({
      merchant_id: "mrc_1",
      session_id: "sess_free",
      idempotency_key: "idem_free",
      method: "pix"
    });

    assert.equal(payment.amountCents, 15000);
  });
});
