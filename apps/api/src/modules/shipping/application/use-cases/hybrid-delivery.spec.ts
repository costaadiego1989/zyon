import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { QuoteShippingUseCase } from "./quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "./select-shipping-method.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutScopeReader } from "../../../checkout/__tests__/checkout-scope-reader.fixture.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutShippingInput, checkoutShippingOption } from "../checkout-shipping-quote.js";
import { CheckoutShippingService } from "../../../checkout/application/services/checkout-shipping.service.js";
import { CheckoutCustomerService } from "../../../checkout/application/services/checkout-customer.service.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { snapshotOrderLines } from "../../../operations/domain/order-fulfillment.js";
import { MelhorEnvioCarrierAdapter } from "../../infrastructure/adapters/melhor-envio.carrier.js";
import { MarketplaceLabelPurchaseGuard } from "./marketplace-label-purchase.guard.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";
import { evaluateSelectedNeighborhoodDelivery } from "../../domain/services/selected-neighborhood-delivery.js";

const originalFetch = globalThis.fetch;
const base = { merchant_id: "merchant", session_id: "session", destination_zip: "01002000", cart_total: 100,
  packages: [{ weightKg: 0.5, heightCm: 10, widthCm: 15, lengthCm: 20, quantity: 1 }], items: [{ sku: "sku", quantity: 1 }] };

function fixture() {
  const state = { enabled: true, fail: false, calls: 0, originZip: "01001000", saved: 0,
    config: { id: "local", merchantId: "merchant", enabled: true, mode: "flat", flatPriceCents: 800,
      freeAboveCents: null, neighborhoods: null, radiusZones: null, estimatedValue: 60, estimatedUnit: "minutes" } as OwnDeliveryConfig };
  const sessions = new InMemoryCheckoutRepository();
  const prisma = checkoutScopeReader(sessions);
  prisma.merchant.findUnique = (async () => ({ melhorEnvioEnabled: state.enabled })) as never;
  const quotes = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const save = quotes.saveWithEvents.bind(quotes);
  quotes.saveWithEvents = async quote => { state.saved++; await save(quote); };
  const service = new QuoteShippingUseCase(quotes, [{ carrierKey: "melhor-envio", async fetchQuotes() {
    state.calls++; if (state.fail) throw new Error("provider_unavailable");
    return [{ carrier_key: "melhor-envio-1", label: "Correios PAC", price: 2137, eta_days: 6, is_free: false }];
  } }], { getRules: () => ({ originZip: state.originZip, allowFreeShipping: false }) } as never,
  { getByMerchantId: async () => state.config, save: async config => config,
    getNeighborhoodOrigin: async () => ({ kind: "ready", origin: { merchantId: "merchant", zip: "01001000", city: "São Paulo", state: "SP" } }) }, undefined, prisma);
  return { state, service, quotes, sessions, prisma };
}

