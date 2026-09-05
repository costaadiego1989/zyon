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
  const controller = new EmbedShippingController({ async execute(input: any) { seen = input; return input; } } as never, {} as never, undefined, repo);
  await controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "01001000", cart_total: 999999,
    packages: [{ weightKg: 0.001, heightCm: 1, widthCm: 1, lengthCm: 1, quantity: 1 }],
  } as never);
  assert.equal(seen.cart_total, 100);
  assert.deepEqual(seen.packages, [{ weightKg: 1.2, heightCm: 10, widthCm: 15, lengthCm: 20, quantity: 2 }]);
  session.cart.items[0]!.height_cm = undefined;
  repo.saveSession(session);
  await assert.rejects(controller.quote({ embedClaims }, { session_id: sessionId, destination_zip: "01001000" } as never), /checkout_product_shipping_dimensions_required/);
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
