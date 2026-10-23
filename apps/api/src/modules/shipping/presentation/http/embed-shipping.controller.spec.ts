import test from "node:test";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import assert from "node:assert/strict";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import { EmbedShippingController } from "./embed-shipping.controller.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryMerchantRepository } from "../../../merchant/infrastructure/in-memory-merchant.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import type { OwnDeliveryConfig } from "../../domain/ports/own-delivery-config.port.js";

const embedClaims = { typ: "aacp_embed_v1" as const, merchantId: "mrc_1", nonce: "shipping-buyer", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
const sessionId = embedCheckoutSessionId(embedClaims);

function stubCarrier(results: ShippingQuoteResult[]): CarrierPort {
  return { carrierKey: "pac", async fetchQuotes() { return results; } };
}

function makeController(opts?: { withMerchantRepo?: boolean; withSessions?: boolean }) {
  const withMerchantRepo = opts?.withMerchantRepo ?? false;
  const withSessions = opts?.withSessions ?? true;

  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const carriers = [stubCarrier([{ carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }])];
  const merchantRepo = withMerchantRepo ? new InMemoryMerchantRepository() : undefined;
  const checkoutRepo = withSessions ? new InMemoryCheckoutRepository() : undefined;

  const quoteUse = new QuoteShippingUseCase(quotesRepo, carriers, merchantRepo as never);
  const selectUse = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo as never);

  const controller = new EmbedShippingController(quoteUse, selectUse, merchantRepo, checkoutRepo);
  return { controller, checkoutRepo, merchantRepo, quotesRepo, quoteUse, selectUse };
}

test("another token of the same merchant cannot quote or select this buyer's shipping", async () => {
  const { controller, checkoutRepo } = makeController();
  checkoutRepo!.saveSession(checkoutSession({ sessionId }));
  const otherToken = { embedClaims: { ...embedClaims, nonce: "other-buyer" } };
  await assert.rejects(controller.quote(otherToken, { session_id: sessionId, destination_zip: "01001000" } as never), /embed_checkout_session_binding_mismatch/);
  await assert.rejects(controller.select(otherToken, { session_id: sessionId, carrier_key: "pac" } as never), /embed_checkout_session_binding_mismatch/);
});

test("quote packages come from catalog-backed session data and reject missing dimensions", async () => {
  const repo = new InMemoryCheckoutRepository();
  const session = checkoutSession({ sessionId, cart: { currency: "BRL", total: 100, items: [
    { sku: "x", name: "X", price: 50, quantity: 2, weightGrams: 1200, height_cm: 10, width_cm: 15, length_cm: 20 },
  ] } });
  repo.saveSession(session);
  let seen: any;
  const controller = new EmbedShippingController({ async execute(input: any, packages?: () => unknown) {
    seen = { ...input, packages: packages?.() ?? input.packages }; return seen;
  } } as never, {} as never, undefined, repo);
  await controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "01001000", cart_total: 999999,
    packages: [{ weightKg: 0.001, heightCm: 1, widthCm: 1, lengthCm: 1, quantity: 1 }],
  } as never);
  assert.equal(seen.cart_total, 100);
  assert.deepEqual(seen.packages, [{ weightKg: 1.2, heightCm: 10, widthCm: 15, lengthCm: 20, quantity: 2 }]);
  session.cart.items[0]!.height_cm = undefined;
  repo.saveSession(session);
  await assert.rejects(controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "01001000" } as never), /checkout_product_shipping_dimensions_required/);
});

test("manual neighborhood quote uses the owned address only for the same CEP, ignoring body district", async () => {
  const repo = new InMemoryCheckoutRepository();
  const session = checkoutSession({ sessionId, customer: { address_verified: true, address: {
    zip: "01001000", street: "Synthetic", number: "1", complement: "", neighborhood: "Centro", city: "Synthetic", state: "SP",
  } }, cart: { currency: "BRL", total: 118, items: [
    { sku: "x", name: "X", price: 118, quantity: 1, weightGrams: 1000, height_cm: 10, width_cm: 15, length_cm: 20 },
  ] } });
  repo.saveSession(session); const seen: Array<Record<string, unknown>> = [];
  const controller = new EmbedShippingController({ async execute(input: Record<string, unknown>) { seen.push(input); return input; } } as never, {} as never, undefined, repo);
  await controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "01001-000", destination_neighborhood: "Other district", cart_total: 99999 } as never);
  assert.equal(seen[0]!.destination_neighborhood, "Centro"); assert.equal(seen[0]!.cart_total, 118);
  await controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "02002000", destination_neighborhood: "Centro" } as never);
  assert.equal(Object.hasOwn(seen[1]!, "destination_neighborhood"), false);
});

