import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "./select-shipping-method.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";
import { FlatRateCarrierAdapter } from "../../infrastructure/adapters/flat-rate.carrier.js";
import { InMemoryMerchantRepository } from "../../../merchant/infrastructure/in-memory-merchant.repository.js";

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

/** Build a use-case with no merchant rules (free-shipping disabled). */
function makeSetup(carriers: CarrierPort[] = []) {
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const useCase = new QuoteShippingUseCase(quotesRepo, carriers);
  return { quotesRepo, useCase };
}

/** Build a use-case wired with merchant rules so free-shipping policy runs. */
function makeSetupWithRules(
  carriers: CarrierPort[] = [],
  merchantId = "mrc_1",
  ruleOverrides: { freeShippingMinCartValue?: number; allowFreeShipping?: boolean } = {}
) {
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const merchantRepo = new InMemoryMerchantRepository();
  merchantRepo.updateRules(merchantId, {
    allowFreeShipping: ruleOverrides.allowFreeShipping ?? true,
    freeShippingMinCartValue: ruleOverrides.freeShippingMinCartValue ?? 100
  });
  const useCase = new QuoteShippingUseCase(quotesRepo, carriers, merchantRepo);
  return { quotesRepo, useCase, merchantRepo };
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

  // P0 regression: free-shipping threshold must come from merchant rules, not request.
  it("P0 — marks existing results as free when cart meets merchant free shipping threshold", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    // Wire merchant rules with threshold = 100; cart_total = 150 → qualifies
    const { useCase } = makeSetupWithRules(carriers, "mrc_1", { freeShippingMinCartValue: 100, allowFreeShipping: true });
    const snap = await useCase.execute(BASE_INPUT);

    const freeResult = snap.results.find((r) => r.is_free && r.carrier_key === "correios");
    assert.ok(freeResult, "should have a free shipping option when cart_total >= threshold from merchant rules");
  });

  // P0 regression: caller-supplied threshold must be IGNORED.
  it("P0 — ignores caller-supplied free_shipping_threshold (uses merchant rules only)", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    // No merchant rules wired → free-shipping disabled regardless of what caller sends
    const { useCase } = makeSetup(carriers);
    // Even if caller passes a low threshold, no free entry should appear
    const snap = await useCase.execute({ ...BASE_INPUT, free_shipping_threshold: 10 });

    const freeResults = snap.results.filter((r) => r.is_free);
    assert.equal(freeResults.length, 0, "free_shipping_threshold in request must be ignored");
  });

  it("does not add free shipping when cart total below merchant threshold", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    const { useCase } = makeSetupWithRules(carriers, "mrc_1", { freeShippingMinCartValue: 200, allowFreeShipping: true });
    const snap = await useCase.execute({ ...BASE_INPUT, cart_total: 50 });

    const freeResults = snap.results.filter((r) => r.is_free);
    assert.equal(freeResults.length, 0, "no free shipping when cart below merchant threshold");
  });

  it("returns empty results when no carriers configured", async () => {
    const { useCase } = makeSetup([]);
    const snap = await useCase.execute(BASE_INPUT);
    assert.equal(snap.results.length, 0);
  });

  it("exposes professional fallback options from the flat-rate adapter", async () => {
    const { useCase } = makeSetup([new FlatRateCarrierAdapter()]);
    const snap = await useCase.execute(BASE_INPUT);

    const labels = snap.results.map((r) => r.label);
    assert.deepEqual(labels, ["Correios PAC", "Transportadora Parceira", "Correios Sedex"]);
  });

  it("keeps real carrier quotes and appends fallback options", async () => {
    const carriers = [
      makeStubCarrier("melhor-envio", [
        { carrier_key: "jadlog", label: "Jadlog Package", price: 2200, eta_days: 4, is_free: false }
      ]),
      new FlatRateCarrierAdapter()
    ];
    const { useCase } = makeSetup(carriers);
    const snap = await useCase.execute(BASE_INPUT);

    const labels = snap.results.map((r) => r.label);
    assert.ok(labels.includes("Jadlog Package"));
    assert.ok(labels.includes("Correios PAC"));
    assert.ok(labels.includes("Correios Sedex"));
    assert.ok(labels.includes("Transportadora Parceira"));
  });

  // P2 regression: free-shipping policy must not add duplicate free entries.
  it("P2 — no duplicate free entries when carrier already has paid result", async () => {
    const carriers = [
      makeStubCarrier("correios", [
        { carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }
      ]),
    ];
    const { useCase } = makeSetupWithRules(carriers, "mrc_1", { freeShippingMinCartValue: 100, allowFreeShipping: true });
    const snap = await useCase.execute(BASE_INPUT);

    const freeEntries = snap.results.filter((r) => r.carrier_key === "correios" && r.is_free);
    assert.equal(freeEntries.length, 1, "exactly one free entry per carrier, no duplicates");
  });

  // P3 regression: reused quote must rebind session_id to the requesting session.
  it("P3 — reused quote rebinds session_id to requesting session", async () => {
    const carriers = [
      makeStubCarrier("correios", [{ carrier_key: "correios", label: "PAC", price: 1200, eta_days: 5, is_free: false }]),
    ];
    const { useCase } = makeSetup(carriers);

    // First quote: session A
    const first = await useCase.execute({ ...BASE_INPUT, session_id: "sess_A" });
    // Second quote: same cart key (same merchant, zip, total), different session
    const second = await useCase.execute({ ...BASE_INPUT, session_id: "sess_B" });

    // The snapshot returned for sess_B must not carry sess_A's session_id
    assert.equal(second.session_id, "sess_B",
      "reused quote must rebind session_id to requesting session to prevent session leak");
  });
});

describe("SelectShippingMethodUseCase", () => {
  it("persists selected paid shipping to checkout session", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_1",
      shipping: undefined
    }));
    await quotesRepo.saveWithEvents(
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
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_free",
      cart: {
        currency: "BRL",
        total: 150,
        items: [{ sku: "sku_free", name: "Produto", price: 150, quantity: 1 }]
      },
      customer: { email: "buyer@test.com", asaasCustomerId: "cus_free_fixture" },
      shipping: undefined
    }));
    await quotesRepo.saveWithEvents(
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
      checkoutRepo,
      new InMemoryPaymentRepository(checkoutRepo),
      new FakePaymentProvider()
    ).execute({
      merchant_id: "mrc_1",
      session_id: "sess_free",
      idempotency_key: "idem_free",
      method: "pix"
    });

    assert.equal(payment.amountCents, 15000);
  });
});
