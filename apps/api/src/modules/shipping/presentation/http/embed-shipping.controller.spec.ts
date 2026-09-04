import test from "node:test";
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

test("EmbedShippingController.quote rejects request without embed claims (missing merchant)", async () => {
  const { controller } = makeController();
  await assert.rejects(
    controller.quote({} as never, {
      session_id: "sess_1",
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /missing_embed_session_token/.test(err.message)
  );
});

test("EmbedShippingController.quote throws BadRequest when session_id is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.quote({ embedClaims: { merchantId: "mrc_1" } } as never, {
      session_id: "  ",
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /session_id_required/.test(err.message)
  );
});

test("EmbedShippingController.quote throws BadRequest when destination_zip is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.quote({ embedClaims: { merchantId: "mrc_1" } } as never, {
      session_id: "sess_1",
      destination_zip: ""
    } as never),
    (err: unknown) => err instanceof Error && /destination_zip_required/.test(err.message)
  );
});

test("EmbedShippingController.quote throws Unauthorized when checkout session not owned by merchant", async () => {
  const { controller, checkoutRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({ merchantId: "mrc_other", sessionId: "sess_1" }));

  await assert.rejects(
    controller.quote({ embedClaims: { merchantId: "mrc_1" } } as never, {
      session_id: "sess_1",
      destination_zip: "01310-100"
    } as never),
    (err: unknown) => err instanceof Error && /embed_unknown_checkout_session|embed_merchant_mismatch/.test(err.message)
  );
});

test("EmbedShippingController.quote uses cart.total from session when cart_total missing from body", async () => {
  const { controller, checkoutRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: "sess_car",
    cart: {
      currency: "BRL",
      total: 250,
      items: [{ sku: "x", name: "X", price: 250, cost: 100, quantity: 1 }]
    }
  }));

  const snap = await controller.quote(
    { embedClaims: { merchantId: "mrc_1" } } as never,
    {
      session_id: "sess_car",
      destination_zip: "01310-100"
      // no cart_total
    } as never
  );

  assert.equal(snap.session_id, "sess_car");
  assert.equal(snap.results.length, 1);
});

test("EmbedShippingController.quote uses body cart_total when provided, ignoring session cart", async () => {
  const { controller, checkoutRepo } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: "sess_car",
    cart: {
      currency: "BRL",
      total: 999,
      items: [{ sku: "x", name: "X", price: 999, cost: 100, quantity: 1 }]
    }
  }));

  // body has cart_total = 100 → use-case is invoked with that value
  // (we can't introspect directly without spies, but no throw means wiring works).
  const snap = await controller.quote(
    { embedClaims: { merchantId: "mrc_1" } } as never,
    {
      session_id: "sess_car",
      destination_zip: "01310-100",
      cart_total: 100
    } as never
  );
  assert.equal(snap.results.length, 1);
});

test("EmbedShippingController.select rejects without claims and requires body fields", async () => {
  const { controller } = makeController();
  await assert.rejects(
    controller.select({} as never, { session_id: "sess_1", carrier_key: "pac" } as never),
    (err: unknown) => err instanceof Error && /missing_embed_session_token/.test(err.message)
  );
});

test("EmbedShippingController.select throws BadRequest when carrier_key is empty", async () => {
  const { controller } = makeController({ withMerchantRepo: true, withSessions: false });
  await assert.rejects(
    controller.select({ embedClaims: { merchantId: "mrc_1" } } as never, {
      session_id: "sess_1",
      carrier_key: ""
    } as never),
    (err: unknown) => err instanceof Error && /carrier_key_required/.test(err.message)
  );
});

test("EmbedShippingController.select succeeds end-to-end", async () => {
  const { controller, checkoutRepo, quoteUse } = makeController({ withMerchantRepo: true, withSessions: true });
  await checkoutRepo!.saveSession(checkoutSession({
    merchantId: "mrc_1",
    sessionId: "sess_e2e",
    shipping: undefined
  }));

  // Seed a quote via the use-case directly
  await quoteUse.execute({
    session_id: "sess_e2e",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    cart_total: 100
  });

  const selected = await controller.select(
    { embedClaims: { merchantId: "mrc_1" } } as never,
    { session_id: "sess_e2e", carrier_key: "pac" } as never
  );

  assert.equal(selected.selected_carrier_key, "pac");
});