function realOwnedQuote(config: OwnDeliveryConfig | null, district = "Centro") {
  const sessions = new InMemoryCheckoutRepository();
  const session = checkoutSession({ sessionId, customer: { address_verified: true, address: {
    zip: "01001000", street: "Synthetic", number: "1", complement: "", neighborhood: district, city: "Synthetic", state: "SP",
  } }, cart: { currency: "BRL", total: 118, items: [{ sku: "x", name: "X", price: 118, quantity: 1 }] } });
  sessions.saveSession(session);
  let carrierCalls = 0, configReads = 0;
  const carrier: CarrierPort = { carrierKey: "pac", async fetchQuotes(context) {
    carrierCalls++; assert.equal(context.packages[0]!.heightCm, 10);
    return [{ carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }];
  } };
  const quotes = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const configSource = { async getByMerchantId() { configReads++; return config; }, async save(value: OwnDeliveryConfig) { return value; },
    async getNeighborhoodOrigin() { return { kind: "ready" as const, origin: { merchantId: "mrc_1", zip: "01001000", city: "Synthetic", state: "SP" } }; } };
  const use = new QuoteShippingUseCase(quotes, [carrier], undefined, configSource);
  const controller = new EmbedShippingController(use, {} as never, undefined, sessions);
  return { sessions, session, controller, use, quotes, configSource, stats: () => ({ carrierCalls, configReads }) };
}
const ownConfig: OwnDeliveryConfig = { id: "synthetic-config", merchantId: "mrc_1", enabled: true, mode: "flat",
  flatPriceCents: 900, freeAboveCents: null, neighborhoods: null, radiusZones: null, estimatedValue: 1, estimatedUnit: "days" };
const ownedQuoteBody = { session_id: sessionId, destination_zip: "01001000", cart_total: 999999,
  destination_neighborhood: "Cheaper", packages: [{ weightKg: 1, heightCm: 1, widthCm: 1, lengthCm: 1, quantity: 1 }] };

for (const [name, config, district, expected] of [
  ["flat", ownConfig, "Centro", 900],
  ["neighborhood", { ...ownConfig, mode: "neighborhood", neighborhoods: [{ name: "  CENTRO  ", priceCents: 1375 }, { name: "Cheaper", priceCents: 1 }] }, "Centro", 1375],
  ["unknown district", { ...ownConfig, mode: "neighborhood", neighborhoods: [{ name: "Other", priceCents: 1 }] }, "Centro", undefined],
  ["explicit free tariff", { ...ownConfig, flatPriceCents: 0 }, "Centro", 0],
] as const) test(`real embed ${name} quote does not require parcel dimensions or dispatch a carrier`, async () => {
  const f = realOwnedQuote(config as OwnDeliveryConfig, district);
  const result = await f.controller.quote({ embedClaims }, ownedQuoteBody as never);
  assert.equal(result.results.length, expected === undefined ? 0 : 1);
  assert.equal(result.results[0]?.price, expected);
  assert.deepEqual(f.stats(), { carrierCalls: 0, configReads: 1 });
  assert.equal(f.sessions.getSession("mrc_1", sessionId)!.cart.total, 118);
});

test("provider validates owned missing dimensions before a cached quote, never trusting request packages", async () => {
  const f = realOwnedQuote(null);
  Object.assign(f.session.cart.items[0]!, { weightGrams: 1000, height_cm: 10, width_cm: 15, length_cm: 20 });
  f.sessions.saveSession(f.session);
  await f.controller.quote({ embedClaims }, ownedQuoteBody as never);
  f.session.cart.items[0]!.height_cm = undefined; f.sessions.saveSession(f.session);
  await assert.rejects(f.controller.quote({ embedClaims }, ownedQuoteBody as never), /checkout_product_shipping_dimensions_required/);
  assert.deepEqual(f.stats(), { carrierCalls: 1, configReads: 2 });
});

test("foreign manual configuration is rejected before owned package validation and never dispatches", async () => {
  const f = realOwnedQuote({ ...ownConfig, merchantId: "another-merchant" });
  await assert.rejects(f.controller.quote({ embedClaims }, ownedQuoteBody as never), /shipping_manual_config_scope_mismatch/);
  assert.deepEqual(f.stats(), { carrierCalls: 0, configReads: 1 });
});

test("embed neighborhood cannot price a homonymous district in a different owned city using forged body city", async () => {
  const f = realOwnedQuote({ ...ownConfig, mode: "neighborhood", neighborhoods: [{ name: "Centro", priceCents: 900 }] });
  f.session.customer!.address!.city = "Another city"; f.sessions.saveSession(f.session);
  const result = await f.controller.quote({ embedClaims }, { ...ownedQuoteBody, destination_city: "Synthetic", destination_state: "SP" } as never);
  assert.deepEqual(result.results, []); assert.equal(f.stats().carrierCalls, 0);
});

test("selection refuses a previously quoted district after the owned city changes, before saving selection", async () => {
  const f = realOwnedQuote({ ...ownConfig, mode: "neighborhood", neighborhoods: [{ name: "Centro", priceCents: 900 }] });
  const quote = await f.controller.quote({ embedClaims }, ownedQuoteBody as never);
  f.session.customer!.address!.city = "Another city"; f.sessions.saveSession(f.session);
  const before = structuredClone(f.sessions.getSession("mrc_1", sessionId));
  const select = new SelectShippingMethodUseCase(f.quotes, f.sessions, f.configSource);
  await assert.rejects(select.execute({ merchant_id: "mrc_1", session_id: sessionId, carrier_key: quote.results[0]!.carrier_key }), /shipping_quote_review_required/);
  assert.equal((await f.quotes.findById(quote.id, "mrc_1"))!.snapshot().selected_carrier_key, null);
  assert.deepEqual(f.sessions.getSession("mrc_1", sessionId), before);
});