describe("hybrid delivery quotes", () => {
  beforeEach(() => {
    globalThis.fetch = (async input => {
      const url = String(input);
      if (url.includes("viacep.com.br")) {
        const outside = url.includes("20000000");
        return new Response(JSON.stringify({ logradouro: "Rua Teste", bairro: "Centro", localidade: outside ? "Rio de Janeiro" : "São Paulo", uf: outside ? "RJ" : "SP" }), { status: 200 });
      }
      throw new Error(`unexpected_network:${url}`);
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("combines actual carrier results with covered local delivery and preserves minutes", async () => {
    const f = fixture();
    const quote = await f.service.execute(base);
    assert.deepEqual(quote.results.map(r => r.carrier_key), ["own_delivery_flat", "melhor-envio-1"]);
    assert.equal(quote.results[1]?.price, 2137);
    const local = checkoutShippingOption(quote, quote.results[0]!);
    assert.equal(local.estimatedUnit, "minutes"); assert.equal(local.estimatedValue, 60);
    assert.equal(local.customerPrice, 8); assert.equal(local.quoteId, quote.id);
  });

  it("the Melhor Envio adapter supplies provider price, custom ETA and canonical request dimensions", async () => {
    let payload: any;
    globalThis.fetch = (async (url, init) => {
      assert.ok(String(url).endsWith("/api/v2/me/shipment/calculate"));
      payload = JSON.parse(String(init?.body));
      return Response.json([{ id: 1, name: "PAC", price: "39.19", custom_price: "42.19", currency: "BRL",
        delivery_time: 6, custom_delivery_time: 4, company: { name: "Correios" } }]);
    }) as typeof fetch;
    const carrier = new MelhorEnvioCarrierAdapter({ resolveToken: async merchantId => {
      assert.equal(merchantId, "merchant"); return "synthetic-test-token";
    } });
    const f = fixture(); f.state.config.enabled = false;
    const service = new QuoteShippingUseCase(f.quotes, [carrier], { getRules: () => ({ originZip: "01001000" }) } as never, undefined, undefined, f.prisma);
    const result = await service.execute(base);
    assert.equal(result.results.length, 1); assert.equal(result.results[0]?.price, 4219); assert.equal(result.results[0]?.eta_days, 4);
    assert.deepEqual(payload.from, { postal_code: "01001000" }); assert.deepEqual(payload.to, { postal_code: "01002000" });
    assert.deepEqual(payload.products, [{ weight: 0.5, width: 15, height: 10, length: 20, quantity: 1 }]);
  });

  it("does not offer local flat delivery in another city", async () => {
    const f = fixture();
    const quote = await f.service.execute({ ...base, destination_zip: "20000000" });
    assert.deepEqual(quote.results.map(r => r.carrier_key), ["melhor-envio-1"]);
  });

  it("offers only the matching neighborhood within the origin city", async () => {
    const f = fixture();
    f.state.config = { ...f.state.config, mode: "neighborhood", neighborhoods: [{ name: "Centro", priceCents: 700 }, { name: "Jardins", priceCents: 900 }] };
    const quote = await f.service.execute({ ...base, destination_neighborhood: "Centro", destination_city: "São Paulo", destination_state: "SP" });
    assert.equal(quote.results.filter(r => r.source === "own_delivery").length, 1);
    assert.equal(quote.results[0]?.price, 700);
    const outside = await f.service.execute({ ...base, destination_zip: "20000000" });
    assert.equal(outside.results.filter(r => r.source === "own_delivery").length, 0);
  });

  it("does not call Melhor Envio when disabled", async () => {
    const f = fixture(); f.state.enabled = false;
    const quote = await f.service.execute(base);
    assert.equal(f.state.calls, 0); assert.deepEqual(quote.results.map(r => r.carrier_key), ["own_delivery_flat"]);
  });

  it("mapped hybrid neighborhood selection retains the transactional payment locality guard", async () => {
    const f = fixture();
    f.state.config = { ...f.state.config, mode: "neighborhood", flatPriceCents: null, neighborhoods: [{ name: "Centro", priceCents: 700 }] };
    const quote = await f.service.execute({ ...base, destination_neighborhood: "Centro", destination_city: "São Paulo", destination_state: "SP" });
    const selected = checkoutShippingOption(quote, quote.results.find(row => row.source === "own_delivery")!);
    const input = { merchantId: "merchant", sessionId: "session", selected, config: f.state.config,
      sourceQuote: quote, cartTotalCents: 10000, addressVerified: true,
      address: { zip: "01002000", city: "São Paulo", state: "SP", neighborhood: "Centro" },
      origin: { kind: "ready" as const, origin: { merchantId: "merchant", zip: "01001000", city: "São Paulo", state: "SP" } } };
    assert.equal(evaluateSelectedNeighborhoodDelivery(input).kind, "authorized");
    assert.equal(evaluateSelectedNeighborhoodDelivery({ ...input, address: { ...input.address, city: "Campinas" } }).kind, "requires_review");
    assert.equal(evaluateSelectedNeighborhoodDelivery({ ...input, config: undefined, sourceQuote: null, origin: undefined }).kind, "requires_review");
  });

  it("keeps local delivery when the carrier is unavailable", async () => {
    const f = fixture(); f.state.fail = true;
    const quote = await f.service.execute(base);
    assert.deepEqual(quote.results.map(r => r.carrier_key), ["own_delivery_flat"]);
  });

  it("returns no invented carrier or pickup and retries an empty quote", async () => {
    const f = fixture(); f.state.fail = true; f.state.config.enabled = false;
    assert.deepEqual((await f.service.execute(base)).results, []);
    f.state.fail = false;
    assert.equal((await f.service.execute(base)).results[0]?.price, 2137);
    assert.equal(f.state.calls, 2);
  });

  it("requires actual dimensions for carriers while retaining eligible local delivery", async () => {
    const f = fixture();
    const quote = await f.service.execute({ ...base, packages: [] });
    assert.equal(f.state.calls, 0); assert.equal(quote.results[0]?.carrier_key, "own_delivery_flat");
  });

  it("does not authorize local delivery when the address lookup fails", async () => {
    const f = fixture(); globalThis.fetch = (async () => { throw new Error("address_unavailable"); }) as typeof fetch;
    const quote = await f.service.execute(base);
    assert.deepEqual(quote.results.map(r => r.carrier_key), ["melhor-envio-1"]);
  });

  it("invalidates cached quotes after changes to local prices, enabled methods, origin or packages", async () => {
    const f = fixture();
    const first = await f.service.execute(base);
    assert.equal((await f.service.execute(base)).id, first.id);
    f.state.config.flatPriceCents = 1200;
    const second = await f.service.execute(base);
    assert.notEqual(second.id, first.id); assert.equal(second.results[0]?.price, 1200);
    f.state.enabled = false;
    const third = await f.service.execute(base);
    assert.notEqual(third.id, second.id); assert.equal(third.results.length, 1);
    f.state.originZip = "01003000";
    const fourth = await f.service.execute(base); assert.notEqual(fourth.id, third.id);
    const fifth = await f.service.execute({ ...base, packages: [{ ...base.packages[0]!, weightKg: 2 }] });
    assert.notEqual(fifth.id, fourth.id);
  });

  it("preview uses the same calculation without persisting a quote or session", async () => {
    const f = fixture();
    const preview = await f.service.preview(base);
    assert.equal(preview.results.length, 2); assert.equal(f.state.saved, 0);
    assert.equal(await f.sessions.getSession("merchant", "session"), undefined);
  });

  it("chat presents a quote before accepting a numbered choice and preserves a prepared payment", async () => {
    const f = fixture();
    const initial = checkoutSession({ merchantId: "merchant", sessionId: "session", shipping: undefined,
      customer: { address_verified: true, address: { zip: "01002000", street: "Rua", number: "1", complement: "", city: "São Paulo", state: "SP", neighborhood: "Centro" } },
      cart: { currency: "BRL", total: 100, items: [{ sku: "sku", price: 100, quantity: 1, weight_kg: 0.5, height_cm: 10, width_cm: 15, length_cm: 20 }] } });
    await f.sessions.saveSession(initial);
    const chat = new CheckoutShippingService(f.sessions, new CheckoutCustomerService(f.sessions), f.service, undefined, undefined, f.prisma);
    const quoted = await chat.processShippingState(initial, "1");
    assert.equal(quoted.shipping, undefined); assert.equal(quoted.shippingOptions?.length, 2);
    const selected = await chat.processShippingState(quoted, "2");
    assert.equal(selected.shipping?.carrierKey, "melhor-envio-1");
    assert.equal(selected.shipping?.customerPrice, 21.37);
    await f.service.assertSelection(selected);
    f.state.enabled = false;
    f.prisma.paymentIntent.findFirst = (async () => ({ id: "prepared" })) as never;
    const frozen = await chat.processShippingState({ ...selected, paymentMethod: "pix" }, "frete");
    assert.deepEqual(frozen.shipping, selected.shipping);
  });

  it("radius delivery respects the configured boundary and never uses a city centre", async () => {
    const f = fixture(); f.state.config = { ...f.state.config, mode: "radius", radiusZones: [{ maxKm: 5, priceCents: 900 }] };
    globalThis.fetch = (async input => {
      const url = String(input);
      if (url.includes("viacep")) return Response.json({ logradouro: url.includes("20000000") ? "Far" : url.includes("01002000") ? "Near" : "Origin", bairro: "Centro", localidade: "São Paulo", uf: "SP" });
      const query = new URL(url).searchParams.get("q") ?? "";
      return Response.json([{ lat: query.includes("Far") ? "-24.5" : query.includes("Near") ? "-23.56" : "-23.55", lon: "-46.63", addresstype: "road" }]);
    }) as typeof fetch;
    assert.ok((await f.service.execute(base)).results.some(r => r.source === "own_delivery"));
    assert.equal((await f.service.execute({ ...base, destination_zip: "20000000" })).results.some(r => r.source === "own_delivery"), false);
  });

  it("new payment creation rejects legacy freight before any provider request", async () => {
    const f = fixture(); let providerCalls = 0;
    const initial = checkoutSession({ merchantId: "merchant", sessionId: "session", shipping: { carrier: "Correios", method: "PAC", customerPrice: 19.9 } });
    await f.sessions.saveSession(initial);
    const payments = { listBySessionId: async () => [], getByIdempotency: async () => undefined };
    const provider = { createPayment: async () => { providerCalls++; throw Error("unexpected_provider_call"); } };
    const useCase = new CreatePaymentIntentUseCase(f.sessions, f.sessions, payments as never, provider as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.prisma, undefined, undefined, undefined, f.service);
    await assert.rejects(useCase.execute({ merchant_id: "merchant", session_id: "session", idempotency_key: "payment", method: "pix" }), /shipping_quote_required/);
    assert.equal(providerCalls, 0);
  });

  it("the selected delivery method governs physical order operations while digital items stay digital", () => {
    const items = [{ sku: "physical", price: 100, quantity: 1, productType: "physical" as const, fulfillmentStrategy: "carrier" as const },
      { sku: "food", price: 20, quantity: 1, productType: "food" as const, fulfillmentStrategy: "local_delivery" as const },
      { sku: "digital", price: 10, quantity: 1, productType: "digital" as const, fulfillmentStrategy: "digital" as const }];
    assert.deepEqual(snapshotOrderLines(items, { customerPrice: 8, source: "own_delivery" }).map(line => line.fulfillmentStrategy), ["local_delivery", "local_delivery", "digital"]);
    assert.deepEqual(snapshotOrderLines(items, { customerPrice: 21.37, source: "melhor_envio" }).map(line => line.fulfillmentStrategy), ["carrier", "carrier", "digital"]);
  });

  it("a local delivery order cannot purchase a Melhor Envio label", async () => {
    const prisma = { completedOrder: { findFirst: async () => ({ sessionId: "session" }) },
      marketplaceFundingPlan: { findFirst: async () => null }, crossStoreLineItem: { findFirst: async () => null },
      checkoutSession: { findUnique: async () => ({ cart: { items: [] }, shipping: { source: "own_delivery", carrierKey: "own_delivery_flat" } }) } };
    await assert.rejects(new MarketplaceLabelPurchaseGuard(prisma as never).assertOrdinaryOrder({ merchantId: "merchant", externalOrderId: "order" }), /own_delivery_does_not_use_carrier_label/);
  });

  it("rejects stale or manipulated shipping before payment", async () => {
    const f = fixture();
    const session = checkoutSession({ merchantId: "merchant", sessionId: "session", cart: { currency: "BRL", total: 100,
      items: [{ sku: "sku", price: 100, quantity: 1, weight_kg: 0.5, height_cm: 10, width_cm: 15, length_cm: 20 }] },
      customer: { address: { zip: "01002000" } }, shipping: undefined });
    await f.sessions.saveSession(session);
    const quote = await f.service.execute(checkoutShippingInput(session));
    const selected = { ...session, shipping: checkoutShippingOption(quote, quote.results[0]!) };
    await f.service.assertSelection(selected);
    await assert.rejects(f.service.assertSelection({ ...selected, shipping: { ...selected.shipping, customerPrice: 0 } }), /shipping_quote_changed/);
    f.state.config.flatPriceCents = 1500;
    await assert.rejects(f.service.assertSelection(selected), /shipping_quote_changed/);
    const select = new SelectShippingMethodUseCase(f.quotes, f.sessions, f.prisma, f.service);
    await assert.rejects(select.execute({ merchant_id: "merchant", session_id: "session", carrier_key: "own_delivery_flat" }), /shipping_quote_changed/);
  });
});
