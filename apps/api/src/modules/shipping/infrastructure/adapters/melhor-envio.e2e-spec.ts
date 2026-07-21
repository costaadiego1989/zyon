/**
 * E2E tests for Melhor Envio integration against SANDBOX.
 * Gated by RUN_SHIPPING_E2E=true environment variable.
 * Requires:
 *   MELHOR_ENVIO_TOKEN (sandbox)
 *   MELHOR_ENVIO_BASE_URL=https://sandbox.melhorenvio.com.br
 *   MELHOR_ENVIO_FROM_ZIP=01000000
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MelhorEnvioCarrierAdapter } from "./melhor-envio.carrier.js";

const SKIP = !process.env.RUN_SHIPPING_E2E;

test("E2E: Melhor Envio sandbox — calculate shipping for valid packages", { skip: SKIP ? "Set RUN_SHIPPING_E2E=true to run live shipping E2E tests. Requires: MELHOR_ENVIO_TOKEN (sandbox), MELHOR_ENVIO_FROM_ZIP." : false }, async () => {
  const adapter = new MelhorEnvioCarrierAdapter();

  const quotes = await adapter.fetchQuotes({
    originZip: process.env.MELHOR_ENVIO_FROM_ZIP ?? "01000000",
    destinationZip: "22041-080", // Copacabana, RJ
    cartTotalCents: 15000,
    merchantId: "mrc_e2e_test",
    packages: [
      { weightKg: 0.5, widthCm: 15, heightCm: 10, lengthCm: 20, quantity: 1 }
    ]
  });

  // Sandbox should return at least 1 service (PAC or SEDEX)
  assert.ok(quotes.length > 0, `expected at least 1 service from sandbox, got ${quotes.length}`);

  for (const q of quotes) {
    assert.match(q.carrier_key, /^melhor-envio-\d+$/, "carrier_key uses expected format");
    assert.ok(q.label.length > 0, "label not empty");
    assert.ok(q.price > 0, "price is positive (cents)");
    assert.ok(q.eta_days > 0, "eta_days is positive");
    assert.equal(q.is_free, false, "sandbox quotes are never free");
  }

  // At least one Correios service expected
  const hasCorreios = quotes.some(q => /correios/i.test(q.label));
  assert.ok(hasCorreios, "should include at least one Correios service");
});

test("E2E: Melhor Envio sandbox — heavy package (30kg) returns valid quotes", { skip: SKIP ? "(skipped - need live API)" : false }, async () => {
  const adapter = new MelhorEnvioCarrierAdapter();

  const quotes = await adapter.fetchQuotes({
    originZip: process.env.MELHOR_ENVIO_FROM_ZIP ?? "01000000",
    destinationZip: "80010-000", // Curitiba, PR
    cartTotalCents: 50000,
    merchantId: "mrc_e2e_test",
    packages: [
      { weightKg: 25, widthCm: 60, heightCm: 40, lengthCm: 80, quantity: 1 }
    ]
  });

  // Heavy packages might return fewer services (some reject > 30kg per Correios)
  // but should still succeed (adapter does not throw)
  assert.ok(Array.isArray(quotes));
  // If quotes returned, validate format
  for (const q of quotes) {
    assert.ok(q.price > 0);
    assert.ok(q.eta_days > 0);
  }
});

test("E2E: Melhor Envio sandbox — same origin/destination CEP (0km) returns empty or error-free", { skip: SKIP ? "(skipped - need live API)" : false }, async () => {
  const adapter = new MelhorEnvioCarrierAdapter();

  const quotes = await adapter.fetchQuotes({
    originZip: "01000000",
    destinationZip: "01000000", // same CEP
    cartTotalCents: 10000,
    merchantId: "mrc_e2e_test",
    packages: [
      { weightKg: 0.5, widthCm: 15, heightCm: 10, lengthCm: 20, quantity: 1 }
    ]
  });

  // Should not crash. May return quotes or empty (API-dependent).
  assert.ok(Array.isArray(quotes));
});
