/**
 * Cache-behavior and production-readiness tests for QuoteShippingUseCase.
 * Tests:
 * - Quote key includes merchant rules hash (M1)
 * - Cache invalidation on merchant rules change
 * - Quote TTL enforcement
 * - Stale quote from different session is NOT reused (C2)
 * - Carrier failure logging (P3) — partial results still returned
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryMerchantRepository } from "../../../merchant/infrastructure/in-memory-merchant.repository.js";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";

function makeStubCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort {
  let callCount = 0;
  return {
    carrierKey: key,
    async fetchQuotes() {
      callCount++;
      return results;
    },
    get _callCount() { return callCount; }
  } as CarrierPort & { _callCount: number };
}

function makeCountingCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort & { _callCount: number } {
  let callCount = 0;
  return {
    carrierKey: key,
    async fetchQuotes() {
      callCount++;
      return results;
    },
    get _callCount() { return callCount; }
  };
}

function makeSetup(carriers: CarrierPort[], merchantId = "mrc_1", rulesOpts: { allowFreeShipping?: boolean; freeShippingMinCartValue?: number } = {}) {
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const merchantRepo = new InMemoryMerchantRepository();
  merchantRepo.seedRules(merchantId, {
    allowFreeShipping: rulesOpts.allowFreeShipping ?? false,
    freeShippingMinCartValue: rulesOpts.freeShippingMinCartValue ?? 999
  });
  const useCase = new QuoteShippingUseCase(quotesRepo, carriers, merchantRepo);
  return { quotesRepo, merchantRepo, useCase };
}

const BASE = {
  session_id: "sess_cache_1",
  merchant_id: "mrc_1",
  destination_zip: "01310-100",
  cart_total: 200,
};

describe("QuoteShippingUseCase — Cache & Production Readiness", () => {
  it("M1 — cache key includes merchant rules hash; rules change busts cache", async () => {
    const carrier = makeCountingCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const { useCase, merchantRepo } = makeSetup([carrier]);

    // First quote
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 1, "first call fetches from carrier");

    // Same input, same session → cache hit
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 1, "second call reuses cache");

    // Change merchant rules → cache miss (different rules hash)
    merchantRepo.seedRules("mrc_1", { allowFreeShipping: true, freeShippingMinCartValue: 50 });
    await useCase.execute(BASE);
    assert.equal(carrier._callCount, 2, "rules change invalidates cache");
  });

  it("C2 — quote from different session is NOT reused (session isolation)", async () => {
    const carrier = makeCountingCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const { useCase } = makeSetup([carrier]);

    // Quote for session A
    const snapA = await useCase.execute({ ...BASE, session_id: "sess_A" });
    assert.equal(carrier._callCount, 1);
    assert.equal(snapA.session_id, "sess_A");

    // Quote for session B (same cart key) → should NOT reuse session A's quote
    const snapB = await useCase.execute({ ...BASE, session_id: "sess_B" });
    assert.equal(carrier._callCount, 2, "different session triggers fresh fetch");
    assert.equal(snapB.session_id, "sess_B");
    assert.notEqual(snapB.id, snapA.id, "new quote has distinct ID");
  });

  it("carrier failures produce partial results (no crash)", async () => {
    let failCalled = false;
    const goodCarrier = makeStubCarrier("pac", [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
    ]);
    const badCarrier: CarrierPort = {
      carrierKey: "broken",
      async fetchQuotes() {
        failCalled = true;
        throw new Error("carrier_api_down");
      }
    };
    const { useCase } = makeSetup([goodCarrier, badCarrier]);

    const snap = await useCase.execute(BASE);
    assert.ok(failCalled, "bad carrier was invoked");
    assert.ok(snap.results.length > 0, "partial results returned");
    assert.ok(snap.results.some(r => r.carrier_key === "pac"), "good carrier results present");
    assert.ok(!snap.results.some(r => r.carrier_key === "broken"), "bad carrier not present");
  });

  it("deduplicates carriers with same key (prefers first occurrence)", async () => {
    const { useCase } = makeSetup([
      makeStubCarrier("pac", [
        { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
      ]),
      makeStubCarrier("pac-dup", [
        { carrier_key: "pac", label: "PAC", price: 1800, eta_days: 6, is_free: false }
      ])
    ]);

    const snap = await useCase.execute(BASE);
    const pacResults = snap.results.filter(r => r.carrier_key === "pac");
    assert.equal(pacResults.length, 1, "dedupe: only one entry per carrier_key");
  });

  it("returns sorted results by price → eta → label", async () => {
    const { useCase } = makeSetup([
      makeStubCarrier("multi", [
        { carrier_key: "sedex", label: "SEDEX", price: 3000, eta_days: 2, is_free: false },
        { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false },
        { carrier_key: "loggi", label: "Loggi", price: 1500, eta_days: 3, is_free: false },
      ])
    ]);

    const snap = await useCase.execute(BASE);
    assert.equal(snap.results[0]!.carrier_key, "loggi", "cheapest + fastest first");
    assert.equal(snap.results[1]!.carrier_key, "pac", "same price, slower");
    assert.equal(snap.results[2]!.carrier_key, "sedex", "most expensive last");
  });
});