test("configuration failure does not turn missing parcel dimensions into manual or carrier delivery", async () => {
  const sessions = new InMemoryCheckoutRepository(); sessions.saveSession(checkoutSession({ sessionId }));
  let carrierCalls = 0;
  const use = new QuoteShippingUseCase(new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository()),
    [{ carrierKey: "pac", async fetchQuotes() { carrierCalls++; return []; } }], undefined,
    { async getByMerchantId() { throw new Error("synthetic_config_failure"); }, async save(value) { return value; } });
  const controller = new EmbedShippingController(use, {} as never, undefined, sessions);
  await assert.rejects(controller.quote({ embedClaims }, ownedQuoteBody as never), /synthetic_config_failure/);
  assert.equal(carrierCalls, 0);
});

test("EmbedShippingController.quote rejects request without embed claims (missing merchant)", async () => {
  const { controller } = makeController();
  await assert.rejects(
    controller.quote({} as never, {
      session_id: sessionId,
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /missing_embed_session_token/.test(err.message)
  );
});

test("EmbedShippingController.quote throws BadRequest when session_id is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.quote({ embedClaims } as never, {
      session_id: "  ",
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /session_id_required/.test(err.message)
  );
});

test("EmbedShippingController.quote throws BadRequest when destination_zip is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.quote({ embedClaims } as never, {
      session_id: sessionId,
      destination_zip: ""
    } as never),
    (err: unknown) => err instanceof Error && /destination_zip_required/.test(err.message)
  );
});

test("EmbedShippingController.quote throws Unauthorized when checkout session not owned by merchant", async () => {
  const { controller, checkoutRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({ merchantId: "mrc_other", sessionId: sessionId }));

  await assert.rejects(
    controller.quote({ embedClaims } as never, {
      session_id: sessionId,
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /embed_unknown_checkout_session|embed_merchant_mismatch/.test(err.message)
  );
});

test("EmbedShippingController.quote uses cart.total from session when cart_total missing from body", async () => {
  const { controller, checkoutRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: sessionId,
    cart: {
      currency: "BRL",
      total: 250,
      items: [{ sku: "x", name: "X", price: 250, cost: 100, quantity: 1, weightGrams: 1000, height_cm: 10, width_cm: 15, length_cm: 20 }]
    }
  }));

  const snap = await controller.quote(
    { embedClaims } as never,
    {
      session_id: sessionId,
      destination_zip: "01310-100"
      // no cart_total
    } as never
  );

  assert.equal(snap.session_id, sessionId);
  assert.equal(snap.results.length, 1);
});

test("EmbedShippingController.quote rejects forged free-shipping eligibility by using session total", async () => {
  const { controller, checkoutRepo, merchantRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  merchantRepo!.seedRules("mrc_1", { allowFreeShipping: true, freeShippingMinCartValue: 500 });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: sessionId,
    cart: {
      currency: "BRL",
      total: 100,
      items: [{ sku: "x", name: "X", price: 100, cost: 100, quantity: 1, weightGrams: 1000, height_cm: 10, width_cm: 15, length_cm: 20 }]
    }
  }));

  // An inflated browser subtotal cannot cross the merchant free-shipping threshold.
  const snap = await controller.quote(
    { embedClaims } as never,
    {
      session_id: sessionId,
      destination_zip: "01310-100",
      cart_total: 999999
    } as never
  );
  assert.equal(snap.results.length, 1);
  assert.equal(snap.results[0]!.is_free, false);
  assert.equal(snap.results[0]!.price, 1500);
});

test("EmbedShippingController.select rejects without claims and requires body fields", async () => {
  const { controller } = makeController();
  await assert.rejects(
    controller.select({} as never, { session_id: sessionId, carrier_key: "pac" } as never),
    (err: unknown) => err instanceof Error && /missing_embed_session_token/.test(err.message)
  );
});

test("EmbedShippingController.select throws BadRequest when carrier_key is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.select({ embedClaims } as never, {
      session_id: sessionId,
      carrier_key: ""
    } as never),
    (err: unknown) => err instanceof Error && /carrier_key_required/.test(err.message)
  );
});

test("EmbedShippingController.select succeeds end-to-end", async () => {
  const { controller, checkoutRepo, quoteUse } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: sessionId,
    shipping: undefined
  }));

  // Seed a quote via the use-case directly
  await quoteUse.execute({
    session_id: sessionId,
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    cart_total: 100
  });

  const selected = await controller.select(
    { embedClaims } as never,
    { session_id: sessionId, carrier_key: "pac" } as never
  );

  assert.equal(selected.selected_carrier_key, "pac");
});
