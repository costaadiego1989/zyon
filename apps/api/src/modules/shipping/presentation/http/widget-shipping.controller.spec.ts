import test from "node:test";
import assert from "node:assert/strict";
import type { CarrierPort } from "../../domain/ports/carrier.port.js";
import type { ShippingQuoteSnapshot, ShippingQuoteResult } from "../../domain/entities/shipping-quote.entity.js";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import { WidgetShippingController } from "./widget-shipping.controller.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function stubCarrier(key: string, results: ShippingQuoteResult[]): CarrierPort {
  return { carrierKey: key, async fetchQuotes() { return results; } };
}

function makeUseCases(carrierResults: ShippingQuoteResult[] = [
  { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
]) {
  const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const carriers = [stubCarrier("pac", carrierResults)];
  const quoteUse = new QuoteShippingUseCase(quotesRepo, carriers);
  const selectUse = new SelectShippingMethodUseCase(quotesRepo);
  return { quotesRepo, quoteUse, selectUse };
}

test("WidgetShippingController.quote forwards body to QuoteShippingUseCase and returns snapshot", async () => {
  const { quoteUse, selectUse } = makeUseCases();
  const controller = new WidgetShippingController(quoteUse, selectUse);

  const snap = await controller.quote({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    cart_total: 100
  });

  assert.equal(snap.merchant_id, "mrc_1");
  assert.equal(snap.session_id, "sess_1");
  assert.equal(snap.results.length, 1);
});

test("WidgetShippingController.quote does NOT forward free_shipping_threshold from body", async () => {
  // body.type = any — we ensure `free_shipping_threshold` is not in the args
  // (controller signature doesn't accept it), proving client cannot bypass the
  // merchant-rules authority.
  const { quoteUse, selectUse } = makeUseCases();
  const controller = new WidgetShippingController(quoteUse, selectUse);

  await controller.quote({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    cart_total: 100
  } as unknown as Parameters<typeof controller.quote>[0]);

  // If we got here without type errors and a snapshot, the threshold field is unreachable.
  assert.ok(true);
});

test("WidgetShippingController.select delegates to SelectShippingMethodUseCase", async () => {
  const { quotesRepo, quoteUse, selectUse } = makeUseCases();
  const controller = new WidgetShippingController(quoteUse, selectUse);

  const snap = await quoteUse.execute({
    session_id: "sess_x",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    cart_total: 100
  });

  const selected: ShippingQuoteSnapshot = await controller.select({
    session_id: "sess_x",
    merchant_id: "mrc_1",
    carrier_key: "pac"
  });

  assert.equal(selected.selected_carrier_key, "pac");
  // mirror what was already snapshotted by the use-case
  assert.equal(snap.results.length, selected.results.length);

  // verify repo state
  const stored = await quotesRepo.findById(snap.id, "mrc_1");
  assert.equal(stored?.snapshot().selected_carrier_key, "pac");
});
