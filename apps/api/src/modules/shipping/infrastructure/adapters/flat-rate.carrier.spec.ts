import test from "node:test";
import assert from "node:assert/strict";
import { FlatRateCarrierAdapter } from "./flat-rate.carrier.js";

test("FlatRateCarrierAdapter exposes carrierKey 'flat-rate'", () => {
  const adapter = new FlatRateCarrierAdapter();
  assert.equal(adapter.carrierKey, "flat-rate");
});

test("FlatRateCarrierAdapter.fetchQuotes returns three deterministic fallback options", async () => {
  const adapter = new FlatRateCarrierAdapter();
  const quotes = await adapter.fetchQuotes({
    originZip: "",
    destinationZip: "01310-100",
    cartTotalCents: 10000,
    merchantId: "mrc_1",
    packages: []
  });

  assert.equal(quotes.length, 3);
  const labels = quotes.map((q) => q.label);
  assert.deepEqual(labels, ["Correios PAC", "Correios Sedex", "Transportadora Parceira"]);

  for (const q of quotes) {
    assert.equal(q.is_free, false, "fallback quotes are always paid");
    assert.ok(q.price > 0, "fallback quotes have positive price");
    assert.ok(q.eta_days > 0, "fallback quotes have positive eta_days");
  }

  // carrier_keys use the "-estimate" suffix to signal fallback vs live quotes
  assert.deepEqual(
    quotes.map((q) => q.carrier_key),
    ["correios-pac-estimate", "correios-sedex-estimate", "transportadora-standard-estimate"]
  );
});

test("FlatRateCarrierAdapter.fetchQuotes is deterministic (no input leakage)", async () => {
  const adapter = new FlatRateCarrierAdapter();
  const ctx = {
    originZip: "01000-000",
    destinationZip: "01310-100",
    cartTotalCents: 0,
    merchantId: "mrc_1",
    packages: [{ weightKg: 5, widthCm: 20, heightCm: 10, lengthCm: 30, quantity: 1 }]
  };

  const a = await adapter.fetchQuotes(ctx);
  const b = await adapter.fetchQuotes(ctx);
  assert.deepEqual(a, b, "flat-rate adapter does not depend on context");
});
